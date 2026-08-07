import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "warrior.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    zone TEXT,
    start_time INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fights (
    report_code TEXT NOT NULL,
    fight_id INTEGER NOT NULL,
    encounter_id INTEGER,
    encounter_name TEXT,
    kill INTEGER,
    PRIMARY KEY (report_code, fight_id)
  );
`);

// Tank detection needs each report's overall duration (end_time - start_time)
// to compute a "% of the raid spent taking damage" uptime figure. Older DBs
// predate this column - add it in place (existing rows just get end_time =
// NULL until re-ingested, no need to drop reports/fights for this one).
const reportsHasEndTime = (db.prepare(`PRAGMA table_info(reports)`).all() as unknown as { name: string }[]).some(
  (c) => c.name === "end_time"
);
if (!reportsHasEndTime) {
  db.exec(`ALTER TABLE reports ADD COLUMN end_time INTEGER`);
}

// Two different characters can share the same display name (seen in this
// guild across different realms), so player identity is (player_name,
// server), not name alone - the `server` column below is part of the
// primary key on both tables. Older DBs predate this column; migrate by
// dropping and recreating (casts/damage are fully re-derivable by re-adding
// each report, unlike reports/fights which we keep).
const castsHasServer = (db.prepare(`PRAGMA table_info(casts)`).all() as unknown as { name: string }[]).some(
  (c) => c.name === "server"
);
if (!castsHasServer) {
  db.exec(`DROP TABLE IF EXISTS casts; DROP TABLE IF EXISTS damage;`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS casts (
    report_code TEXT NOT NULL,
    player_name TEXT NOT NULL,
    server TEXT NOT NULL,
    class TEXT,
    ability_id INTEGER NOT NULL,
    ability_name TEXT NOT NULL,
    cast_count INTEGER NOT NULL,
    PRIMARY KEY (report_code, player_name, server, ability_id)
  );

  CREATE TABLE IF NOT EXISTS damage (
    report_code TEXT NOT NULL,
    player_name TEXT NOT NULL,
    server TEXT NOT NULL,
    class TEXT,
    total_damage INTEGER NOT NULL,
    active_time INTEGER,
    PRIMARY KEY (report_code, player_name, server)
  );

  CREATE TABLE IF NOT EXISTS hidden_players (
    player_name TEXT NOT NULL,
    server TEXT NOT NULL,
    PRIMARY KEY (player_name, server)
  );

  CREATE TABLE IF NOT EXISTS damage_taken (
    report_code TEXT NOT NULL,
    player_name TEXT NOT NULL,
    server TEXT NOT NULL,
    class TEXT,
    total_taken INTEGER NOT NULL,
    active_time INTEGER,
    PRIMARY KEY (report_code, player_name, server)
  );

  CREATE TABLE IF NOT EXISTS stock_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    discord_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    first_login_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Seed the stock scoring config on first run, since it now lives entirely in
// the DB (tunable from the admin page) rather than config.json.
const DEFAULT_STOCK_CONFIG = {
  abilities: [
    { id: 23894, name: "Bloodthirst", weight: 20, bucket: "all" },
    { id: 25286, name: "Heroic Strike", weight: 4, bucket: "dps" },
    { id: 1719, name: "Recklessness", weight: 5, bucket: "dps" },
    { id: 12328, name: "Death Wish", weight: 3, bucket: "dps" },
    { id: 1680, name: "Whirlwind", weight: 2, bucket: "dps" },
    { id: 11597, name: "Sunder Armor", weight: 1, bucket: "tank" },
    { id: 11556, name: "Demoralizing Shout", weight: 0.1, bucket: "tank" },
    { id: 25288, name: "Revenge", weight: 1, bucket: "tank" },
  ],
  tankTopN: 4,
  tankMinUptimePct: 0.2,
  minBucketSize: 2,
  coldStartReports: 3,
  dpsEmaAlpha: 0.15,
  damageWeight: 0.6,
  castWeight: 0.4,
  priceSensitivity: 0.05,
  startingPrice: 100,
  newPlayerGraceReports: 2,
  newPlayerPenaltyLeniency: 0.3,
  minAttendancePct: 0.3,
};
const hasStockConfig = db.prepare(`SELECT 1 FROM stock_config WHERE id = 1`).get();
if (!hasStockConfig) {
  db.prepare(`INSERT INTO stock_config (id, data) VALUES (1, ?)`).run(JSON.stringify(DEFAULT_STOCK_CONFIG));
}

export interface ReportRow {
  code: string;
  title: string;
  zone: string | null;
  start_time: number;
  end_time: number | null;
  fetched_at: number;
}

export interface FightRow {
  report_code: string;
  fight_id: number;
  encounter_id: number | null;
  encounter_name: string | null;
  kill: number | null;
}

export interface CastRow {
  report_code: string;
  player_name: string;
  server: string;
  class: string | null;
  ability_id: number;
  ability_name: string;
  cast_count: number;
}

export interface DamageRow {
  report_code: string;
  player_name: string;
  server: string;
  class: string | null;
  total_damage: number;
  active_time: number | null;
}

export interface DamageTakenRow {
  report_code: string;
  player_name: string;
  server: string;
  class: string | null;
  total_taken: number;
  active_time: number | null;
}

export function upsertReport(data: {
  report: ReportRow;
  fights: FightRow[];
  casts: CastRow[];
  damage: DamageRow[];
  damageTaken: DamageTakenRow[];
}) {
  const insertReport = db.prepare(`
    INSERT INTO reports (code, title, zone, start_time, end_time, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      title = excluded.title,
      zone = excluded.zone,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      fetched_at = excluded.fetched_at
  `);

  const deleteFights = db.prepare(`DELETE FROM fights WHERE report_code = ?`);
  const deleteCasts = db.prepare(`DELETE FROM casts WHERE report_code = ?`);
  const deleteDamage = db.prepare(`DELETE FROM damage WHERE report_code = ?`);
  const deleteDamageTaken = db.prepare(`DELETE FROM damage_taken WHERE report_code = ?`);

  const insertFight = db.prepare(`
    INSERT INTO fights (report_code, fight_id, encounter_id, encounter_name, kill)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertCast = db.prepare(`
    INSERT INTO casts (report_code, player_name, server, class, ability_id, ability_name, cast_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDamage = db.prepare(`
    INSERT INTO damage (report_code, player_name, server, class, total_damage, active_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertDamageTaken = db.prepare(`
    INSERT INTO damage_taken (report_code, player_name, server, class, total_taken, active_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    insertReport.run(
      data.report.code,
      data.report.title,
      data.report.zone,
      data.report.start_time,
      data.report.end_time,
      data.report.fetched_at
    );

    deleteFights.run(data.report.code);
    deleteCasts.run(data.report.code);
    deleteDamage.run(data.report.code);
    deleteDamageTaken.run(data.report.code);

    for (const f of data.fights) {
      insertFight.run(f.report_code, f.fight_id, f.encounter_id, f.encounter_name, f.kill);
    }
    for (const c of data.casts) {
      insertCast.run(c.report_code, c.player_name, c.server, c.class, c.ability_id, c.ability_name, c.cast_count);
    }
    for (const d of data.damage) {
      insertDamage.run(d.report_code, d.player_name, d.server, d.class, d.total_damage, d.active_time);
    }
    for (const d of data.damageTaken) {
      insertDamageTaken.run(d.report_code, d.player_name, d.server, d.class, d.total_taken, d.active_time);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listReports(): ReportRow[] {
  return db.prepare(`SELECT * FROM reports ORDER BY start_time ASC`).all() as unknown as ReportRow[];
}

export function listZones(): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT zone FROM reports WHERE zone IS NOT NULL ORDER BY zone ASC`)
    .all() as unknown as { zone: string }[];
  return rows.map((r) => r.zone);
}

export function getReportDetail(code: string) {
  const report = db.prepare(`SELECT * FROM reports WHERE code = ?`).get(code) as unknown as ReportRow | undefined;
  const fights = db.prepare(`SELECT * FROM fights WHERE report_code = ?`).all(code) as unknown as FightRow[];
  const casts = db.prepare(`SELECT * FROM casts WHERE report_code = ? ORDER BY player_name, ability_name`).all(code) as unknown as CastRow[];
  const damage = db.prepare(`SELECT * FROM damage WHERE report_code = ? ORDER BY total_damage DESC`).all(code) as unknown as DamageRow[];
  return { report, fights, casts, damage };
}

// Hidden players are excluded here rather than filtered client-side so that
// every consumer of these rows (currently just /api/compare, which both the
// Compare and Trends pages read) automatically respects the hidden list
// without needing its own copy of the filtering logic.
const NOT_HIDDEN_CLAUSE = `NOT EXISTS (
  SELECT 1 FROM hidden_players hp
  WHERE hp.player_name = t.player_name AND hp.server = t.server
)`;

export function getCastsForZone(zone: string): (CastRow & { start_time: number })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`
    )
    .all(zone) as unknown as (CastRow & { start_time: number })[];
}

export function getDamageForZone(zone: string): (DamageRow & { start_time: number })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time
       FROM damage t
       JOIN reports r ON r.code = t.report_code
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`
    )
    .all(zone) as unknown as (DamageRow & { start_time: number })[];
}

