import {
  getAllCasts,
  getAllDamage,
  getAllDamageTaken,
  getLatestPrice,
  getOrCreateWarriorId,
  getPriceSnapshotCount,
  getStockConfigRaw,
  insertPriceSnapshot,
  listReports,
  replaceRaidPriceSnapshots,
  setAnchorPrice,
  setRaidAnchorPrice,
} from "./db";

export interface StockAbilityConfig {
  id: number;
  name: string;
  weight: number;
  bucket: string; // "all" | "dps" | "tank"
}

export interface StockConfig {
  abilities: StockAbilityConfig[];
  tankTopN: number;
  tankMinUptimePct: number;
  minBucketSize: number;
  coldStartReports: number;
  dpsEmaAlpha: number;
  damageWeight: number;
  castWeight: number;
  priceSensitivity: number;
  startingPrice: number;
  newPlayerGraceReports: number;
  newPlayerPenaltyLeniency: number;
  minAttendancePct: number;
  damageTrendWeight: number;
  damagePeerWeight: number;
  damageTrendZClamp: number;
  driftIntervalMs: number;
  fundValuationIntervalMs: number;
  driftMaxPct: number;
  driftReversionStrength: number;
  demandMaxPctPerTrade: number;
  demandLiquidityDenominator: number;
  tradeFeePct: number;
  demandAnchorDecayPct: number;
  marketGravityStrength: number;
  swingChancePct: number;
  swingUpMagnitudePct: number;
  swingDownMagnitudePct: number;
  swingMagnitudeFuzzPct: number;
  swingCooldownGapPct: number;
}

// Reads the DB-stored config on every call (rather than caching once at
// import time) so edits made on the admin page take effect on the next
// request, with no server restart. db.ts seeds a default row on first run,
// so this is always present.
export function loadStockConfig(): StockConfig {
  const stored = getStockConfigRaw();
  if (!stored) throw new Error("Stock config missing from DB - this should have been seeded on startup");
  // Backfill fields added after a DB row may have already been seeded -
  // there's no schema migration for this single-row JSON blob, so older
  // installs' stored config can be missing newer keys.
  const parsed = JSON.parse(stored) as Partial<StockConfig>;
  return {
    ...parsed,
    newPlayerGraceReports: parsed.newPlayerGraceReports ?? 2,
    newPlayerPenaltyLeniency: parsed.newPlayerPenaltyLeniency ?? 0.3,
    minAttendancePct: parsed.minAttendancePct ?? 0.3,
    damageTrendWeight: parsed.damageTrendWeight ?? 0.5,
    damagePeerWeight: parsed.damagePeerWeight ?? 0.5,
    damageTrendZClamp: parsed.damageTrendZClamp ?? 4,
    driftIntervalMs: parsed.driftIntervalMs ?? 60 * 60 * 1000,
    fundValuationIntervalMs: parsed.fundValuationIntervalMs ?? 60 * 60 * 1000,
    driftMaxPct: parsed.driftMaxPct ?? 0.005,
    driftReversionStrength: parsed.driftReversionStrength ?? 0.3,
    demandMaxPctPerTrade: parsed.demandMaxPctPerTrade ?? 0.015,
    demandLiquidityDenominator: parsed.demandLiquidityDenominator ?? 50000,
    tradeFeePct: parsed.tradeFeePct ?? 0.0025,
    demandAnchorDecayPct: parsed.demandAnchorDecayPct ?? 0.05,
    marketGravityStrength: parsed.marketGravityStrength ?? 0.03,
    swingChancePct: parsed.swingChancePct ?? 0.01,
    swingUpMagnitudePct: parsed.swingUpMagnitudePct ?? 0.1,
    swingDownMagnitudePct: parsed.swingDownMagnitudePct ?? 0.1,
    swingMagnitudeFuzzPct: parsed.swingMagnitudeFuzzPct ?? 0.02,
    swingCooldownGapPct: parsed.swingCooldownGapPct ?? 0.08,
  } as StockConfig;
}

