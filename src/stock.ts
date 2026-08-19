import {
  applyReportPriceImpact,
  getAllCasts,
  getAllDamage,
  getAllDamageTaken,
  getAllLatestTradablePrices,
  clearAnchorPrices,
  deletePriceSnapshotsForReport,
  getAnchorPrice,
  getOrCreateWarriorId,
  getPriceSnapshotCount,
  getRaidAnchorPrice,
  getRaidSnapshotForReport,
  getReportStatus,
  getStockConfigRaw,
  insertPriceSnapshot,
  listReports,
  replaceRaidPriceSnapshots,
  setAnchorPrice,
  setRaidAnchorPrice,
  warriorHasOtherRaidSnapshot,
  warriorHasRaidSnapshot,
  type ReportPriceImpactWrite,
} from "./db";
import { createBackup } from "./backup";

export interface StockAbilityConfig {
  id: number;
  name: string;
  weight: number;
  bucket: string; // "all" | "dps" | "tank"
}

export interface TankTopNZoneConfig {
  zone: string;
  topN: number;
}

export interface StockConfig {
  abilities: StockAbilityConfig[];
  tankTopN: number;
  tankTopNByZone: TankTopNZoneConfig[];
  minBucketSize: number;
  coldStartReports: number;
  dpsEmaAlpha: number;
  damageWeight: number;
  castWeight: number;
  pricePerScorePointUp: number;
  pricePerScorePointDown: number;
  // Percentile-gated multiplier applied on top of pricePerScorePointUp/Down
  // (see percentileRank/gainMultiplier/lossMultiplier below and
  // computeReportPriceImpact) - lets a raid's dollar impact taper off near
  // the top of the field and amplify near the bottom, without ever
  // touching the sign of the move (no warrior is ever pulled toward a
  // market mean - see marketGravityStrength for that, deliberately kept
  // near-zero).
  priceCurveCenterPercentile: number;
  priceCurveSteepness: number;
  priceCurveGainAmplitude: number;
  priceCurveLossAmplitude: number;
  startingPrice: number;
  startingWalletBalance: number;
  newPlayerGraceReports: number;
  newPlayerPenaltyLeniency: number;
  minAttendancePct: number;
  damageTrendWeight: number;
  damagePeerWeight: number;
  damageTrendZClampUp: number;
  damageTrendZClampDown: number;
  driftIntervalMs: number;
  fundValuationIntervalMs: number;
  driftMaxPct: number;
  driftNoisePct: number;
  // Replaces the old flat driftReversionStrength - per-warrior reversion
  // speed is now derived from lifetime raid count (see
  // reversionStrengthForRaidCount in drift.ts): a brand-new warrior's
  // price catches up to its anchor within reversionNewPlayerHours, an
  // established one takes reversionVeteranHours, and reversionSettleRaids
  // sets how many raids it takes to transition between the two.
  reversionNewPlayerHours: number;
  reversionVeteranHours: number;
  reversionSettleRaids: number;
  demandMaxPctPerTrade: number;
  demandLiquidityDenominator: number;
  tradeFeePct: number;
  demandAnchorDecayPct: number;
  marketGravityStrength: number;
  swingChancePct: number;
  swingUpMagnitude: number;
  swingDownMagnitude: number;
  swingMagnitudeFuzz: number;
  swingCooldownGapPct: number;
}

// Absolute floor under any warrior's price. Purely a divide-by-zero/negative-
// price safety net (executeTrade in db.ts computes coinAmount / price to get
// shares) - not a tunable economic knob, hence hardcoded rather than a
// stock_config field an admin could accidentally zero out. Exported since
// drift.ts's swing mechanic also writes flat dollar deltas and needs the
// same floor.
export const MIN_PRICE = 1;

// Fraction of `sortedPrices` at or below `price` - the market-wide standing
// computeReportPriceImpact() feeds into gainMultiplier/lossMultiplier below.
// `sortedPrices` must already be ascending; a warrior's own current price
// is expected to be a member of it (see computeReportPriceImpact, which
// builds the array from the same getAllLatestWarriorPrices() snapshot it
// looks the warrior's own previous price up in).
export function percentileRank(price: number, sortedPrices: number[]): number {
  if (sortedPrices.length === 0) return 0.5;
  let below = 0;
  for (const p of sortedPrices) {
    if (p <= price) below++;
  }
  return below / sortedPrices.length;
}