export function getReportsForZone(zone: string): ReportRow[] {
  return db.prepare(`SELECT * FROM reports WHERE zone = ? ORDER BY start_time ASC`).all(zone) as unknown as ReportRow[];
}

// Unscoped-by-zone variants for the stock market calculation, which blends
// signals across every instance a player has raided.
export function getAllCasts(): (CastRow & { start_time: number; zone: string | null })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`
    )
    .all() as unknown as (CastRow & { start_time: number; zone: string | null })[];
}

export function getAllDamage(): (DamageRow & { start_time: number; zone: string | null })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`
    )
    .all() as unknown as (DamageRow & { start_time: number; zone: string | null })[];
}

export function getAllDamageTaken(): (DamageTakenRow & { start_time: number; zone: string | null })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage_taken t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`
    )
    .all() as unknown as (DamageTakenRow & { start_time: number; zone: string | null })[];
}

export interface PlayerRow {
  player_name: string;
  server: string;
  hidden: number;
}

export function listAllPlayers(): PlayerRow[] {
  return db
    .prepare(
      `SELECT player_name, server,
         EXISTS(
           SELECT 1 FROM hidden_players hp
           WHERE hp.player_name = p.player_name AND hp.server = p.server
         ) AS hidden
       FROM (
         SELECT player_name, server FROM casts
         UNION
         SELECT player_name, server FROM damage
       ) p
       ORDER BY player_name ASC, server ASC`
    )
    .all() as unknown as PlayerRow[];
}

export function setPlayerHidden(playerName: string, server: string, hidden: boolean) {
  if (hidden) {
    db.prepare(`INSERT OR IGNORE INTO hidden_players (player_name, server) VALUES (?, ?)`).run(playerName, server);
  } else {
    db.prepare(`DELETE FROM hidden_players WHERE player_name = ? AND server = ?`).run(playerName, server);
  }
}

// Stock scoring config lives entirely in the DB (seeded with
// DEFAULT_STOCK_CONFIG on first run) so it can be tuned from the admin page
// without a server restart - stock.ts re-reads it on every computeStock()
// call rather than caching it at import time.
export function getStockConfigRaw(): string | null {
  const row = db.prepare(`SELECT data FROM stock_config WHERE id = 1`).get() as unknown as { data: string } | undefined;
  return row ? row.data : null;
}

export function setStockConfigRaw(json: string) {
  db.prepare(`
    INSERT INTO stock_config (id, data) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `).run(json);
}

export interface UserRow {
  discord_id: string;
  username: string;
  avatar: string | null;
  is_admin: number;
  first_login_at: number;
  last_login_at: number;
}

// Upserts the logged-in user's profile on every login. is_admin is left
// alone on conflict (so an admin's manual promote/demote via the users page
// sticks across logins) UNLESS isBootstrapAdmin is true - that ID (the
// deploy-time ADMIN_DISCORD_ID) is force-set back to admin on every single
// login, so the deploying user can never lock themselves out.
export function upsertUserFromLogin(
  discordId: string,
  username: string,
  avatar: string | null,
  isBootstrapAdmin: boolean
): UserRow {
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (discord_id, username, avatar, is_admin, first_login_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      avatar = excluded.avatar,
      last_login_at = excluded.last_login_at
  `).run(discordId, username, avatar, isBootstrapAdmin ? 1 : 0, now, now);

  if (isBootstrapAdmin) {
    db.prepare(`UPDATE users SET is_admin = 1 WHERE discord_id = ?`).run(discordId);
  }

  return db.prepare(`SELECT * FROM users WHERE discord_id = ?`).get(discordId) as unknown as UserRow;
}

export function listUsers(): UserRow[] {
  return db.prepare(`SELECT * FROM users ORDER BY last_login_at DESC`).all() as unknown as UserRow[];
}

export function setUserAdmin(discordId: string, isAdmin: boolean) {
  db.prepare(`UPDATE users SET is_admin = ? WHERE discord_id = ?`).run(isAdmin ? 1 : 0, discordId);
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(discordId: string): { sessionId: string; expiresAt: number } {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());

  const sessionId = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(`INSERT INTO sessions (session_id, discord_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
    sessionId,
    discordId,
    now,
    expiresAt
  );
  return { sessionId, expiresAt };
}

// Joins through to `users` so is_admin is always read fresh from the DB
// (never cached in the session itself) - an admin promotion/demotion takes
// effect on the very next request.
export function getSessionUser(sessionId: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.discord_id = s.discord_id
       WHERE s.session_id = ? AND s.expires_at > ?`
    )
    .get(sessionId, Date.now()) as unknown as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(sessionId: string) {
  db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
}
