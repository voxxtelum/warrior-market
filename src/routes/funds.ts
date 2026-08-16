import { Router } from "express";
import {
  FundTradeError,
  executeFundTrade,
  getActiveFunds,
  getCurrentFundNav,
  getFundById,
  getFundConstituents,
  getFundNavAt,
  getFundValueSnapshotsSince,
  getLatestPrice,
  listFundHoldingsWithContext,
  type FundRow,
} from "../db";
import { requireAuth } from "../middleware/auth";

export const fundsRouter = Router();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// Sparkline per funds.md: previous 3 days of NAV, baseline = first point.
// Before the valuation scheduler has ever ticked for a fund (or it's
// younger than 3 days), there's no history yet - fall back to a single
// current-NAV point, which Sparkline already renders as a plain dot (same
// degenerate-case handling the Stock page's sparkline already relies on).
//
// A fund born inside the 3-day window has no snapshot from before its
// first valuation tick - the tick that seeds pool_value can already land
// far from seed_nav (constituents can carry backfilled price history), so
// without an anchor the whole run-up from seed_nav is invisible and the
// line looks flat even though the "All Time" delta shows real movement.
// Prepend seed_nav as a synthetic genesis point in that case only - an
// established fund's snapshots already span the window, and prepending
// seed_nav there would swamp its real recent fluctuation with the
// long-since-irrelevant gap back to its original seed.
function serializeFundSummary(fund: FundRow) {
  const now = Date.now();
  const nav = getCurrentFundNav(fund);
  const navSevenDaysAgo = getFundNavAt(fund.id, now - SEVEN_DAYS_MS);
  const sparklineRows = getFundValueSnapshotsSince(fund.id, now - THREE_DAYS_MS);
  let sparkline = sparklineRows.length > 0 ? sparklineRows.map((r) => r.nav) : [nav];
  if (fund.created_at > now - THREE_DAYS_MS) {
    sparkline = [fund.seed_nav, ...sparkline];
  }
  return {
    id: fund.id,
    name: fund.name,
    risk: fund.risk,
    feePct: fund.fee_pct,
    taxPct: fund.tax_pct,
    description: fund.description,
    nav,
    last7DaysDelta: nav - (navSevenDaysAgo ?? fund.seed_nav),
    allTimeDelta: nav - fund.seed_nav,
    sparkline,
  };
}

fundsRouter.get("/", (_req, res) => {
  res.json(getActiveFunds().map(serializeFundSummary));
});

// Registered before "/:id" - Express matches routes in order, and "/:id"
// would otherwise swallow "/positions" as if id === "positions".
fundsRouter.get("/positions", requireAuth, (req, res) => {
  res.json(listFundHoldingsWithContext(req.user!.discord_id));
});

fundsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid fund id" });
    return;
  }
  const fund = getFundById(id);
  if (!fund || fund.deleted_at !== null) {
    res.status(404).json({ error: "Unknown fund" });
    return;
  }

  // Notional %-of-basket by current market value (stock_count * price),
  // distinct from the fund's actual pool_value - the gain/loss multiplier
  // mechanic detaches NAV from literal ownership, so this is purely a
  // "what does the basket look like right now" display figure (matches
  // funds.md's example row: name, # shares, % of fund value, price).
  const constituents = getFundConstituents(id).map((c) => ({
    playerName: c.player_name,
    server: c.server,
    stockCount: c.stock_count,
    price: getLatestPrice(c.warrior_id),
  }));
  const totalValue = constituents.reduce(
    (sum, c) => sum + (c.price !== null ? c.price * c.stockCount : 0),
    0,
  );

  res.json({
    ...serializeFundSummary(fund),
    constituents: constituents.map((c) => ({
      ...c,
      percentOfFund: totalValue > 0 && c.price !== null ? (c.price * c.stockCount) / totalValue : 0,
    })),
  });
});

fundsRouter.post("/:id/trade", requireAuth, (req, res) => {
  const fundId = Number(req.params.id);
  const { side, amount } = req.body ?? {};
  if (!Number.isInteger(fundId) || (side !== "buy" && side !== "sell") || typeof amount !== "number") {
    res.status(400).json({ error: "Request body must include side ('buy'|'sell'), amount" });
    return;
  }
  try {
    const tx = executeFundTrade(req.user!.discord_id, fundId, side, amount);
    res.status(201).json({ shares: tx.shares, nav: tx.nav, total: tx.total, fee: tx.fee, tax: tx.tax });
  } catch (err) {
    if (err instanceof FundTradeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
