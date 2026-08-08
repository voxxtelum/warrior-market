import { Router } from "express";
import {
  executeTrade,
  getLatestPrice,
  getLeaderboard,
  getOrCreateWallet,
  getWarriorId,
  listHoldingsWithContext,
  listTransactions,
  TradeError,
  type TransactionWithContext,
} from "../db";
import { requireAuth } from "../middleware/auth";

export const tradingRouter = Router();

// Hides identity on every row unless the viewer is an admin or the trade's
// own participant - the one place anonymization happens, so every route
// below (public feed, own history, admin views) stays in sync automatically.
function serializeTransaction(
  tx: TransactionWithContext,
  viewer: { discord_id: string; is_admin: number } | null | undefined
) {
  const revealIdentity = Boolean(viewer && (viewer.is_admin || viewer.discord_id === tx.user_id));
  return {
    id: tx.id,
    playerName: tx.player_name,
    server: tx.server,
    side: tx.side,
    shares: tx.shares,
    price: tx.price,
    total: tx.total,
    createdAt: tx.created_at,
    username: revealIdentity ? tx.username : null,
    avatar: revealIdentity ? tx.avatar : null,
    isMine: Boolean(viewer && viewer.discord_id === tx.user_id),
  };
}

tradingRouter.get("/wallet", requireAuth, (req, res) => {
  const wallet = getOrCreateWallet(req.user!.discord_id);
  const holdings = listHoldingsWithContext(req.user!.discord_id).map((h) => ({
    playerName: h.player_name,
    server: h.server,
    shares: h.shares,
    costBasisTotal: h.cost_basis_total,
    latestPrice: h.latest_price,
    marketValue: h.latest_price !== null ? h.shares * h.latest_price : null,
  }));
  const holdingsValue = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  res.json({
    balance: wallet.balance,
    holdings,
    netWorth: wallet.balance + holdingsValue,
  });
});

tradingRouter.post("/trade", requireAuth, (req, res) => {
  const { playerName, server, side, amount } = req.body ?? {};
  if (
    typeof playerName !== "string" ||
    typeof server !== "string" ||
    (side !== "buy" && side !== "sell") ||
    typeof amount !== "number"
  ) {
    res.status(400).json({ error: "Request body must include playerName, server, side ('buy'|'sell'), amount" });
    return;
  }

  const warriorId = getWarriorId(playerName, server);
  if (warriorId === null) {
    res.status(404).json({ error: "Unknown warrior" });
    return;
  }

  try {
    const tx = executeTrade(req.user!.discord_id, warriorId, side, amount);
    res.status(201).json({ shares: tx.shares, price: tx.price, total: tx.total });
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

tradingRouter.get("/transactions/mine", requireAuth, (req, res) => {
  const rows = listTransactions({ userId: req.user!.discord_id, limit: 200 });
  res.json(rows.map((tx) => serializeTransaction(tx, req.user)));
});

// Public - identity is anonymized per serializeTransaction unless the
// viewer (possibly logged out, req.user may be null) is an admin or the
// trade's own participant.
tradingRouter.get("/feed", (req, res) => {
  const rows = listTransactions({ limit: 100 });
  res.json(rows.map((tx) => serializeTransaction(tx, req.user)));
});

tradingRouter.get("/leaderboard", (_req, res) => {
  res.json(
    getLeaderboard().map((e) => ({
      username: e.username,
      avatar: e.avatar,
      balance: e.balance,
      holdingsValue: e.holdingsValue,
      netWorth: e.netWorth,
    }))
  );
});

tradingRouter.get("/price/:playerName/:server", (req, res) => {
  const warriorId = getWarriorId(req.params.playerName, req.params.server);
  if (warriorId === null) {
    res.status(404).json({ error: "Unknown warrior" });
    return;
  }
  res.json({ price: getLatestPrice(warriorId) });
});
