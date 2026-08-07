import { randomBytes } from "node:crypto";
import { Router } from "express";
import { buildAuthorizeUrl, completeDiscordLogin, discordAvatarUrl } from "../discordAuth";
import { createSession, deleteSession, upsertUserFromLogin } from "../db";
import { SESSION_COOKIE } from "../middleware/auth";

export const authRouter = Router();

const OAUTH_STATE_COOKIE = "oauth_state";
const isProd = process.env.NODE_ENV === "production";

authRouter.get("/discord", (_req, res) => {
  try {
    const state = randomBytes(16).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      signed: true,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(buildAuthorizeUrl(state));
  } catch (err) {
    res.status(500).send(`Login is not configured: ${err instanceof Error ? err.message : String(err)}`);
  }
});

authRouter.get("/discord/callback", async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.signedCookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE);

  if (typeof code !== "string" || typeof state !== "string" || !expectedState || state !== expectedState) {
    res.status(400).send("Login failed: invalid or expired login attempt. Please try again.");
    return;
  }

  try {
    const discordUser = await completeDiscordLogin(code);
    const isBootstrapAdmin = discordUser.id === process.env.ADMIN_DISCORD_ID;
    upsertUserFromLogin(
      discordUser.id,
      discordUser.username,
      discordAvatarUrl(discordUser.id, discordUser.avatar),
      isBootstrapAdmin
    );

    const { sessionId, expiresAt } = createSession(discordUser.id);
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      signed: true,
      maxAge: expiresAt - Date.now(),
    });
    res.redirect("/admin");
  } catch (err) {
    res.status(502).send(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

authRouter.post("/logout", (req, res) => {
  const sessionId = req.signedCookies?.[SESSION_COOKIE];
  if (sessionId) deleteSession(sessionId);
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      discordId: req.user.discord_id,
      username: req.user.username,
      avatar: req.user.avatar,
      isAdmin: Boolean(req.user.is_admin),
    },
  });
});
