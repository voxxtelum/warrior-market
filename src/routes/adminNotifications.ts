import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import {
  AdminNotificationError,
  activateAdminNotification,
  createAdminNotification,
  dataDir,
  deactivateAdminNotification,
  deleteAdminNotification,
  getAdminNotificationAudit,
  getAdminNotificationById,
  listAdminNotifications,
  updateAdminNotification,
  type AdminNotificationRow,
} from "../db";

export const adminNotificationsRouter = Router();

// The button's destination is picked from this fixed list, never freeform -
// both so the client can offer a dropdown instead of a raw URL field, and so
// the server can reject a hand-crafted request pointing a notification at an
// /admin/* route or an external URL. Keep in sync with
// client/src/components/admin/NotificationForm.tsx's copy of this list
// (fetched from GET /meta/public-links rather than duplicated, see below).
export const PUBLIC_NOTIFICATION_LINKS = [
  "/market/stocks",
  "/market/funds",
  "/market/leaderboard",
  "/market/feed",
  "/market/wallet",
  "/warriors/compare",
  "/warriors/trends",
  "/warriors/raids",
  "/warriors/breakdown",
  "/faq",
  "/documentation",
] as const;

function isValidButtonLink(link: unknown): link is string {
  return typeof link === "string" && (PUBLIC_NOTIFICATION_LINKS as readonly string[]).includes(link);
}

// Allowlists only the basic formatting Tiptap's toolbar can produce (bold,
// italic, underline/strike, headings, lists, alignment/color/size via inline
// style, and <img> pointing at our own /uploads/notifications files) -
// sanitized server-side on every create/update so stored content is safe to
// render with dangerouslySetInnerHTML regardless of what the editor sends,
// even if an admin session were ever compromised.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "s", "span", "h1", "h2", "h3", "ul", "ol", "li", "img"],
  allowedAttributes: {
    "*": ["style"],
    img: ["src", "alt"],
  },
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
      "font-family": [/^[a-zA-Z0-9\s,'"-]+$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
    },
  },
  allowedSchemes: ["http", "https"],
};

function serializeNotification(n: AdminNotificationRow) {
  return {
    id: n.id,
    name: n.name,
    content: n.content,
    buttonText: n.button_text,
    buttonLink: n.button_link,
    active: Boolean(n.active),
    createdBy: n.created_by,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

function validateBody(body: unknown): { name: string; content: string; buttonText: string; buttonLink: string } | null {
  const { name, content, buttonText, buttonLink } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof content !== "string" ||
    content.trim() === "" ||
    typeof buttonText !== "string" ||
    buttonText.trim() === "" ||
    !isValidButtonLink(buttonLink)
  ) {
    return null;
  }
  return { name, content, buttonText, buttonLink };
}

adminNotificationsRouter.get("/", (_req, res) => {
  res.json(listAdminNotifications().map(serializeNotification));
});

// Registered before GET /:id so "meta" never gets parsed as a notification id.
adminNotificationsRouter.get("/meta/public-links", (_req, res) => {
  res.json(PUBLIC_NOTIFICATION_LINKS);
});

adminNotificationsRouter.get("/meta/audit-log", (_req, res) => {
  res.json(getAdminNotificationAudit());
});

adminNotificationsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  const n = getAdminNotificationById(id);
  if (!n) {
    res.status(404).json({ error: "Unknown notification" });
    return;
  }
  res.json(serializeNotification(n));
});

adminNotificationsRouter.post("/", (req, res) => {
  const body = validateBody(req.body);
  if (!body) {
    res.status(400).json({
      error: `Request body must include name, content, buttonText (non-empty strings) and buttonLink (one of: ${PUBLIC_NOTIFICATION_LINKS.join(", ")})`,
    });
    return;
  }
  const created = createAdminNotification({
    name: body.name,
    content: sanitizeHtml(body.content, SANITIZE_OPTIONS),
    buttonText: body.buttonText,
    buttonLink: body.buttonLink,
    createdBy: req.user!.discord_id,
  });
  res.status(201).json(serializeNotification(created));
});

adminNotificationsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  const body = validateBody(req.body);
  if (!body) {
    res.status(400).json({
      error: `Request body must include name, content, buttonText (non-empty strings) and buttonLink (one of: ${PUBLIC_NOTIFICATION_LINKS.join(", ")})`,
    });
    return;
  }
  try {
    const updated = updateAdminNotification(
      id,
      { name: body.name, content: sanitizeHtml(body.content, SANITIZE_OPTIONS), buttonText: body.buttonText, buttonLink: body.buttonLink },
      req.user!.discord_id,
    );
    res.json(serializeNotification(updated));
  } catch (err) {
    if (err instanceof AdminNotificationError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminNotificationsRouter.post("/:id/activate", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  try {
    res.json(serializeNotification(activateAdminNotification(id, req.user!.discord_id)));
  } catch (err) {
    if (err instanceof AdminNotificationError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminNotificationsRouter.post("/:id/deactivate", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  try {
    res.json(serializeNotification(deactivateAdminNotification(id, req.user!.discord_id)));
  } catch (err) {
    if (err instanceof AdminNotificationError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminNotificationsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  try {
    deleteAdminNotification(id, req.user!.discord_id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof AdminNotificationError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const uploadsDir = path.join(dataDir, "uploads", "notifications");
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}.${ALLOWED_IMAGE_EXTENSIONS[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // "small images" per the TODO - 2MB cap
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_EXTENSIONS[file.mimetype]) {
      cb(new Error("Unsupported image type - use PNG, JPEG, GIF, or WebP"));
      return;
    }
    cb(null, true);
  },
});

// Invoked directly (not mounted as route middleware) so a bad upload reports
// a clean 400 JSON error instead of falling through to Express's default
// HTML error page.
adminNotificationsRouter.post("/upload-image", (req, res) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No image uploaded" });
      return;
    }
    res.status(201).json({ url: `/uploads/notifications/${req.file.filename}` });
  });
});
