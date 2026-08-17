import {
  getAnchorPrice,
  getLastDriftAt,
  getLatestPrice,
  getRaidAnchorPrice,
  insertPriceSnapshot,
  listWarriorsWithRaidSnapshot,
  refreshPortfolioSnapshots,
  setAnchorPrice,
  setLastDriftAt,
} from "./db";
import { loadStockConfig, MIN_PRICE, type StockConfig } from "./stock";

// Small, non-configurable jitter applied to a swing's dollar magnitude so
// the result doesn't land on a suspiciously round number (every swing
// otherwise being an exact multiple of the configured magnitude/fuzz would
// look robotic) - purely cosmetic, not a tunable economic knob, hence
// hardcoded rather than a stock_config field.
const SWING_COSMETIC_FUZZ_MIN = 0.03;
const SWING_COSMETIC_FUZZ_MAX = 0.05;

// Nudges every warrior's price between raids so the market has texture on
// off nights, without turning into a free random walk that could wander to
// 0/infinity over weeks. Each tick, a warrior's price gets:
//  - a decay of its trading anchor (warriors.anchor_price) back toward its
//    raid anchor (warriors.raid_anchor_price, set only by raid results) by
//    demandAnchorDecayPct - so a demand-driven pump/dump from trades (see
//    executeTrade() in db.ts, which moves anchor_price but never
//    raid_anchor_price) fades without sustained buying/selling instead of
//    sticking forever;
//  - then either a small step (reversion toward that anchor, a pull toward
//    the current market-wide average price via marketGravityStrength so
//    the whole market can't drift up or down together forever, and random
//    noise sized by driftNoisePct - summed and capped at driftMaxPct, a
//    percentage move), OR,
//    rarely (swingChancePct), one much larger "overnight swing" in a random
//    direction: a flat dollar amount (swingUpMagnitude/swingDownMagnitude,
//    swingMagnitudeFuzz) rather than a percentage, so a swing hits a cheap
//    and an expensive warrior for the same number of coins - that bypasses
//    the driftMaxPct cap entirely, for flavor. A warrior already displaced
//    more than swingCooldownGapPct from its anchor in one direction can't
//    take another swing the same direction until price drifts back.
export function runDriftTick() {
  const config = loadStockConfig();
  const warriors = listWarriorsWithRaidSnapshot();
  const now = Date.now();

  // Must run before this tick's price updates below, using prices as they
  // stood at the end of the *previous* tick - so the delta a user sees
  // between now and the next tick reflects what this tick actually changes.
  // Refreshing after the updates (as this used to do) would always read
  // back a delta of 0, since prices only change during a tick and the
  // snapshot would be re-synced to the same values in the same call.
  refreshPortfolioSnapshots();

  // Snapshot today's cross-sectional average up front, before any of this
  // tick's updates are applied, so market gravity doesn't become
  // order-dependent on which warrior happens to be processed first.
  const prices = warriors.map((w) => getLatestPrice(w.id)).filter((p): p is number => p !== null);
  const marketAvg = prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : null;

  for (const warrior of warriors) {
    const currentPrice = getLatestPrice(warrior.id);
    let anchorPrice = getAnchorPrice(warrior.id);
    if (currentPrice === null || anchorPrice === null || anchorPrice <= 0) continue;

    const raidAnchorPrice = getRaidAnchorPrice(warrior.id);
    if (raidAnchorPrice !== null && raidAnchorPrice > 0) {
      const demandGapPct = (raidAnchorPrice - anchorPrice) / raidAnchorPrice;
      anchorPrice = anchorPrice * (1 + demandGapPct * config.demandAnchorDecayPct);
      setAnchorPrice(warrior.id, anchorPrice);
    }

    const gapPct = (anchorPrice - currentPrice) / anchorPrice;

    // Swings are a flat dollar delta (so a cheap and an expensive warrior
    // get hit for the same number of coins); the normal tick stays a
    // percentage of currentPrice. Both resolve to a dollar delta here so
    // they can be applied and floored the same way below.
    let delta: number;
    let source: "drift" | "swing" = "drift";

    if (config.swingChancePct > 0 && Math.random() < config.swingChancePct) {
      const direction: "up" | "down" = Math.random() < 0.5 ? "up" : "down";
      const cooldownBlocked =
        (direction === "down" && gapPct > config.swingCooldownGapPct) ||
        (direction === "up" && gapPct < -config.swingCooldownGapPct);
      if (!cooldownBlocked) {
        const baseMagnitude = direction === "down" ? config.swingDownMagnitude : config.swingUpMagnitude;
        const fuzz = (Math.random() * 2 - 1) * config.swingMagnitudeFuzz;
        let magnitude = Math.max(0, baseMagnitude + fuzz);
        // Cosmetic-only jitter (see SWING_COSMETIC_FUZZ_MIN/MAX above) so
        // the final dollar amount doesn't land on a suspiciously round
        // number - nudges magnitude a few percent either way, never flips
        // the direction already chosen above.
        const cosmeticFuzzPct =
          SWING_COSMETIC_FUZZ_MIN + Math.random() * (SWING_COSMETIC_FUZZ_MAX - SWING_COSMETIC_FUZZ_MIN);
        magnitude *= 1 + (Math.random() < 0.5 ? -1 : 1) * cosmeticFuzzPct;
        delta = direction === "down" ? -magnitude : magnitude;
        source = "swing";
      } else {
        delta = currentPrice * normalTickPct(gapPct, currentPrice, marketAvg, config);
      }
    } else {
      delta = currentPrice * normalTickPct(gapPct, currentPrice, marketAvg, config);
    }

    const newPrice = Math.max(MIN_PRICE, currentPrice + delta);
    insertPriceSnapshot(warrior.id, newPrice, newPrice - currentPrice, source, null, now);
  }

  setLastDriftAt(now);
}