// Percentile-gated multipliers on pricePerScorePointUp/Down (see
// StockConfig.priceCurveCenterPercentile and friends). Both curves cross
// 1.0 (no change from the flat rate) at the same center percentile;
// gainMultiplier tapers down above it (raids near the top earn less),
// lossMultiplier ramps up above it (raids near the top lose more) - never
// the other way around, so nobody's price is ever pulled down by these,
// only slowed on the way up or sped up on the way down.
export function gainMultiplier(percentile: number, config: StockConfig): number {
  return 1 - config.priceCurveGainAmplitude * Math.tanh(config.priceCurveSteepness * (percentile - config.priceCurveCenterPercentile));
}

export function lossMultiplier(percentile: number, config: StockConfig): number {
  return 1 + config.priceCurveLossAmplitude * Math.tanh(config.priceCurveSteepness * (percentile - config.priceCurveCenterPercentile));
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
    // Older configs predate per-zone tank sizing and used a single global
    // tankTopN with an uptime filter (removed) - fall back to the current
    // Classic raid progression's known sizes so existing installs don't
    // silently revert to flat top-4-everywhere on next load.
    tankTopNByZone:
      parsed.tankTopNByZone ?? [
        { zone: "Molten Core", topN: 3 },
        { zone: "Blackwing Lair", topN: 3 },
        { zone: "Temple of Ahn'Qiraj", topN: 4 },
        { zone: "Naxxramas", topN: 4 },
      ],
    newPlayerGraceReports: parsed.newPlayerGraceReports ?? 2,
    newPlayerPenaltyLeniency: parsed.newPlayerPenaltyLeniency ?? 0.3,
    minAttendancePct: parsed.minAttendancePct ?? 0.3,
    damageTrendWeight: parsed.damageTrendWeight ?? 0.5,
    damagePeerWeight: parsed.damagePeerWeight ?? 0.5,
    // Older configs (and single-value edits made before the up/down split)
    // stored one shared clamp under the now-removed `damageTrendZClamp` key -
    // fall back to it for both directions so existing installs keep their
    // tuned value instead of silently reverting to the default.
    damageTrendZClampUp:
      parsed.damageTrendZClampUp ?? (parsed as { damageTrendZClamp?: number }).damageTrendZClamp ?? 4,
    damageTrendZClampDown:
      parsed.damageTrendZClampDown ?? (parsed as { damageTrendZClamp?: number }).damageTrendZClamp ?? 4,
    // `priceSensitivity` (percent-of-price) was replaced by these two flat-
    // dollar fields. Deliberately NOT read from the old key - there's no
    // meaningful conversion between "% of price" and "$ flat" without
    // knowing the price level the old value was tuned against, unlike the
    // damageTrendZClamp backfill above (a valid shared-value carry-forward,
    // not a unit change). A stale `priceSensitivity` in an older stored blob
    // is simply ignored.
    pricePerScorePointUp: parsed.pricePerScorePointUp ?? 8,
    pricePerScorePointDown: parsed.pricePerScorePointDown ?? 8,
    priceCurveCenterPercentile: parsed.priceCurveCenterPercentile ?? 0.85,
    priceCurveSteepness: parsed.priceCurveSteepness ?? 12,
    priceCurveGainAmplitude: parsed.priceCurveGainAmplitude ?? 0.6,
    priceCurveLossAmplitude: parsed.priceCurveLossAmplitude ?? 0.9,
    // Not stock-pricing-related, but lives in this same single-row config
    // blob rather than a separate table for one value - db.ts reads it
    // directly (not through loadStockConfig()) to avoid a circular import,
    // since db.ts is stock.ts's own dependency.
    startingWalletBalance: parsed.startingWalletBalance ?? 1000,
    driftIntervalMs: parsed.driftIntervalMs ?? 60 * 60 * 1000,
    fundValuationIntervalMs: parsed.fundValuationIntervalMs ?? 60 * 60 * 1000,
    driftMaxPct: parsed.driftMaxPct ?? 0.005,
    // Split out of driftMaxPct, which used to double as both the noise
    // amplitude and the overall tick cap - falls back to whatever
    // driftMaxPct already is (not the hardcoded default below it) so an
    // existing install's noise behavior is unchanged until an admin
    // deliberately tunes them apart.
    driftNoisePct: parsed.driftNoisePct ?? parsed.driftMaxPct ?? 0.005,
    // `driftReversionStrength` (a single flat rate) was replaced by the
    // raid-count-gated curve above. Deliberately NOT read from the old key
    // - there's no meaningful way to place a single flat rate somewhere on
    // an hours-to-close-90%-of-the-gap curve without guessing, unlike the
    // damageTrendZClamp backfill above. A stale `driftReversionStrength`
    // in an older stored blob is simply ignored.
    reversionNewPlayerHours: parsed.reversionNewPlayerHours ?? 12,
    reversionVeteranHours: parsed.reversionVeteranHours ?? 48,
    reversionSettleRaids: parsed.reversionSettleRaids ?? 15,
    demandMaxPctPerTrade: parsed.demandMaxPctPerTrade ?? 0.015,
    demandLiquidityDenominator: parsed.demandLiquidityDenominator ?? 50000,
    tradeFeePct: parsed.tradeFeePct ?? 0.0025,
    demandAnchorDecayPct: parsed.demandAnchorDecayPct ?? 0.05,
    marketGravityStrength: parsed.marketGravityStrength ?? 0.03,
    swingChancePct: parsed.swingChancePct ?? 0.01,
    // Same reasoning as pricePerScorePointUp/Down above: no valid "% of
    // price" -> "$ flat" conversion exists, so old swing*Pct values are not
    // carried forward, just a fresh default.
    swingUpMagnitude: parsed.swingUpMagnitude ?? 20,
    swingDownMagnitude: parsed.swingDownMagnitude ?? 20,
    swingMagnitudeFuzz: parsed.swingMagnitudeFuzz ?? 5,
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

export function computeStock(opts: { includePending?: boolean } = {}): PlayerStock[] {
  const stockConfig = loadStockConfig();
  const reports = listReports({ includePending: opts.includePending });
  const casts = getAllCasts({ includePending: opts.includePending });
  const damage = getAllDamage({ includePending: opts.includePending });
  const damageTaken = getAllDamageTaken({ includePending: opts.includePending });

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

    // Snapshot the field's running prices as they stood at the start of
    // this report (before any of this report's own participants update
    // runningPrice below) - so percentile gating within one report isn't
    // order-dependent on which participant happens to be processed first,
    // same reasoning as drift.ts snapshotting marketAvg before its own
    // per-warrior updates.
    const fieldPricesSnapshot = Array.from(runningPrice.values()).sort((a, b) => a - b);

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

    // Tank identification: the top N warriors by raw total damage taken
    // this raid, straight ranking with no uptime filter - a raid's tanks
    // are simply whoever ate the most damage. N is instance-specific (a
    // 4-tank Naxx night doesn't mean a 4-tank Molten Core one), falling
    // back to tankTopN for any zone without an explicit entry. Recomputed
    // fresh every report - a player can be "tank" one night and "dps" the
    // next.
    const zoneTankTopN =
      stockConfig.tankTopNByZone.find((z) => z.zone === report.zone)?.topN ?? stockConfig.tankTopN;
    const takenStats = damageRows.map((d) => {
      const key = playerKey(d.player_name, d.server);
      const taken = damageTakenByPlayer.get(key) ?? { total: 0, activeTime: 0 };
      return { key, total: taken.total };
    });
    const tankKeys = new Set(
      takenStats
        .sort((a, b) => b.total - a.total)
        .slice(0, zoneTankTopN)
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
        const clampedZ =
          rawZ >= 0 ? Math.min(stockConfig.damageTrendZClampUp, rawZ) : Math.max(-stockConfig.damageTrendZClampDown, rawZ);
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
      // A participant's very first appearance in the walk has no field
      // standing yet to gate against - same as the live incremental path
      // in computeReportPriceImpact, which never percentile-gates a
      // warrior's first-ever raid either.
      const isFirstAppearance = !runningPrice.has(participant.key);
      const prevPrice = runningPrice.get(participant.key) ?? stockConfig.startingPrice;
      const percentile = isFirstAppearance ? 0.5 : percentileRank(prevPrice, fieldPricesSnapshot);
      const perPoint =
        reportScore >= 0
          ? stockConfig.pricePerScorePointUp * (isFirstAppearance ? 1 : gainMultiplier(percentile, stockConfig))
          : stockConfig.pricePerScorePointDown * (isFirstAppearance ? 1 : lossMultiplier(percentile, stockConfig));
      const price = Math.max(MIN_PRICE, prevPrice + perPoint * reportScore);
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

export interface ReportPriceImpactEntry {
  warriorId: number;
  playerName: string;
  server: string;
  currentAnchor: number | null; // null = warrior has never had a price before (first raid)
  reportScore: number;
  afterAnchor: number;
  delta: number | null; // afterAnchor - currentAnchor; null when currentAnchor is null
  isFirstPrice: boolean;
}

// Pure compute-only preview of one report's price impact - same math the
// old snapshotPricesForReport used to write directly, but returns what
// WOULD happen instead of writing it, so it's safe to call repeatedly (e.g.
// the admin's "Refresh" button after tweaking stock_config on a separate
// tab - loadStockConfig() and computeStock() both read fresh from the DB on
// every call, nothing here needs invalidating). Must see the report's own
// data even though it's still 'pending' - hence computeStock({ includePending:
// true }), unlike every other computeStock() caller in this file.
export function computeReportPriceImpact(reportCode: string): ReportPriceImpactEntry[] {
  const stockConfig = loadStockConfig();
  const allStock = computeStock({ includePending: true });
  // Batched, once for this whole report - not per-warrior getLatestPrice()
  // calls in the loop below - both as an N-query-avoidance and so every
  // participant's percentile is ranked against the same cross-sectional
  // snapshot regardless of insert order within this report (same reasoning
  // as computeStock()'s own fieldPricesSnapshot above).
  const latestPrices = getAllLatestTradablePrices();
  const sortedPrices = Array.from(latestPrices.values()).sort((a, b) => a - b);

  const entries: ReportPriceImpactEntry[] = [];
  for (const playerStock of allStock) {
    const point = playerStock.series.find((s) => s.report_code === reportCode);
    if (!point) continue;
    const warriorId = getOrCreateWarriorId(playerStock.player_name, playerStock.server);
    const previousPrice = latestPrices.get(warriorId) ?? null;

    if (previousPrice === null) {
      // This warrior's very first price ever - no field standing yet to
      // gate against, same as computeStock()'s own first-appearance case.
      entries.push({
        warriorId,
        playerName: playerStock.player_name,
        server: playerStock.server,
        currentAnchor: null,
        reportScore: point.report_score,
        afterAnchor: point.price,
        delta: null,
        isFirstPrice: true,
      });
      continue;
    }

    // Every raid after the first applies its score to the anchor, not the
    // live price - a raid resolves the market's fundamental value forward,
    // but leaves whatever price trading/drift actually settled on alone.
    // pricePerScorePointUp/Down is gated by this warrior's current price
    // percentile (see gainMultiplier/lossMultiplier above) - raids near the
    // top of the field move the anchor less on a good night and more on a
    // bad one; raids near the bottom, the reverse.
    const percentile = percentileRank(previousPrice, sortedPrices);
    const perPoint =
      point.report_score >= 0
        ? stockConfig.pricePerScorePointUp * gainMultiplier(percentile, stockConfig)
        : stockConfig.pricePerScorePointDown * lossMultiplier(percentile, stockConfig);
    const currentAnchor = getAnchorPrice(warriorId) ?? previousPrice;
    const afterAnchor = Math.max(MIN_PRICE, currentAnchor + perPoint * point.report_score);
    entries.push({
      warriorId,
      playerName: playerStock.player_name,
      server: playerStock.server,
      currentAnchor,
      reportScore: point.report_score,
      afterAnchor,
      delta: afterAnchor - currentAnchor,
      isFirstPrice: false,
    });
  }
  return entries;
}

// Validates the report is actually pending, computes its price impact fresh
// (using whatever stock_config is active right now - so what goes live is
// always current, never stale from an earlier preview render even if the
// admin tweaked config after their last "Refresh"), then applies it
// atomically and flips status to 'committed'. Throws if the report doesn't
// exist, isn't pending, or was concurrently committed/discarded (see
// applyReportPriceImpact's guarded UPDATE).
export function commitReport(reportCode: string): ReportPriceImpactEntry[] {
  const status = getReportStatus(reportCode);
  if (status === null) throw new Error(`Report "${reportCode}" not found`);
  if (status !== "pending") throw new Error(`Report "${reportCode}" is not pending review (status: ${status})`);

  const entries = computeReportPriceImpact(reportCode);
  const writes: ReportPriceImpactWrite[] = entries.map((e) => ({
    warriorId: e.warriorId,
    price: e.afterAnchor,
    delta: e.isFirstPrice ? null : e.delta,
    source: e.isFirstPrice ? "raid" : "raid_anchor",
  }));
  // Safety snapshot before this report's price impact goes live - must run
  // before applyReportPriceImpact's own BEGIN (db.ts), since VACUUM INTO
  // can't run inside an open transaction.
  createBackup("pre_report", { reportCode });
  applyReportPriceImpact(reportCode, writes);
  return entries;
}

// Recomputes computeStock() from scratch and replaces every raid-sourced
// price_snapshots row with the result, using each report's own start_time
// (rather than "now", which every rebuilt row would otherwise share) so the
// chart's chronological order is preserved. Used only for the one-time
// historical backfill below and a full market reset - both cases where
// there's no live-compounded history to preserve, so every warrior's
// anchors landing flatly on the freshly computed value is exactly correct.
// A report delete does NOT go through here - see undoReportPriceImpact,
// which surgically undoes just that report's effect instead of replaying
// everyone's entire history from scratch.
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
    if (!lastPoint) continue;
    setAnchorPrice(warriorId, lastPoint.price);
    setRaidAnchorPrice(warriorId, lastPoint.price);
  }
  replaceRaidPriceSnapshots(entries);
}

// Surgically undoes exactly one deleted report's price impact - the only
// thing that's ever allowed to touch already-committed raid history (see
// src/routes/reports.ts's DELETE handler). Deliberately does NOT call
// computeStock() or touch any row/warrior outside `participantKeys`: old
// raid results are immutable forever once committed, except for the report
// being deleted right now.
//
// For each participant, anchor_price/raid_anchor_price are a pure running
// sum of every committed raid's delta (see commitReport/
// computeReportPriceImpact: afterAnchor = currentAnchor + perPoint *
// reportScore). Subtracting the deleted report's own recorded delta from
// both anchors is therefore an exact inverse regardless of whether it was
// the participant's most recent raid or an older one - no recompute needed,
// and no dependency on whatever stock_config is active right now.
//
// A participant whose delta is null was recorded as their first-ever raid
// (nothing to subtract from - their price was set directly, not compounded
// from a prior anchor). If they have no other raid history left after this
// one is deleted, their anchors reset to "never raided"; if they do, those
// later raids' own deltas are already correct absolute figures independent
// of this row's continued existence, so their anchors are left untouched.
export function undoReportPriceImpact(reportCode: string, participantKeys: Set<string>): void {
  for (const key of participantKeys) {
    const [playerName, server] = key.split("::");
    const warriorId = getOrCreateWarriorId(playerName, server);
    const snapshot = getRaidSnapshotForReport(warriorId, reportCode);
    if (!snapshot) continue;

    if (snapshot.delta !== null) {
      const oldAnchor = getAnchorPrice(warriorId);
      const oldRaidAnchor = getRaidAnchorPrice(warriorId);
      if (oldAnchor !== null) setAnchorPrice(warriorId, Math.max(MIN_PRICE, oldAnchor - snapshot.delta));
      if (oldRaidAnchor !== null) setRaidAnchorPrice(warriorId, Math.max(MIN_PRICE, oldRaidAnchor - snapshot.delta));
    } else if (!warriorHasOtherRaidSnapshot(warriorId, reportCode)) {
      clearAnchorPrices(warriorId);
    }
  }
  deletePriceSnapshotsForReport(reportCode);
}

// Backfills raid-derived price history for exactly one warrior - used when
// an admin unhides a player who was auto-hidden on first sight (see
// getOrCreateWarriorId), whose raid reports were therefore excluded from
// every computeStock() run until now and so never got a price_snapshots row.
// Deliberately NOT rebuildRaidPriceSnapshots(): that wipes and recomputes
// EVERY warrior's raid history from pure fundamentals, discarding the
// "compounded onto the live, demand/drift-adjusted price" values
// commitReport normally writes - fine for a full market reset
// (nothing live to preserve) but a real regression for a single unhide,
// visibly disturbing every other warrior's "since last raid" figure to
// backfill just one. This only ever inserts rows for the target warrior_id,
// leaving everyone else's ledger untouched. A no-op if the warrior already
// has raid history, so toggling hidden on/off more than once can't
// duplicate rows.
export function backfillRaidPriceSnapshotsForWarrior(playerName: string, server: string): void {
  const warriorId = getOrCreateWarriorId(playerName, server);
  if (warriorHasRaidSnapshot(warriorId)) return;
  const playerStock = computeStock().find(
    (p) => p.player_name === playerName && p.server === server,
  );
  if (!playerStock) return;
  for (const point of playerStock.series) {
    insertPriceSnapshot(warriorId, point.price, null, "raid", point.report_code, point.start_time);
  }
  const lastPoint = playerStock.series[playerStock.series.length - 1];
  if (lastPoint) {
    setAnchorPrice(warriorId, lastPoint.price);
    setRaidAnchorPrice(warriorId, lastPoint.price);
  }
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
