import { Router } from "express";
import {
  AdminActionError,
  adjustAllWalletBalances,
  adjustWalletBalance,
  getAdminWalletAdjustments,
  getAdminWalletOverview,
  getLatestPrice,
  getLinkedWarrior,
  getAdminPriceHistory,
  getOrCreateWallet,
  getPortfolioSnapshotNetWorth,
  getUserById,
  getUserFundHoldingsValue,
  getUserTradeCount,
  getWarriorById,
  getWarriorHolders,
  getWarriorTrades,
  getWarriorVolumeOverview,
  listFundTransactions,
  listHoldingsWithContext,
  listTransactions,
  resetMarketState,
} from "../db";
import { computeRealizedFundPnlByUser, computeRealizedPnlByUser } from "../pnl";
import { rebuildRaidPriceSnapshots } from "../stock";

export const adminMarketRouter = Router();

adminMarketRouter.get("/wallets", (_req, res) => {
  res.json(getAdminWalletOverview());
});

adminMarketRouter.get("/audit-log", (_req, res) => {
  res.json(getAdminWalletAdjustments());
});

adminMarketRouter.post("/wallet-adjust", (req, res) => {
  const { userId, delta, reason } = req.body ?? {};
  if (typeof userId !== "string" || typeof delta !== "number") {
    res.status(400).json({ error: "Request body must include userId (string) and delta (number)" });
    return;
  }
  try {
    const wallet = adjustWalletBalance(userId, delta, req.user!.discord_id, typeof reason === "string" ? reason : null);
    res.json(wallet);
  } catch (err) {
    if (err instanceof AdminActionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminMarketRouter.post("/wallet-adjust-all", (req, res) => {
  const { delta, reason } = req.body ?? {};
  if (typeof delta !== "number") {
    res.status(400).json({ error: "Request body must include delta (number)" });
    return;
  }
  try {
    adjustAllWalletBalances(delta, req.user!.discord_id, typeof reason === "string" ? reason : null);
    res.status(204).end();
  } catch (err) {
    if (err instanceof AdminActionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Full portfolio detail for one user - same shape as the self-service
// GET /api/trading/wallet + /transactions/mine, but admin can target any
// userId. getOrCreateWallet lazily creates a wallet row here just like the
// self-service endpoint does, so viewing a never-traded user's detail isn't
// a new mutate-on-GET risk.
adminMarketRouter.get("/users/:userId", (req, res) => {
  const userId = req.params.userId;
  const targetUser = getUserById(userId);
  if (!targetUser) {
    res.status(404).json({ error: "Unknown user" });
    return;
  }

  const wallet = getOrCreateWallet(userId);
  const holdings = listHoldingsWithContext(userId).map((h) => ({
    playerName: h.player_name,
    server: h.server,
    shares: h.shares,
    costBasisTotal: h.cost_basis_total,
    latestPrice: h.latest_price,
    lastRaidPrice: h.last_raid_price,
    marketValue: h.latest_price !== null ? h.shares * h.latest_price : null,
  }));
  const holdingsValue = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const fundHoldingsValue = getUserFundHoldingsValue(userId);

  const pnlByTxId = computeRealizedPnlByUser(userId);
  const fundPnlByTxId = computeRealizedFundPnlByUser(userId);
  const characterTx = listTransactions({ userId, limit: 500 }).map((tx) => ({
    id: tx.id,
    targetType: "character" as const,
    targetName: tx.player_name,
    side: tx.side,
    shares: tx.shares,
    price: tx.price,
    total: tx.total,
    createdAt: tx.created_at,
    realizedPnl: pnlByTxId.get(tx.id) ?? null,
  }));
  const fundTx = listFundTransactions({ userId, limit: 500 }).map((tx) => ({
    id: tx.id,
    targetType: "fund" as const,
    targetName: tx.fund_name,
    side: tx.side,
    shares: tx.shares,
    price: tx.nav,
    total: tx.total,
    createdAt: tx.created_at,
    realizedPnl: fundPnlByTxId.get(tx.id) ?? null,
  }));
  const transactions = [...characterTx, ...fundTx]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 500);

  const linked = getLinkedWarrior(userId);
  const netWorth = wallet.balance + holdingsValue + fundHoldingsValue;
  const snapshotNetWorth = getPortfolioSnapshotNetWorth(userId);

  res.json({
    userId,
    username: targetUser.username,
    avatar: targetUser.avatar,
    isAdmin: Boolean(targetUser.is_admin),
    linkedWarrior: linked
      ? {
          id: linked.warrior_id,
          playerName: linked.player_name,
          server: linked.server,
          class: linked.class,
        }
      : null,
    firstLoginAt: targetUser.first_login_at,
    lastLoginAt: targetUser.last_login_at,
    balance: wallet.balance,
    holdings,
    fundHoldingsValue,
    netWorth,
    netWorthDelta: snapshotNetWorth !== null ? netWorth - snapshotNetWorth : 0,
    tradeCount: getUserTradeCount(userId),
    transactions,
  });
});

// Reverse cap table - everyone currently holding shares of one warrior,
// ranked by their share of the total coin currently invested in that
// warrior (not their own portfolio concentration).
adminMarketRouter.get("/warriors/:warriorId/holders", (req, res) => {
  const warriorId = Number(req.params.warriorId);
  if (!Number.isInteger(warriorId)) {
    res.status(400).json({ error: "Invalid warrior id" });
    return;
  }
  const warrior = getWarriorById(warriorId);
  if (!warrior) {
    res.status(404).json({ error: "Unknown warrior" });
    return;
  }

  const holders = getWarriorHolders(warriorId);
  const totalInvested = holders.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  res.json({
    playerName: warrior.player_name,
    server: warrior.server,
    latestPrice: getLatestPrice(warriorId),
    totalInvested,
    holders: holders
      .map((h) => ({
        ...h,
        percentOfWarrior: totalInvested > 0 && h.marketValue !== null ? h.marketValue / totalInvested : 0,
      }))
      .sort((a, b) => b.percentOfWarrior - a.percentOfWarrior),
  });
});

// Per-warrior trade volume for the Characters tab's sortable table.
adminMarketRouter.get("/warriors/volume", (_req, res) => {
  res.json(getWarriorVolumeOverview());
});

// All trades against one warrior across every user, for the Characters
// tab's "View Trades" detail card (client paginates this client-side).
adminMarketRouter.get("/warriors/:warriorId/trades", (req, res) => {
  const warriorId = Number(req.params.warriorId);
  if (!Number.isInteger(warriorId)) {
    res.status(400).json({ error: "Invalid warrior id" });
    return;
  }
  const warrior = getWarriorById(warriorId);
  if (!warrior) {
    res.status(404).json({ error: "Unknown warrior" });
    return;
  }
  res.json(getWarriorTrades(warriorId));
});

const PRICE_HISTORY_SOURCES = ["raid", "drift", "swing", "trade"] as const;
type PriceHistorySource = (typeof PRICE_HISTORY_SOURCES)[number];

// Cross-warrior price_snapshots feed for the admin Price History tab.
// Genuinely paginated in SQL (see getAdminPriceHistory's own comment) - drift
// excluded by default via the `sources` param, since it's overwhelmingly the
// largest and least interesting slice of this ever-growing table.
adminMarketRouter.get("/price-history", (req, res) => {
  const sourcesParam = typeof req.query.sources === "string" ? req.query.sources : "raid,swing,trade";
  const sources = sourcesParam
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PriceHistorySource => (PRICE_HISTORY_SOURCES as readonly string[]).includes(s));

  let warriorId: number | undefined;
  if (typeof req.query.warriorId === "string" && req.query.warriorId.trim() !== "") {
    const parsed = Number(req.query.warriorId);
    if (!Number.isInteger(parsed)) {
      res.status(400).json({ error: "Invalid warriorId" });
      return;
    }
    warriorId = parsed;
  }

  const pageParam = typeof req.query.page === "string" ? Number(req.query.page) : 0;
  const page = Number.isInteger(pageParam) && pageParam >= 0 ? pageParam : 0;
  const pageSizeParam = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 50;
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 && pageSizeParam <= 200 ? pageSizeParam : 50;

  const { entries, total } = getAdminPriceHistory({
    sources,
    warriorId,
    limit: pageSize,
    offset: page * pageSize,
  });
  res.json({ entries, total, page, pageSize });
});

adminMarketRouter.post("/reset", (req, res) => {
  if (req.body?.confirmationPhrase !== "RESET MARKET") {
    res.status(400).json({ error: "Confirmation phrase didn't match" });
    return;
  }
  resetMarketState();
  rebuildRaidPriceSnapshots();
  res.status(204).end();
});