// The normal (non-swing) per-tick move: reversion toward the warrior's own
// (possibly demand-decayed) anchor, a pull toward the current market-wide
// average, and random noise (sized by driftNoisePct, independent of the
// overall cap) - summed and capped at driftMaxPct.
function normalTickPct(gapPct: number, currentPrice: number, marketAvg: number | null, config: StockConfig): number {
  const reversionComponent = gapPct * config.driftReversionStrength;
  const randomComponent = (Math.random() * 2 - 1) * config.driftNoisePct;
  const gravityComponent =
    marketAvg !== null ? ((marketAvg - currentPrice) / currentPrice) * config.marketGravityStrength : 0;
  return Math.max(
    -config.driftMaxPct,
    Math.min(config.driftMaxPct, reversionComponent + randomComponent + gravityComponent),
  );
}

// Self-rescheduling setTimeout (rather than a fixed setInterval) so an admin
// edit to driftIntervalMs in stock_config takes effect from the next tick
// onward, matching the "no restart needed" pattern the rest of stock_config
// already follows. Restart-safety comes from scheduler_state.last_drift_at
// (persisted in the DB), not process uptime - a bounded single catch-up
// tick runs on boot if a full interval elapsed while the server was down,
// but missed ticks are never replayed one-per-interval.
function scheduleNextTick() {
  const tickMs = loadStockConfig().driftIntervalMs;
  setTimeout(() => {
    runDriftTick();
    scheduleNextTick();
  }, tickMs).unref();
}

export function startDriftScheduler() {
  const tickMs = loadStockConfig().driftIntervalMs;
  const lastDriftAt = getLastDriftAt();
  const elapsed = lastDriftAt === null ? Infinity : Date.now() - lastDriftAt;

  if (elapsed >= tickMs) {
    runDriftTick();
    scheduleNextTick();
  } else {
    setTimeout(() => {
      runDriftTick();
      scheduleNextTick();
    }, tickMs - elapsed).unref();
  }
}
