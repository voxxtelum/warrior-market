import { Router } from "express";
import { LinkError, linkUserToWarrior, listUsers, listWarriors, setUserAdmin, unlinkUser } from "../db";

export const adminUsersRouter = Router();

adminUsersRouter.get("/", (_req, res) => {
  res.json(
    listUsers().map((u) => ({
      discordId: u.discord_id,
      username: u.username,
      avatar: u.avatar,
      isAdmin: Boolean(u.is_admin),
      firstLoginAt: u.first_login_at,
      lastLoginAt: u.last_login_at,
      linkedWarrior:
        u.linked_warrior_id !== null
          ? { id: u.linked_warrior_id, playerName: u.linked_player_name, server: u.linked_server }
          : null,
    }))
  );
});

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
  res.json(listWarriors().map((w) => ({ id: w.id, playerName: w.player_name, server: w.server })));
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

adminUsersRouter.post("/:discordId/unlink", (req, res) => {
  unlinkUser(req.params.discordId);
  res.status(204).end();
});
