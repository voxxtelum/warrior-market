import { Router } from "express";
import { listUnreadNotifications, markNotificationRead } from "../db";
import { requireAuth } from "../middleware/auth";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, (req, res) => {
  res.json(
    listUnreadNotifications(req.user!.discord_id).map((n) => ({
      id: n.id,
      message: n.message,
      warriorId: n.warrior_id,
      amount: n.amount,
      createdAt: n.created_at,
    }))
  );
});

notificationsRouter.post("/:id/read", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  markNotificationRead(req.user!.discord_id, id);
  res.status(204).end();
});
