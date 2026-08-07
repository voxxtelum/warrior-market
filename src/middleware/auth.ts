import type { NextFunction, Request, Response } from "express";
import { getSessionUser, type UserRow } from "../db";

declare global {
  namespace Express {
    interface Request {
      user?: UserRow | null;
    }
  }
}

export const SESSION_COOKIE = "session";

// Runs on every request: reads the session cookie (if any), looks up the
// session + joins users for a fresh is_admin value, and sets req.user. Never
// rejects a request itself - requireAuth/requireAdmin do that - so public
// routes can still read req.user (e.g. to personalize a response) without
// being forced through a guard.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const sessionId = req.signedCookies?.[SESSION_COOKIE];
  req.user = sessionId ? getSessionUser(sessionId) : null;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (!req.user.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
