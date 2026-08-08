import { Router } from "express";
import { AdminActionError, adjustWalletBalance, getAdminWalletOverview, resetMarketState } from "../db";
import { rebuildRaidPriceSnapshots } from "../stock";

export const adminMarketRouter = Router();

adminMarketRouter.get("/wallets", (_req, res) => {
  res.json(getAdminWalletOverview());
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

adminMarketRouter.post("/reset", (req, res) => {
  if (req.body?.confirmationPhrase !== "RESET MARKET") {
    res.status(400).json({ error: "Confirmation phrase didn't match" });
    return;
  }
  resetMarketState();
  rebuildRaidPriceSnapshots();
  res.status(204).end();
});
