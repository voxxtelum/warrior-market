import {
  getActiveFunds,
  getAllLatestWarriorPrices,
  getFundConstituents,
  getLastFundValuationAt,
  recordFundValuationTick,
  setLastFundValuationAt,
} from "./db";
import { loadStockConfig } from "./stock";

// Periodic fund NAV recompute (see funds.md): for every active fund, sums
// each constituent's price change since the last tick weighted by its
// configured stock_count, applies gainMultiplier/lossMultiplier depending
// on the sign of that sum, and adds the result to the fund's pool_value -
// NAV-per-share is always pool_value / shares_outstanding (see
// getCurrentFundNav in db.ts), never stored directly. A fund with 0 shares
// outstanding (nobody's bought in yet) or 0 constituents is a safe no-op.
//
// Mirrors drift.ts's self-rescheduling setTimeout + scheduler_state
// restart-safety pattern - only the scheduling skeleton is shared, none of
// drift's per-warrior random-walk/anchor-decay math applies here, since a
// fund's value is a derived rollup of its basket, not an independently
// drifting price.
export function runFundValuationTick(): void {
  const funds = getActiveFunds();
  if (funds.length === 0) return;

  const now = Date.now();
  const latestPrices = getAllLatestWarriorPrices();

  for (const fund of funds) {
    const constituents = getFundConstituents(fund.id);
    if (constituents.length === 0) continue;

    let rawChange = 0;
    const priceUpdates: { constituentId: number; price: number }[] = [];
    for (const c of constituents) {
      const price = latestPrices.get(c.warrior_id);
      if (price === undefined) continue; // untradeable this tick, skip its contribution
      const baseline = c.last_snapshot_price ?? price;
      rawChange += (price - baseline) * c.stock_count;
      priceUpdates.push({ constituentId: c.id, price });
    }

    let newPoolValue: number | null = null;
    if (fund.shares_outstanding > 0) {
      const adjusted = rawChange >= 0 ? rawChange * fund.gain_multiplier : rawChange * fund.loss_multiplier;
      newPoolValue = Math.max(0, fund.pool_value + adjusted);
    }

    recordFundValuationTick(fund, newPoolValue, priceUpdates, now);
  }

  setLastFundValuationAt(now);
}

function scheduleNextFundTick() {
  const tickMs = loadStockConfig().fundValuationIntervalMs;
  setTimeout(() => {
    runFundValuationTick();
    scheduleNextFundTick();
  }, tickMs).unref();
}

export function startFundValuationScheduler() {
  const tickMs = loadStockConfig().fundValuationIntervalMs;
  const lastTickAt = getLastFundValuationAt();
  const elapsed = lastTickAt === null ? Infinity : Date.now() - lastTickAt;

  if (elapsed >= tickMs) {
    runFundValuationTick();
    scheduleNextFundTick();
  } else {
    setTimeout(() => {
      runFundValuationTick();
      scheduleNextFundTick();
    }, tickMs - elapsed).unref();
  }
}
