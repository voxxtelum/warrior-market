import { Router } from "express";
import {
  AdminActionError,
  adjustWalletBalance,
  getAdminWalletAdjustments,
  getAdminWalletOverview,
  getLatestPrice,
  getLinkedWarrior,
  getOrCreateWallet,
  getUserById,
  getWarriorById,
  getWarriorHolders,
  listHoldingsWithContext,
  listTransactions,
  resetMarketState,
} from "../db";
import { computeRealizedPnlByUser } from "../pnl";
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

  const pnlByTxId = computeRealizedPnlByUser(userId);
  const transactions = listTransactions({ userId, limit: 500 }).map((tx) => ({
    id: tx.id,
    playerName: tx.player_name,
    server: tx.server,
    side: tx.side,
    shares: tx.shares,
    price: tx.price,
    total: tx.total,
    createdAt: tx.created_at,
    realizedPnl: pnlByTxId.get(tx.id) ?? null,
  }));

  const linked = getLinkedWarrior(userId);

  res.json({
    userId,
    username: targetUser.username,
    avatar: targetUser.avatar,
    linkedWarrior: linked
      ? { playerName: linked.player_name, server: linked.server }
      : null,
    balance: wallet.balance,
    holdings,
    netWorth: wallet.balance + holdingsValue,
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

adminMarketRouter.post("/reset", (req, res) => {
  if (req.body?.confirmationPhrase !== "RESET MARKET") {
    res.status(400).json({ error: "Confirmation phrase didn't match" });
    return;
  }
  resetMarketState();
  rebuildRaidPriceSnapshots();
  res.status(204).end();
});