export interface StockPoint {
  report_code: string;
  zone: string | null;
  start_time: number;
  price: number;
  report_score: number;
  damage_score: number;
  damage_trend_score: number;
  damage_peer_score: number;
  cast_score: number;
  dps: number;
  excluded_low_attendance: boolean;
}

export interface PlayerStock {
  player_name: string;
  server: string;
  series: StockPoint[];
}

interface Participant {
  key: string;
  player_name: string;
  server: string;
  bucket: "tank" | "dps";
  dps: number;
  castByAbility: Map<number, number>;
  lowAttendance: boolean;
}

function playerKey(name: string, server: string): string {
  return `${name}::${server}`;
}

// Mid-rank percentile in [0, 1] ("half credit" for ties), remapped to a
// signed [-1, 1] scale so "exactly average" is 0.
function percentileSignal(value: number, groupValues: number[]): number {
  const n = groupValues.length;
  if (n <= 1) return 0;
  let countLess = 0;
  let countEqual = 0;
  for (const v of groupValues) {
    if (v < value) countLess++;
    else if (v === value) countEqual++;
  }
  const percentile = (countLess + 0.5 * (countEqual - 1)) / (n - 1);
  return (percentile - 0.5) * 2;
}

interface EwmaState {
  mean: number;
  variance: number;
  count: number;
}

// Incremental exponentially-weighted mean/variance, so a player's damage
// baseline tracks recent form (gear upgrades, improving rotation, spec
// changes) rather than being anchored to a flat average over their entire
// history - a raid from months ago fades out instead of counting the same
// as last week's.
function updateEwma(state: EwmaState | undefined, x: number, alpha: number): EwmaState {
  if (!state) return { mean: x, variance: 0, count: 1 };
  const diff = x - state.mean;
  const incr = alpha * diff;
  return {
    mean: state.mean + incr,
    variance: (1 - alpha) * (state.variance + diff * incr),
    count: state.count + 1,
  };
}

