import { Router } from "express";
import {
  createOrUpdateManualWarrior,
  LinkError,
  linkUserToWarrior,
  listWarriors,
  setUserAdmin,
  unlinkUser,
} from "../db";

export const adminUsersRouter = Router();

const REALMS = ["Atiesh", "Azuresong", "Myzrael", "OldBlanchy"];
const CLASSES = [
  "Druid",
  "Hunter",
  "Mage",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
];

adminUsersRouter.post("/:discordId/admin", (req, res) => {
  const isAdmin = req.body?.isAdmin;
  if (typeof isAdmin !== "boolean") {
    res.status(400).json({ error: "Request body must include isAdmin (boolean)" });
    return;
  }
  setUserAdmin(req.params.discordId, isAdmin);
  res.status(204).end();
});

adminUsersRouter.get("/warriors", (_req, res) => {
  res.json(
    listWarriors().map((w) => ({
      id: w.id,
      playerName: w.player_name,
      server: w.server,
      class: w.class,
    })),
  );
});

adminUsersRouter.post("/:discordId/link", (req, res) => {
  const warriorId = req.body?.warriorId;
  if (typeof warriorId !== "number") {
    res.status(400).json({ error: "Request body must include warriorId (number)" });
    return;
  }
  try {
    linkUserToWarrior(req.params.discordId, warriorId);
    res.status(204).end();
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminUsersRouter.post("/:discordId/link-manual", (req, res) => {
  const playerName = typeof req.body?.playerName === "string" ? req.body.playerName.trim() : "";
  const server = req.body?.server;
  const characterClass = req.body?.class;
  if (!playerName) {
    res.status(400).json({ error: "Request body must include a non-empty playerName" });
    return;
  }
  if (!REALMS.includes(server)) {
    res.status(400).json({ error: `server must be one of: ${REALMS.join(", ")}` });
    return;
  }
  if (!CLASSES.includes(characterClass)) {
    res.status(400).json({ error: `class must be one of: ${CLASSES.join(", ")}` });
    return;
  }
  try {
    const warriorId = createOrUpdateManualWarrior(playerName, server, characterClass);
    linkUserToWarrior(req.params.discordId, warriorId);
    res.status(204).end();
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminUsersRouter.post("/:discordId/unlink", (req, res) => {
  unlinkUser(req.params.discordId);
  res.status(204).end();
});
