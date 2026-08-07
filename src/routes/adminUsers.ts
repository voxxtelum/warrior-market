import { Router } from "express";
import { listUsers, setUserAdmin } from "../db";

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