export function computeStock(): PlayerStock[] {
  const stockConfig = loadStockConfig();
  const reports = listReports();
  const casts = getAllCasts();
  const damage = getAllDamage();
  const damageTaken = getAllDamageTaken();

  const castsByReport = new Map<string, typeof casts>();
  for (const c of casts) {
    if (!castsByReport.has(c.report_code)) castsByReport.set(c.report_code, []);
    castsByReport.get(c.report_code)!.push(c);
  }
  const damageByReport = new Map<string, typeof damage>();
  for (const d of damage) {
    if (!damageByReport.has(d.report_code)) damageByReport.set(d.report_code, []);
    damageByReport.get(d.report_code)!.push(d);
  }
  const damageTakenByReport = new Map<string, typeof damageTaken>();
  for (const d of damageTaken) {
    if (!damageTakenByReport.has(d.report_code)) damageTakenByReport.set(d.report_code, []);
    damageTakenByReport.get(d.report_code)!.push(d);
  }

  const seriesByPlayer = new Map<string, PlayerStock>();
  const runningPrice = new Map<string, number>();
  // Per (player, zone) EWMA of trailing DPS, built up as we walk reports
  // chronologically - only ever reflects reports strictly before "now".
  const dpsEwmaByPlayerZone = new Map<string, EwmaState>();

  for (const report of reports) {
    const damageRows = damageByReport.get(report.code) ?? [];
    if (damageRows.length === 0) continue;

    const reportCasts = castsByReport.get(report.code) ?? [];
    const castsByPlayer = new Map<string, Map<number, number>>();
    for (const c of reportCasts) {
      const key = playerKey(c.player_name, c.server);
      if (!castsByPlayer.has(key)) castsByPlayer.set(key, new Map());
      castsByPlayer.get(key)!.set(c.ability_id, c.cast_count);
    }

    const damageTakenByPlayer = new Map<string, { total: number; activeTime: number }>();
    for (const d of damageTakenByReport.get(report.code) ?? []) {
      damageTakenByPlayer.set(playerKey(d.player_name, d.server), {
        total: d.total_taken,
        activeTime: d.active_time ?? 0,
      });
    }

    // Tank identification: the top N warriors by damage taken this raid,
    // restricted to those who were actually getting hit for a meaningful
    // share of their own time in combat (so a DPS warrior who eats one big
    // cleave hit doesn't get mistaken for a tank). Uptime is measured
    // against the player's own active (damage-dealing) time, not the whole
    // raid session - a multi-hour night is mostly downtime between pulls,
    // so measuring against session length made everyone's uptime tiny and
    // nobody would ever clear a 20% bar. Recomputed fresh every report - a
    // player can be "tank" one night and "dps" the next.
    const takenStats = damageRows.map((d) => {
      const key = playerKey(d.player_name, d.server);
      const taken = damageTakenByPlayer.get(key) ?? { total: 0, activeTime: 0 };
      const dealtActiveTime = d.active_time ?? 0;
      const uptimePct = dealtActiveTime > 0 ? taken.activeTime / dealtActiveTime : 0;
      return { key, total: taken.total, uptimePct };
    });
    const tankKeys = new Set(
      takenStats
        .filter((t) => t.uptimePct > stockConfig.tankMinUptimePct)
        .sort((a, b) => b.total - a.total)
        .slice(0, stockConfig.tankTopN)
        .map((t) => t.key)
    );

    // Attendance proxy: active_time relative to this report's top attendee.
    // Someone who disconnected or left early has a much smaller active_time
    // than a full-night participant, without needing per-fight WCL data.
    const maxActiveTime = damageRows.reduce((max, d) => Math.max(max, d.active_time ?? 0), 0);

    const participants: Participant[] = damageRows.map((d) => {
      const key = playerKey(d.player_name, d.server);
      const castByAbility = castsByPlayer.get(key) ?? new Map();
      const dps = d.active_time && d.active_time > 0 ? d.total_damage / (d.active_time / 1000) : 0;
      const attendancePct = maxActiveTime > 0 ? (d.active_time ?? 0) / maxActiveTime : 1;
      return {
        key,
        player_name: d.player_name,
        server: d.server,
        bucket: tankKeys.has(key) ? "tank" : "dps",
        dps,
        castByAbility,
        lowAttendance: attendancePct < stockConfig.minAttendancePct,
      };
    });

    for (const participant of participants) {
      // Read this player's history in this zone once - ewma.count (before
      // it's updated below) is how many prior reports they've had here,
      // used both for the damage cold-start shrink and the cast leniency
      // grace period.
      const histKey = `${participant.key}::${report.zone ?? ""}`;
      const ewma = dpsEwmaByPlayerZone.get(histKey);
      const priorAttendance = ewma?.count ?? 0;

      // Cast score: weighted average of percentile signals across whichever
      // abilities apply to this player's role (spec-agnostic abilities plus
      // their own bucket's abilities), skipping any ability whose peer
      // group was too small to produce a meaningful ranking this report.
      let weightedSum = 0;
      let weightUsed = 0;
      for (const ability of stockConfig.abilities) {
        if (ability.bucket !== "all" && ability.bucket !== participant.bucket) continue;
        const peers = (
          ability.bucket === "all" ? participants : participants.filter((p) => p.bucket === ability.bucket)
        ).filter((p) => !p.lowAttendance);
        if (peers.length < stockConfig.minBucketSize) continue;
        const peerCounts = peers.map((p) => p.castByAbility.get(ability.id) ?? 0);
        const myCount = participant.castByAbility.get(ability.id) ?? 0;
        const signal = percentileSignal(myCount, peerCounts);
        weightedSum += ability.weight * signal;
        weightUsed += ability.weight;
      }
      let castScore = weightUsed > 0 ? weightedSum / weightUsed : 0;

      // New-to-instance leniency: for a player's first newPlayerGraceReports
      // appearances in this zone, soften a negative cast score (a rough
      // learning pull shouldn't tank the price) without touching positive
      // scores (a fast learner still gets full credit).
      if (priorAttendance < stockConfig.newPlayerGraceReports && castScore < 0) {
        castScore *= stockConfig.newPlayerPenaltyLeniency;
      }

      // Damage trend score: z-score against this player's own recency-
      // weighted DPS baseline in this same zone, shrunk toward 0 until they
      // have enough history for the baseline to mean something. Rewards
      // personal improvement over time (gear upgrades, better rotation).
      let damageTrendScore = 0;
      if (ewma) {
        const sd = Math.sqrt(ewma.variance);
        const rawZ = sd > 0 ? (participant.dps - ewma.mean) / sd : 0;
        const clampedZ = Math.max(-stockConfig.damageTrendZClamp, Math.min(stockConfig.damageTrendZClamp, rawZ));
        const shrink = Math.min(1, ewma.count / stockConfig.coldStartReports);
        damageTrendScore = clampedZ * shrink;
      }

      // Damage peer score: percentile rank of DPS among this report's
      // bucket-mates (tank vs dps), same mechanism as cast score. Rewards
      // standing at the top of the pack even when a personal-trend delta has
      // little room to move, and is immune to raid-wide swings (e.g. a
      // Naxxramas night with a lighter boss/wipe mix) since everyone in the
      // bucket is compared against the same night's peers.
      const damagePeers = participants.filter((p) => p.bucket === participant.bucket && !p.lowAttendance);
      let damagePeerScore =
        damagePeers.length >= stockConfig.minBucketSize
          ? percentileSignal(
              participant.dps,
              damagePeers.map((p) => p.dps)
            )
          : 0;
      if (priorAttendance < stockConfig.newPlayerGraceReports && damagePeerScore < 0) {
        damagePeerScore *= stockConfig.newPlayerPenaltyLeniency;
      }

      const damageScore = stockConfig.damageTrendWeight * damageTrendScore + stockConfig.damagePeerWeight * damagePeerScore;

      // A low-attendance report is kept in the player's series for history,
      // but forced to a neutral score so it doesn't move their price.
      const reportScore = participant.lowAttendance
        ? 0
        : stockConfig.damageWeight * damageScore + stockConfig.castWeight * castScore;
      const prevPrice = runningPrice.get(participant.key) ?? stockConfig.startingPrice;
      const price = prevPrice * (1 + stockConfig.priceSensitivity * reportScore);
      runningPrice.set(participant.key, price);

      if (!seriesByPlayer.has(participant.key)) {
        seriesByPlayer.set(participant.key, {
          player_name: participant.player_name,
          server: participant.server,
          series: [],
        });
      }
      seriesByPlayer.get(participant.key)!.series.push({
        report_code: report.code,
        zone: report.zone,
        start_time: report.start_time,
        price,
        report_score: reportScore,
        damage_score: damageScore,
        damage_trend_score: damageTrendScore,
        damage_peer_score: damagePeerScore,
        cast_score: castScore,
        dps: participant.dps,
        excluded_low_attendance: participant.lowAttendance,
      });

      // Don't let a partial-night DPS poison the player's own baseline for
      // future reports in this zone.
      if (!participant.lowAttendance) {
        dpsEwmaByPlayerZone.set(histKey, updateEwma(ewma, participant.dps, stockConfig.dpsEmaAlpha));
      }
    }
  }

  return Array.from(seriesByPlayer.values());
}

