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

2. Install dependencies (both the server and the `client/` React app) and
   start the dev server:

   ```bash
   npm install
   npm --prefix client install
   npm run dev
   ```

3. Open http://localhost:5173, paste a report URL (e.g.
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
