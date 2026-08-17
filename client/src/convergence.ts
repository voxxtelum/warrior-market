export interface ConvergenceEstimate {
  // null = rate <= 0 (no pull at all) or the target is never reached within
  // a sane bound (practically never, at these settings).
  halfLifeMs: number | null;
  ninetyPctMs: number | null;
}

// Exact for any setting drift.ts applies as an uncapped "close this % of
// the gap every tick" pull (demandAnchorDecayPct, marketGravityStrength) -
// gap after N ticks = gap0 * (1 - rate)^N, so both half-life and time-to-
// 90%-closed have a closed form.
export function exponentialConvergence(rate: number, tickMs: number): ConvergenceEstimate {
  if (rate <= 0 || rate >= 1 || tickMs <= 0) return { halfLifeMs: null, ninetyPctMs: null };
  return {
    halfLifeMs: (Math.log(0.5) / Math.log(1 - rate)) * tickMs,
    ninetyPctMs: (Math.log(0.1) / Math.log(1 - rate)) * tickMs,
  };
}

// Drift reversion has no closed form once driftMaxPct caps it (which it
// does for any gap bigger than maxPct / reversionStrength), so this
// deterministically replays drift.ts's own per-tick reversion formula - no
// random noise or swings, since those add variance around the trend rather
// than biasing it - for a representative starting gap, counting ticks
// until the gap has shrunk to half and to a tenth of where it started.
export function reversionConvergence(
  reversionStrength: number,
  maxPct: number,
  tickMs: number,
  startGapPct = 0.2,
): ConvergenceEstimate {
  if (reversionStrength <= 0 || maxPct <= 0 || tickMs <= 0) return { halfLifeMs: null, ninetyPctMs: null };
  let current = 1 - startGapPct; // anchor normalized to 1
  let halfTicks: number | null = null;
  let ninetyTicks: number | null = null;
  for (let tick = 1; tick <= 100_000; tick++) {
    const gapPct = 1 - current;
    if (Math.abs(gapPct) < 1e-9) break;
    const move = Math.max(-maxPct, Math.min(maxPct, gapPct * reversionStrength));
    current = current * (1 + move);
    const newGapPct = Math.abs(1 - current);
    if (halfTicks === null && newGapPct <= startGapPct * 0.5) halfTicks = tick;
    if (newGapPct <= startGapPct * 0.1) {
      ninetyTicks = tick;
      break;
    }
  }
  return {
    halfLifeMs: halfTicks !== null ? halfTicks * tickMs : null,
    ninetyPctMs: ninetyTicks !== null ? ninetyTicks * tickMs : null,
  };
}

// Mirrors reversionStrengthForRaidCount in src/drift.ts - per-warrior
// drift reversion speed derived from lifetime raid count, expressed as
// hours-to-90%-closed rather than a raw per-tick rate (see that function's
// own comment for why). Needed client-side so the Convergence estimates
// table can show a few illustrative raid-count breakpoints instead of a
// single flat rate, now that reversion strength isn't one number.
export function reversionStrengthForRaidCount(
  raidCount: number,
  newPlayerHours: number,
  veteranHours: number,
  settleRaids: number,
  driftIntervalMs: number,
): number {
  const tau = Math.max(settleRaids, 0.01);
  const hoursToClose = newPlayerHours + (veteranHours - newPlayerHours) * (1 - Math.exp(-raidCount / tau));
  const ticksToClose = (hoursToClose * 3_600_000) / driftIntervalMs;
  if (ticksToClose <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - Math.pow(0.1, 1 / ticksToClose)));
}

export interface SideACurveMultipliers {
  gain: number;
  loss: number;
}

// Mirrors gainMultiplier/lossMultiplier in src/stock.ts - a logistic curve
// centered at `centerPercentile`; gainMultiplier tapers below 1 above the
// center, lossMultiplier ramps above 1 above the center, both approaching
// 1 (no change from the flat pricePerScorePointUp/Down rate) right at it.
export function sideACurveMultipliers(
  percentile: number,
  centerPercentile: number,
  steepness: number,
  gainAmplitude: number,
  lossAmplitude: number,
): SideACurveMultipliers {
  const t = Math.tanh(steepness * (percentile - centerPercentile));
  return {
    gain: 1 - gainAmplitude * t,
    loss: 1 + lossAmplitude * t,
  };
}

// Linear interpolation of the price at a given percentile within a sorted
// (ascending) price distribution - "what would a warrior at this
// percentile actually be worth today," for the admin preview table's
// price-today column. Null with no data to interpolate from.
export function percentileValue(sortedPrices: number[], percentile: number): number | null {
  if (sortedPrices.length === 0) return null;
  if (sortedPrices.length === 1) return sortedPrices[0];
  const clamped = Math.min(1, Math.max(0, percentile));
  const pos = clamped * (sortedPrices.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedPrices[lower];
  const frac = pos - lower;
  return sortedPrices[lower] * (1 - frac) + sortedPrices[upper] * frac;
}

// Formats a millisecond duration into whichever unit reads most naturally.
export function fmtConvergenceDuration(ms: number | null): string {
  if (ms === null) return "practically never";
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  const days = ms / 86_400_000;
  if (days < 14) return `${days.toFixed(1)} days`;
  const weeks = days / 7;
  if (weeks < 8) return `${weeks.toFixed(1)} weeks`;
  return `${(days / 30.44).toFixed(1)} months`;
}