// Freezes an immutable price for every participant of one just-ingested
// report, at ingest time (not the raid's own start_time - see
// backfillPriceSnapshotsIfNeeded for why that distinction matters). Reruns
// full computeStock() rather than an incremental recompute - ingest is
// manual/low-volume, so the recompute cost is negligible, and it keeps this
// in lockstep with whatever computeStock() actually does.
export function snapshotPricesForReport(reportCode: string, createdAt: number = Date.now()) {
  const stockConfig = loadStockConfig();
  const allStock = computeStock();
  for (const playerStock of allStock) {
    const point = playerStock.series.find((s) => s.report_code === reportCode);
    if (!point) continue;
    const warriorId = getOrCreateWarriorId(playerStock.player_name, playerStock.server);
    // This is a real-time, one-report-at-a-time insert (unlike the bulk
    // historical replay in replaceRaidPriceSnapshots), so the ledger's
    // current latest row for this warrior really is the row immediately
    // before this one.
    const previousPrice = getLatestPrice(warriorId);
    // Apply this raid's score to the LIVE price (wherever demand/drift left
    // it), not to computeStock()'s own independent fundamentals series - a
    // raid resolves the bet players made on the live price, rather than
    // correcting it to a value trading pressure never touched. Falls back
    // to point.price (computeStock()'s own first-ever value, which is just
    // startingPrice compounded once) only when there's no live price yet -
    // i.e. this warrior's very first price ever.
    const newPrice =
      previousPrice !== null
        ? previousPrice * (1 + stockConfig.priceSensitivity * point.report_score)
        : point.price;
    const delta = previousPrice !== null ? newPrice - previousPrice : null;
    insertPriceSnapshot(warriorId, newPrice, delta, "raid", reportCode, createdAt);
    // Both anchors now converge to the same freshly-resolved price - there's
    // no more "true target vs. blended" distinction. Demand/drift can pull
    // anchor_price away from raid_anchor_price again between raids exactly
    // as before; decay keeps pulling it back toward THIS raid's price.
    setAnchorPrice(warriorId, newPrice);
    setRaidAnchorPrice(warriorId, newPrice);
  }
}

