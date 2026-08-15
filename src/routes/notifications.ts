import { Router } from "express";
import { getActiveNotificationForUser, listUnreadNotifications, markNotificationRead, recordNotificationView } from "../db";
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

// Admin-authored broadcast popup (distinct from the per-user messages above)
// - the single active notification, or null if none is active or this user
// has already dismissed it. Never shown to logged-out users since this route
// is requireAuth-gated like the rest of this file.
notificationsRouter.get("/active", requireAuth, (req, res) => {
  const n = getActiveNotificationForUser(req.user!.discord_id);
  res.json(
    n
      ? {
          id: n.id,
          name: n.name,
          content: n.content,
          buttonText: n.button_text,
          buttonLink: n.button_link,
        }
      : null
  );
});

// Called on both the popup's close-X and its CTA button click - either way
// dismisses it permanently for this user (recordNotificationView is
// idempotent, so a double-call is harmless).
notificationsRouter.post("/:id/viewed", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  recordNotificationView(id, req.user!.discord_id);
  res.status(204).end();
});
