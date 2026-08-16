import { Router } from "express";
import { listAllPlayers, setPlayerHidden } from "../db";
import { backfillRaidPriceSnapshotsForWarrior } from "../stock";

export const playersRouter = Router();

playersRouter.get("/", (_req, res) => {
  res.json(listAllPlayers());
});

playersRouter.post("/hidden", (req, res) => {
  const { player_name, server, hidden } = req.body ?? {};
  if (typeof player_name !== "string" || typeof server !== "string" || typeof hidden !== "boolean") {
    res.status(400).json({ error: "Request body must include player_name (string), server (string), hidden (boolean)" });
    return;
  }
  setPlayerHidden(player_name, server, hidden);
  // Raid price computation excludes hidden players entirely (NOT_HIDDEN_CLAUSE
  // in db.ts), so a newly-unhidden warrior has zero price_snapshots from any
  // report processed while they were hidden - getLatestPrice stays null and
  // they're untradeable until this backfills their raid history. Scoped to
  // just this warrior (not rebuildRaidPriceSnapshots' global rebuild), which
  // would otherwise overwrite every other warrior's raid-sourced price
  // history with disconnected fundamentals-only values.
  if (!hidden) {
    backfillRaidPriceSnapshotsForWarrior(player_name, server);
  }
  res.status(204).end();
});