// Recomputes computeStock() from scratch and replaces every raid-sourced
// price_snapshots row with the result, using each report's own start_time
// (rather than "now", which every rebuilt row would otherwise share) so the
// chart's chronological order is preserved. Used both for the one-time
// historical backfill below and whenever raid history changes after the
// fact (a report gets deleted, or the market is reset).
//
// Known, deliberate limitation: unlike snapshotPricesForReport (which
// compounds a raid's score onto the live price), this always writes
// computeStock()'s pure fundamentals value. That's exactly correct after a
// market reset (resetMarketState wipes trading history alongside this
// rebuild, so there's no live price to preserve), but after a single report
// delete it isn't - trading history survives, and faithfully replaying
// "what the live price would have been at each historical raid, accounting
// for every interleaved trade/drift tick" is a sequential-replay problem,
// not this function's simple bulk recompute. Not worth solving for a rare,
// deliberate admin action - just be aware a report delete can leave a small
// discontinuity between the rebuilt raid history and the live price that
// was already there.
export function rebuildRaidPriceSnapshots(): void {
  const allStock = computeStock();
  const entries: { warriorId: number; price: number; reportCode: string; createdAt: number }[] = [];
  for (const playerStock of allStock) {
    const warriorId = getOrCreateWarriorId(playerStock.player_name, playerStock.server);
    for (const point of playerStock.series) {
      entries.push({ warriorId, price: point.price, reportCode: point.report_code, createdAt: point.start_time });
    }
    // Anchor reflects each warrior's most recent raid result post-rebuild -
    // series is chronological, so the last point is the latest.
    const lastPoint = playerStock.series[playerStock.series.length - 1];
    if (lastPoint) {
      setAnchorPrice(warriorId, lastPoint.price);
      setRaidAnchorPrice(warriorId, lastPoint.price);
    }
  }
  replaceRaidPriceSnapshots(entries);
}

// One-time migration for installs that already had raid history before this
// feature shipped: snapshots every historical report's price so trading has
// a starting series to read from. Safe to call on every boot - it's a no-op
// once any snapshot exists.
export function backfillPriceSnapshotsIfNeeded() {
  if (getPriceSnapshotCount() > 0) return;
  if (listReports().length === 0) return;
  rebuildRaidPriceSnapshots();
}
