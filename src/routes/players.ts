import { Router } from "express";
import { listAllPlayers, setPlayerHidden } from "../db";

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
  res.status(204).end();
});
