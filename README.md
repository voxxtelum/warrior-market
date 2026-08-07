# Warrior Log Dashboard

Local tool for tracking warrior ability casts and damage across weekly Classic
WoW raid logs, using the [Warcraft Logs API v2](https://www.warcraftlogs.com/api/docs).

## Setup

1. Copy `.env.example` to `.env` and fill in your Warcraft Logs API v2 client
   credentials (create one at warcraftlogs.com under your profile's
   "API Clients" if you don't have one yet):

   ```
   WCL_CLIENT_ID=...
   WCL_CLIENT_SECRET=...
   ```

2. Register a Discord application for admin login at
   [discord.com/developers/applications](https://discord.com/developers/applications)
   → New Application → OAuth2 page:
   - Copy the **Client ID** and **Client Secret** into `.env` as
     `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
   - Under "Redirects", add `http://localhost:3000/api/auth/discord/callback`
     for local dev, and your production callback URL (e.g.
     `https://yourdomain.com/api/auth/discord/callback`) once you've deployed.
   - Set `DISCORD_REDIRECT_URI` in `.env` to whichever one you're currently
     running against.
   - Find your own Discord user ID (Discord app → User Settings → Advanced →
     enable Developer Mode, then right-click your name anywhere → Copy User
     ID) and set it as `ADMIN_DISCORD_ID` in `.env` — that account is always
     granted admin on login.
   - Set `SESSION_COOKIE_SECRET` to any long random string.

3. Install dependencies (both the server and the `client/` React app) and
   start the dev server:

   ```bash
   npm install
   npm --prefix client install
   npm run dev
   ```

4. Open http://localhost:5173, paste a report URL (e.g.
   `https://vanilla.warcraftlogs.com/reports/QwVWkpGh9LmBMHTF`) on the Add
   Report page, then browse the Compare page.

## How it works

- Pasting a report URL fetches that report's kill fights plus warrior cast
  and damage tables from the WCL GraphQL API, and stores them in a local
  SQLite file at `data/warrior.db` (via Node's built-in `node:sqlite`, so no
  native build step is required).
- Re-adding the same report URL refreshes its data instead of duplicating it.
- The Compare page groups reports by raid zone and pivots casts/damage into
  one column per week. `config.json` lists the abilities shown by default;
  any other ability a warrior cast is still stored and selectable from the
  dropdown.

## Admin access

Stocks/Compare/Trends/Raid Overview are public — no login needed. Everything
under `/admin` (add reports, hide players, tune stock scoring, manage users)
requires logging in with Discord and being flagged as an admin.

- Log in via the hamburger menu ("Log in with Discord") on any page.
- The Discord account whose ID matches `ADMIN_DISCORD_ID` is **always** an
  admin, on every login — this is a self-healing bootstrap so you can never
  lock yourself out, even if that flag is ever changed by hand in the DB.
- Anyone else who logs in is recorded (visible on `/admin/users`) but starts
  as a normal, non-admin account. Grant or revoke admin for any user from
  that page — it takes effect immediately on their next request, no restart
  needed.
- Enforcement is server-side (every mutating/admin API route checks the
  session), not just hidden UI.

## Deployment (Docker + Cloudflare Tunnel)

This runs well as a single Docker container on an always-on home
server (e.g. Unraid), exposed publicly through a Cloudflare Tunnel — no
port-forwarding, no exposed public IP, and Cloudflare's edge handles TLS for
you automatically.

1. **Build and run the container:**

   ```bash
   docker compose up -d --build
   ```

   `data/` is bind-mounted into the container so the SQLite database
   persists across rebuilds/restarts. Provide production env vars via a
   `.env` file next to `docker-compose.yml` (same keys as above, plus set
   `NODE_ENV=production` so session cookies require HTTPS, and update
   `DISCORD_REDIRECT_URI` to your public domain's callback URL).

2. **Create a Cloudflare Tunnel:** Cloudflare Zero Trust dashboard → Networks
   → Tunnels → Create a tunnel. Copy the generated token into `.env` as
   `TUNNEL_TOKEN` (read by the `cloudflared` service in
   `docker-compose.yml`). Add a public hostname in the tunnel's ingress rules
   pointing at `http://app:3000` (the `app` service's name on the shared
   Docker network — the tunnel and the app never need a port published to
   the host).

3. Point that public hostname at your Discord app's production redirect URI
   (step 2 above), and you're live.

On Unraid specifically, this can run via the Docker Compose Manager plugin,
or by SSHing in and running `docker compose up -d --build` from the repo
directory directly — either way works the same.
