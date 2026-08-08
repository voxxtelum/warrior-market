import { getAnchorPrice, getLastDriftAt, getLatestPrice, insertPriceSnapshot, listWarriorsWithRaidSnapshot, setLastDriftAt } from "./db";
import { loadStockConfig } from "./stock";

// Nudges every warrior's price a small, bounded amount between raids so the
// market has texture on off nights, without turning into a free random walk
// that could wander to 0/infinity over weeks. Each tick is a random step
// PLUS a pull back toward the warrior's anchor price (driftReversionStrength),
// both capped at driftMaxPct. The anchor (warriors.anchor_price, via
// getAnchorPrice) is updated by raid results AND by demand-driven trades
// (see executeTrade() in db.ts) - not just raids like it used to be - so
// trading pressure sticks instead of being erased by the next tick's
// reversion; only random noise still gets pulled back.
export function runDriftTick() {
  const config = loadStockConfig();
  const warriors = listWarriorsWithRaidSnapshot();
  const now = Date.now();

  for (const warrior of warriors) {
    const currentPrice = getLatestPrice(warrior.id);
    const anchorPrice = getAnchorPrice(warrior.id);
    if (currentPrice === null || anchorPrice === null || anchorPrice <= 0) continue;

    const gapPct = (anchorPrice - currentPrice) / anchorPrice;
    const reversionComponent = gapPct * config.driftReversionStrength;
    const randomComponent = (Math.random() * 2 - 1) * config.driftMaxPct;
    const totalPct = Math.max(-config.driftMaxPct, Math.min(config.driftMaxPct, reversionComponent + randomComponent));

    const newPrice = currentPrice * (1 + totalPct);
    insertPriceSnapshot(warrior.id, newPrice, "drift", null, now);
  }

  setLastDriftAt(now);
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
