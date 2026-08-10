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
