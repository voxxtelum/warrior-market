import { getAllCasts, getAllDamage, getAllDamageTaken, getStockConfigRaw, listReports } from "./db";

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
}

// Reads the DB-stored config on every call (rather than caching once at
// import time) so edits made on the admin page take effect on the next
// request, with no server restart. db.ts seeds a default row on first run,
// so this is always present.
export function loadStockConfig(): StockConfig {
  const stored = getStockConfigRaw();
  if (!stored) throw new Error("Stock config missing from DB - this should have been seeded on startup");
  return JSON.parse(stored) as StockConfig;
}

export interface StockPoint {
  report_code: string;
  zone: string | null;
  start_time: number;
  price: number;
  report_score: number;
  damage_score: number;
  cast_score: number;
  dps: number;
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

    const participants: Participant[] = damageRows.map((d) => {
      const key = playerKey(d.player_name, d.server);
      const castByAbility = castsByPlayer.get(key) ?? new Map();
      const dps = d.active_time && d.active_time > 0 ? d.total_damage / (d.active_time / 1000) : 0;
      return {
        key,
        player_name: d.player_name,
        server: d.server,
        bucket: tankKeys.has(key) ? "tank" : "dps",
        dps,
        castByAbility,
      };
    });

    for (const participant of participants) {
      // Cast score: weighted average of percentile signals across whichever
      // abilities apply to this player's role (spec-agnostic abilities plus
      // their own bucket's abilities), skipping any ability whose peer
      // group was too small to produce a meaningful ranking this report.
      let weightedSum = 0;
      let weightUsed = 0;
      for (const ability of stockConfig.abilities) {
        if (ability.bucket !== "all" && ability.bucket !== participant.bucket) continue;
        const peers =
          ability.bucket === "all" ? participants : participants.filter((p) => p.bucket === ability.bucket);
        if (peers.length < stockConfig.minBucketSize) continue;
        const peerCounts = peers.map((p) => p.castByAbility.get(ability.id) ?? 0);
        const myCount = participant.castByAbility.get(ability.id) ?? 0;
        const signal = percentileSignal(myCount, peerCounts);
        weightedSum += ability.weight * signal;
        weightUsed += ability.weight;
      }
      const castScore = weightUsed > 0 ? weightedSum / weightUsed : 0;

      // Damage score: z-score against this player's own recency-weighted
      // DPS baseline in this same zone, shrunk toward 0 until they have
      // enough history for the baseline to mean something.
      const histKey = `${participant.key}::${report.zone ?? ""}`;
      const ewma = dpsEwmaByPlayerZone.get(histKey);
      let damageScore = 0;
      if (ewma) {
        const sd = Math.sqrt(ewma.variance);
        const rawZ = sd > 0 ? (participant.dps - ewma.mean) / sd : 0;
        const clampedZ = Math.max(-4, Math.min(4, rawZ));
        const shrink = Math.min(1, ewma.count / stockConfig.coldStartReports);
        damageScore = clampedZ * shrink;
      }

      const reportScore = stockConfig.damageWeight * damageScore + stockConfig.castWeight * castScore;
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
        cast_score: castScore,
        dps: participant.dps,
      });

      dpsEwmaByPlayerZone.set(histKey, updateEwma(ewma, participant.dps, stockConfig.dpsEmaAlpha));
    }
  }

  return Array.from(seriesByPlayer.values());
}
