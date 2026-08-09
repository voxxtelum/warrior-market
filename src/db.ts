import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'warrior.db'));

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
const reportsHasEndTime = (
  db.prepare(`PRAGMA table_info(reports)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'end_time');
if (!reportsHasEndTime) {
  db.exec(`ALTER TABLE reports ADD COLUMN end_time INTEGER`);
}

// Two different characters can share the same display name (seen in this
// guild across different realms), so player identity is (player_name,
// server), not name alone - the `server` column below is part of the
// primary key on both tables. Older DBs predate this column; migrate by
// dropping and recreating (casts/damage are fully re-derivable by re-adding
// each report, unlike reports/fights which we keep).
const castsHasServer = (
  db.prepare(`PRAGMA table_info(casts)`).all() as unknown as { name: string }[]
).some((c) => c.name === 'server');
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

  CREATE TABLE IF NOT EXISTS warriors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT NOT NULL,
    server TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    UNIQUE (player_name, server)
  );

  CREATE TABLE IF NOT EXISTS user_warrior_links (
    user_id TEXT PRIMARY KEY REFERENCES users(discord_id),
    warrior_id INTEGER NOT NULL UNIQUE REFERENCES warriors(id),
    linked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warrior_id INTEGER NOT NULL,
    report_code TEXT,
    price REAL NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('raid', 'drift')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_warrior ON price_snapshots (warrior_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY REFERENCES users(discord_id),
    balance REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    user_id TEXT NOT NULL,
    warrior_id INTEGER NOT NULL,
    shares REAL NOT NULL,
    cost_basis_total REAL NOT NULL,
    PRIMARY KEY (user_id, warrior_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    warrior_id INTEGER NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'liquidation')),
    shares REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    warrior_id INTEGER,
    amount REAL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS scheduler_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_drift_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_wallet_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_discord_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    delta REAL NOT NULL,
    balance_after REAL NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Idle drift reverts toward this, and demand-driven trade impact updates it -
// unlike the old "latest raid snapshot" lookup it replaces, it isn't erased
// by a later drift tick, only by a new raid result or another trade. Older
// DBs predate this column; add it in place (existing rows backfilled below,
// once DEFAULT_STOCK_CONFIG is defined).
const warriorsHasAnchorPrice = (
  db.prepare(`PRAGMA table_info(warriors)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'anchor_price');
if (!warriorsHasAnchorPrice) {
  db.exec(`ALTER TABLE warriors ADD COLUMN anchor_price REAL`);
}

// One-time backfill: identities that already existed before this feature
// shipped become visible warriors immediately (a guildmate's main isn't
// "new"). Only warriors discovered from here on via getOrCreateWarriorId
// default to hidden - this runs directly against hidden_players/warriors
// rather than through that helper so it never hides pre-existing players.
// Guarded on the warriors table being empty so it only ever runs once.
const warriorsCount = (
  db.prepare(`SELECT COUNT(*) AS c FROM warriors`).get() as unknown as {
    c: number;
  }
).c;
if (warriorsCount === 0) {
  const existingIdentities = db
    .prepare(
      `SELECT player_name, server FROM casts
       UNION
       SELECT player_name, server FROM damage`,
    )
    .all() as unknown as { player_name: string; server: string }[];
  const insertWarrior = db.prepare(
    `INSERT OR IGNORE INTO warriors (player_name, server, first_seen_at) VALUES (?, ?, ?)`,
  );
  const backfillNow = Date.now();
  for (const identity of existingIdentities) {
    insertWarrior.run(identity.player_name, identity.server, backfillNow);
  }
}

// Seed the stock scoring config on first run, since it now lives entirely in
// the DB (tunable from the admin page) rather than config.json.
const DEFAULT_STOCK_CONFIG = {
  abilities: [
    { id: 23894, name: 'Bloodthirst', weight: 20, bucket: 'all' },
    { id: 25286, name: 'Heroic Strike', weight: 4, bucket: 'dps' },
    { id: 1719, name: 'Recklessness', weight: 5, bucket: 'dps' },
    { id: 12328, name: 'Death Wish', weight: 3, bucket: 'dps' },
    { id: 1680, name: 'Whirlwind', weight: 2, bucket: 'dps' },
    { id: 11597, name: 'Sunder Armor', weight: 1, bucket: 'tank' },
    { id: 11556, name: 'Demoralizing Shout', weight: 0.1, bucket: 'tank' },
    { id: 25288, name: 'Revenge', weight: 1, bucket: 'tank' },
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
  damageTrendWeight: 0.5,
  damagePeerWeight: 0.5,
  damageTrendZClamp: 4,
  driftIntervalMs: 60 * 60 * 1000,
  driftMaxPct: 0.005,
  driftReversionStrength: 0.3,
  demandMaxPctPerTrade: 0.015,
  demandLiquidityDenominator: 50000,
  tradeFeePct: 0.0025,
};
const hasStockConfig = db
  .prepare(`SELECT 1 FROM stock_config WHERE id = 1`)
  .get();
if (!hasStockConfig) {
  db.prepare(`INSERT INTO stock_config (id, data) VALUES (1, ?)`).run(
    JSON.stringify(DEFAULT_STOCK_CONFIG),
  );
}

// Backfill anchor_price for warriors that predate the demand-signal feature -
// their anchor becomes their latest raid price if they have one, or the
// configured starting price otherwise. Naturally idempotent (the WHERE
// clause is empty once every warrior has been backfilled once), so this is
// safe to leave running on every boot.
const warriorsMissingAnchor = db
  .prepare(`SELECT id FROM warriors WHERE anchor_price IS NULL`)
  .all() as unknown as { id: number }[];
if (warriorsMissingAnchor.length > 0) {
  const getLatestRaidForBackfill = db.prepare(
    `SELECT price FROM price_snapshots WHERE warrior_id = ? AND source = 'raid' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const updateAnchor = db.prepare(
    `UPDATE warriors SET anchor_price = ? WHERE id = ?`,
  );
  for (const { id } of warriorsMissingAnchor) {
    const raidRow = getLatestRaidForBackfill.get(id) as unknown as
      | { price: number }
      | undefined;
    updateAnchor.run(
      raidRow ? raidRow.price : DEFAULT_STOCK_CONFIG.startingPrice,
      id,
    );
  }
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
  const deleteDamageTaken = db.prepare(
    `DELETE FROM damage_taken WHERE report_code = ?`,
  );

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

  db.exec('BEGIN');
  try {
    insertReport.run(
      data.report.code,
      data.report.title,
      data.report.zone,
      data.report.start_time,
      data.report.end_time,
      data.report.fetched_at,
    );

    deleteFights.run(data.report.code);
    deleteCasts.run(data.report.code);
    deleteDamage.run(data.report.code);
    deleteDamageTaken.run(data.report.code);

    for (const f of data.fights) {
      insertFight.run(
        f.report_code,
        f.fight_id,
        f.encounter_id,
        f.encounter_name,
        f.kill,
      );
    }
    for (const c of data.casts) {
      insertCast.run(
        c.report_code,
        c.player_name,
        c.server,
        c.class,
        c.ability_id,
        c.ability_name,
        c.cast_count,
      );
    }
    for (const d of data.damage) {
      insertDamage.run(
        d.report_code,
        d.player_name,
        d.server,
        d.class,
        d.total_damage,
        d.active_time,
      );
    }
    for (const d of data.damageTaken) {
      insertDamageTaken.run(
        d.report_code,
        d.player_name,
        d.server,
        d.class,
        d.total_taken,
        d.active_time,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listReports(): ReportRow[] {
  return db
    .prepare(`SELECT * FROM reports ORDER BY start_time ASC`)
    .all() as unknown as ReportRow[];
}

// Manually cascades the same way upsertReport's re-ingest delete step does -
// removes a report's raw raid data entirely. Deliberately does not touch
// price_snapshots; the caller is responsible for calling
// stock.ts's rebuildRaidPriceSnapshots() afterward so the raid-anchored
// price series regenerates without this report ever having existed.
export function deleteReport(code: string): void {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM fights WHERE report_code = ?`).run(code);
    db.prepare(`DELETE FROM casts WHERE report_code = ?`).run(code);
    db.prepare(`DELETE FROM damage WHERE report_code = ?`).run(code);
    db.prepare(`DELETE FROM damage_taken WHERE report_code = ?`).run(code);
    db.prepare(`DELETE FROM reports WHERE code = ?`).run(code);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listZones(): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT zone FROM reports WHERE zone IS NOT NULL ORDER BY zone ASC`,
    )
    .all() as unknown as { zone: string }[];
  return rows.map((r) => r.zone);
}

export function getReportDetail(code: string) {
  const report = db
    .prepare(`SELECT * FROM reports WHERE code = ?`)
    .get(code) as unknown as ReportRow | undefined;
  const fights = db
    .prepare(`SELECT * FROM fights WHERE report_code = ?`)
    .all(code) as unknown as FightRow[];
  const casts = db
    .prepare(
      `SELECT * FROM casts WHERE report_code = ? ORDER BY player_name, ability_name`,
    )
    .all(code) as unknown as CastRow[];
  const damage = db
    .prepare(
      `SELECT * FROM damage WHERE report_code = ? ORDER BY total_damage DESC`,
    )
    .all(code) as unknown as DamageRow[];
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

export function getCastsForZone(
  zone: string,
): (CastRow & { start_time: number })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all(zone) as unknown as (CastRow & { start_time: number })[];
}

export function getDamageForZone(
  zone: string,
): (DamageRow & { start_time: number })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time
       FROM damage t
       JOIN reports r ON r.code = t.report_code
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all(zone) as unknown as (DamageRow & { start_time: number })[];
}

export function getReportsForZone(zone: string): ReportRow[] {
  return db
    .prepare(`SELECT * FROM reports WHERE zone = ? ORDER BY start_time ASC`)
    .all(zone) as unknown as ReportRow[];
}

// Unscoped-by-zone variants for the stock market calculation, which blends
// signals across every instance a player has raided.
export function getAllCasts(): (CastRow & {
  start_time: number;
  zone: string | null;
})[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all() as unknown as (CastRow & {
    start_time: number;
    zone: string | null;
  })[];
}

export function getAllDamage(): (DamageRow & {
  start_time: number;
  zone: string | null;
})[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all() as unknown as (DamageRow & {
    start_time: number;
    zone: string | null;
  })[];
}

export function getAllDamageTaken(): (DamageTakenRow & {
  start_time: number;
  zone: string | null;
})[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage_taken t
       JOIN reports r ON r.code = t.report_code
       WHERE ${NOT_HIDDEN_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all() as unknown as (DamageTakenRow & {
    start_time: number;
    zone: string | null;
  })[];
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
       ORDER BY player_name ASC, server ASC`,
    )
    .all() as unknown as PlayerRow[];
}

// hidden=true only liquidates on the transition into hidden (INSERT OR
// IGNORE's `changes` is 0 if the row already existed), so re-hiding an
// already-hidden warrior - or Phase 0 auto-hiding a warrior that was just
// created and has no holders yet - never double-liquidates.
export function setPlayerHidden(
  playerName: string,
  server: string,
  hidden: boolean,
) {
  if (hidden) {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO hidden_players (player_name, server) VALUES (?, ?)`,
      )
      .run(playerName, server);
    if (result.changes > 0) {
      liquidateWarriorHoldings(playerName, server);
    }
  } else {
    db.prepare(
      `DELETE FROM hidden_players WHERE player_name = ? AND server = ?`,
    ).run(playerName, server);
  }
}

// Force-sells every holder's position in a warrior, at its last known
// price, refunds their wallet, and leaves each of them a notification. A
// no-op if the warrior has no `warriors` row yet or nobody holds shares in
// it, or (unlike the hidden-player case) if there's no price to liquidate
// at - see liquidateOrphanedHoldings below, which relies on that no-op.
function liquidateWarriorHoldings(
  playerName: string,
  server: string,
  reason: string = 'was hidden by an admin',
) {
  const warriorId = getWarriorId(playerName, server);
  if (warriorId === null) return;
  const holders = db
    .prepare(`SELECT * FROM holdings WHERE warrior_id = ? AND shares > 0`)
    .all(warriorId) as unknown as HoldingRow[];
  if (holders.length === 0) return;
  const price = getLatestPrice(warriorId);
  if (price === null) return;

  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const holding of holders) {
      const refund = holding.shares * price;
      db.prepare(
        `DELETE FROM holdings WHERE user_id = ? AND warrior_id = ?`,
      ).run(holding.user_id, warriorId);
      db.prepare(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
      ).run(refund, holding.user_id);
      db.prepare(
        `INSERT INTO transactions (user_id, warrior_id, side, shares, price, total, created_at)
         VALUES (?, ?, 'liquidation', ?, ?, ?, ?)`,
      ).run(holding.user_id, warriorId, holding.shares, price, refund, now);
      db.prepare(
        `INSERT INTO notifications (user_id, message, warrior_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        holding.user_id,
        `${playerName} ${reason} - your holding was liquidated and ${refund.toFixed(2)} coins refunded.`,
        warriorId,
        refund,
        now,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// After a report deletion rebuilds raid price history, some warrior may be
// left with zero raid snapshots (e.g. a player who only ever appeared in
// the deleted report) while users still hold shares in them - liquidates
// any such holder so nobody is stuck holding untradeable shares. A no-op
// per-warrior if there's no price left to liquidate at (e.g. it also has no
// drift snapshots), same as the hidden-player liquidation path.
export function liquidateOrphanedHoldings(): void {
  const stillPriced = new Set(listWarriorsWithRaidSnapshot().map((w) => w.id));
  const holderWarriorIds = db
    .prepare(`SELECT DISTINCT warrior_id FROM holdings WHERE shares > 0`)
    .all() as unknown as { warrior_id: number }[];
  for (const { warrior_id } of holderWarriorIds) {
    if (stillPriced.has(warrior_id)) continue;
    const warrior = getWarriorById(warrior_id);
    if (!warrior) continue;
    liquidateWarriorHoldings(
      warrior.player_name,
      warrior.server,
      'has no remaining raid history',
    );
  }
}

export interface WarriorRow {
  id: number;
  player_name: string;
  server: string;
  first_seen_at: number;
}

// Registers a warrior the first time it's seen. Brand-new warriors default
// to hidden (via the existing setPlayerHidden hook) until an admin unhides
// them from /admin/players - existing warriors backfilled at startup are
// exempt from this (see the one-time backfill above).
export function getOrCreateWarriorId(
  playerName: string,
  server: string,
): number {
  const existing = db
    .prepare(`SELECT id FROM warriors WHERE player_name = ? AND server = ?`)
    .get(playerName, server) as unknown as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `INSERT INTO warriors (player_name, server, first_seen_at) VALUES (?, ?, ?)`,
    )
    .run(playerName, server, Date.now());
  setPlayerHidden(playerName, server, true);
  return Number(result.lastInsertRowid);
}

export function getWarriorId(
  playerName: string,
  server: string,
): number | null {
  const row = db
    .prepare(`SELECT id FROM warriors WHERE player_name = ? AND server = ?`)
    .get(playerName, server) as unknown as { id: number } | undefined;
  return row ? row.id : null;
}

export function getWarriorById(id: number): WarriorRow | null {
  return (
    (db
      .prepare(`SELECT * FROM warriors WHERE id = ?`)
      .get(id) as unknown as WarriorRow) ?? null
  );
}

export function listWarriors(): WarriorRow[] {
  return db
    .prepare(`SELECT * FROM warriors ORDER BY player_name ASC, server ASC`)
    .all() as unknown as WarriorRow[];
}

export class LinkError extends Error {}

// Strict 1:1 - user_warrior_links enforces this at the schema level
// (user_id PRIMARY KEY, warrior_id UNIQUE), this just turns the constraint
// violation into a friendlier error for the "warrior already taken" case;
// re-linking a user that already has a link just moves it.
export function linkUserToWarrior(userId: string, warriorId: number): void {
  const taken = db
    .prepare(`SELECT user_id FROM user_warrior_links WHERE warrior_id = ?`)
    .get(warriorId) as unknown as { user_id: string } | undefined;
  if (taken && taken.user_id !== userId) {
    throw new LinkError('This warrior is already linked to another user');
  }
  db.prepare(
    `INSERT INTO user_warrior_links (user_id, warrior_id, linked_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET warrior_id = excluded.warrior_id, linked_at = excluded.linked_at`,
  ).run(userId, warriorId, Date.now());
}

export function unlinkUser(userId: string): void {
  db.prepare(`DELETE FROM user_warrior_links WHERE user_id = ?`).run(userId);
}

export function getLinkedWarrior(
  userId: string,
): { player_name: string; server: string } | null {
  const row = db
    .prepare(
      `SELECT w.player_name, w.server
       FROM user_warrior_links l
       JOIN warriors w ON w.id = l.warrior_id
       WHERE l.user_id = ?`,
    )
    .get(userId) as unknown as
    | { player_name: string; server: string }
    | undefined;
  return row ?? null;
}

// Keyed "player_name::server" -> avatar (or null), for merging into the
// Stock page leaderboard - computeStock() itself stays user-unaware, this
// join happens only in the route handler.
export function getLinkedAvatarsByIdentity(): Map<string, string | null> {
  const rows = db
    .prepare(
      `SELECT w.player_name, w.server, u.avatar
       FROM user_warrior_links l
       JOIN warriors w ON w.id = l.warrior_id
       JOIN users u ON u.discord_id = l.user_id`,
    )
    .all() as unknown as {
    player_name: string;
    server: string;
    avatar: string | null;
  }[];
  return new Map(rows.map((r) => [`${r.player_name}::${r.server}`, r.avatar]));
}

export interface PriceSnapshotRow {
  id: number;
  warrior_id: number;
  report_code: string | null;
  price: number;
  source: 'raid' | 'drift';
  created_at: number;
}

export function insertPriceSnapshot(
  warriorId: number,
  price: number,
  source: 'raid' | 'drift',
  reportCode: string | null,
  createdAt: number,
) {
  db.prepare(
    `INSERT INTO price_snapshots (warrior_id, report_code, price, source, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(warriorId, reportCode, price, source, createdAt);
}

export function getPriceSnapshotCount(): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM price_snapshots`)
      .get() as unknown as { c: number }
  ).c;
}

// Wipes every raid-sourced snapshot and replaces it with a freshly computed
// set (see stock.ts's rebuildRaidPriceSnapshots) - used after a report is
// deleted or the market is reset, when the raid-anchored price series needs
// to be regenerated from scratch. Drift-sourced snapshots are never touched
// here.
export function replaceRaidPriceSnapshots(
  entries: {
    warriorId: number;
    price: number;
    reportCode: string;
    createdAt: number;
  }[],
): void {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM price_snapshots WHERE source = 'raid'`).run();
    for (const e of entries) {
      insertPriceSnapshot(
        e.warriorId,
        e.price,
        'raid',
        e.reportCode,
        e.createdAt,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// The single source of truth for "the current price" everywhere trading
// logic reads it - always the most recently inserted snapshot (raid or
// drift), never a live computeStock() recompute (see stock.ts).
export function getLatestPrice(warriorId: number): number | null {
  const row = db
    .prepare(
      `SELECT price FROM price_snapshots WHERE warrior_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(warriorId) as unknown as { price: number } | undefined;
  return row ? row.price : null;
}

// The most recent raid-derived snapshot only (excludes drift/demand ticks) -
// pairs with getLatestPrice() to build the same "change since last raid"
// figure the trade modal and stock leaderboard show, elsewhere keyed off
// computeStock()'s own series instead of this table.
export function getLastRaidPrice(warriorId: number): number | null {
  const row = db
    .prepare(
      `SELECT price FROM price_snapshots WHERE warrior_id = ? AND source = 'raid' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(warriorId) as unknown as { price: number } | undefined;
  return row ? row.price : null;
}

// The price idle drift reverts toward, and that demand-driven trades update -
// deliberately not derived from price_snapshots (which would mean a demand
// move gets slowly erased by the next drift tick, same as the old
// "latest raid snapshot" anchor did). Only a new raid result or another
// trade moves this; random drift noise never does.
export function getAnchorPrice(warriorId: number): number | null {
  const row = db
    .prepare(`SELECT anchor_price FROM warriors WHERE id = ?`)
    .get(warriorId) as unknown as { anchor_price: number | null } | undefined;
  return row ? row.anchor_price : null;
}

export function setAnchorPrice(warriorId: number, price: number): void {
  db.prepare(`UPDATE warriors SET anchor_price = ? WHERE id = ?`).run(
    price,
    warriorId,
  );
}

export function getPriceHistory(warriorId: number): PriceSnapshotRow[] {
  return db
    .prepare(
      `SELECT * FROM price_snapshots WHERE warrior_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(warriorId) as unknown as PriceSnapshotRow[];
}

export function listWarriorsWithRaidSnapshot(): WarriorRow[] {
  return db
    .prepare(
      `SELECT DISTINCT w.* FROM warriors w JOIN price_snapshots ps ON ps.warrior_id = w.id WHERE ps.source = 'raid'`,
    )
    .all() as unknown as WarriorRow[];
}

// Full price history for every visible warrior that has at least one
// snapshot, joined with identity - shaped for the Stock page chart, which
// plots real time on the x-axis (raid jumps and drift ticks both included)
// rather than one point per report like the old computeStock()-only chart
// did. Excludes currently-hidden warriors, same as every other Stock page
// consumer (computeStock() already filters them out of casts/damage), so a
// warrior hidden after trading stops leaking its price history publicly.
export function getAllPriceSnapshots(): (PriceSnapshotRow & {
  player_name: string;
  server: string;
})[] {
  return db
    .prepare(
      `SELECT ps.*, w.player_name, w.server
       FROM price_snapshots ps
       JOIN warriors w ON w.id = ps.warrior_id
       WHERE NOT EXISTS (
         SELECT 1 FROM hidden_players hp WHERE hp.player_name = w.player_name AND hp.server = w.server
       )
       ORDER BY ps.created_at ASC, ps.id ASC`,
    )
    .all() as unknown as (PriceSnapshotRow & {
    player_name: string;
    server: string;
  })[];
}

const STARTING_BALANCE = 1000;

export interface WalletRow {
  user_id: string;
  balance: number;
  created_at: number;
}

export function getOrCreateWallet(userId: string): WalletRow {
  const existing = db
    .prepare(`SELECT * FROM wallets WHERE user_id = ?`)
    .get(userId) as unknown as WalletRow | undefined;
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    `INSERT INTO wallets (user_id, balance, created_at) VALUES (?, ?, ?)`,
  ).run(userId, STARTING_BALANCE, now);
  return { user_id: userId, balance: STARTING_BALANCE, created_at: now };
}

export interface HoldingRow {
  user_id: string;
  warrior_id: number;
  shares: number;
  cost_basis_total: number;
}

export function getHolding(
  userId: string,
  warriorId: number,
): HoldingRow | null {
  return (
    (db
      .prepare(`SELECT * FROM holdings WHERE user_id = ? AND warrior_id = ?`)
      .get(userId, warriorId) as unknown as HoldingRow | undefined) ?? null
  );
}

export function listHoldingsWithContext(userId: string): (HoldingRow & {
  player_name: string;
  server: string;
  latest_price: number | null;
  last_raid_price: number | null;
})[] {
  const rows = db
    .prepare(
      `SELECT h.*, w.player_name, w.server
       FROM holdings h
       JOIN warriors w ON w.id = h.warrior_id
       WHERE h.user_id = ? AND h.shares > 0`,
    )
    .all(userId) as unknown as (HoldingRow & {
    player_name: string;
    server: string;
  })[];
  return rows.map((r) => ({
    ...r,
    latest_price: getLatestPrice(r.warrior_id),
    last_raid_price: getLastRaidPrice(r.warrior_id),
  }));
}

export interface TransactionRow {
  id: number;
  user_id: string;
  warrior_id: number;
  side: 'buy' | 'sell' | 'liquidation';
  shares: number;
  price: number;
  total: number;
  created_at: number;
}

// Raw rows (no join) ordered so each warrior's transactions for this user
// form a contiguous chronological block - built for pnl.ts's single-pass
// average-cost replay, which depends on seeing every prior buy before a
// sell for the same (user, warrior) pair. Always the FULL history, never
// paginated - a limited slice would corrupt the replayed cost basis.
export function listAllTransactionsForUser(userId: string): TransactionRow[] {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ?
       ORDER BY warrior_id ASC, created_at ASC, id ASC`,
    )
    .all(userId) as unknown as TransactionRow[];
}

export interface WarriorHolderRow {
  userId: string;
  username: string;
  avatar: string | null;
  shares: number;
  costBasisTotal: number;
  marketValue: number | null;
}

export function getWarriorHolders(warriorId: number): WarriorHolderRow[] {
  const price = getLatestPrice(warriorId);
  const rows = db
    .prepare(
      `SELECT h.user_id, h.shares, h.cost_basis_total, u.username, u.avatar
       FROM holdings h
       JOIN users u ON u.discord_id = h.user_id
       WHERE h.warrior_id = ? AND h.shares > 0
       ORDER BY h.shares DESC`,
    )
    .all(warriorId) as unknown as {
    user_id: string;
    shares: number;
    cost_basis_total: number;
    username: string;
    avatar: string | null;
  }[];
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    avatar: r.avatar,
    shares: r.shares,
    costBasisTotal: r.cost_basis_total,
    marketValue: price !== null ? r.shares * price : null,
  }));
}

export class TradeError extends Error {}

export interface TradeConfig {
  demandMaxPctPerTrade: number;
  demandLiquidityDenominator: number;
  tradeFeePct: number;
}

// coinAmount is always "coin", both directions - buying spends that much
// coin for however many (fractional) shares it buys at the latest price;
// selling is "sell this much coin's worth", converted to shares and clamped
// to what's actually held (so a rounding-safe "sell everything" is just
// passing a large amount, no separate codepath needed). The whole thing runs
// with zero `await` in the critical section, so node:sqlite's synchronous
// DatabaseSync is enough to make this atomic against interleaving requests -
// nothing else can run on this single-threaded process mid-trade.
//
// Demand signal: the trade also nudges price in real time (a mini bonding
// curve - impact scales with this trade's own coin value, clamped, no
// windowed aggregation needed) and updates warriors.anchor_price so the move
// sticks rather than being reverted by the next idle-drift tick (see
// getAnchorPrice/drift.ts). A tradeFeePct is taken on top for buys / out of
// proceeds for sells, so a same-user buy-then-sell round trip is a
// guaranteed small loss even if price didn't move - the config values come
// from the caller (stock.ts's loadStockConfig()) rather than being read
// here, to avoid a circular import between db.ts and stock.ts.
export function executeTrade(
  userId: string,
  warriorId: number,
  side: 'buy' | 'sell',
  coinAmount: number,
  config: TradeConfig,
): TransactionRow {
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
    throw new TradeError('Amount must be a positive number');
  }

  if (side === 'buy') {
    const hidden = db
      .prepare(
        `SELECT 1 FROM warriors w
         JOIN hidden_players hp ON hp.player_name = w.player_name AND hp.server = w.server
         WHERE w.id = ?`,
      )
      .get(warriorId);
    if (hidden) throw new TradeError("This warrior isn't currently tradeable");
  }

  const price = getLatestPrice(warriorId);
  if (price === null)
    throw new TradeError('No price available for this warrior yet');

  const wallet = getOrCreateWallet(userId);
  const holding = getHolding(userId, warriorId);

  let shares = coinAmount / price;
  let total = coinAmount;
  let fee = total * config.tradeFeePct;

  if (side === 'buy') {
    // Cent-rounded comparison - a client "use 100% of balance" amount can
    // differ from wallet.balance by a sub-cent float rounding error while
    // still displaying as the same cent value, and shouldn't be rejected.
    // Required balance includes the fee, which is new on top of the order.
    if (
      Math.round((coinAmount + fee) * 100) > Math.round(wallet.balance * 100)
    ) {
      throw new TradeError('Insufficient balance');
    }
  } else {
    if (!holding || holding.shares <= 0)
      throw new TradeError("You don't hold any shares of this warrior");
    // Cent-rounded comparison (same rationale as the balance check above) -
    // the client's "sell 100%" slider sends a coin amount derived from
    // holding.shares * price and rounded to the cent, which can land a hair
    // under the exact full-position value. Treating that as a full sell
    // (rather than leaving a sub-cent dust remainder) keeps a full sell from
    // leaving an untradeable near-zero position behind.
    const fullSellValue = holding.shares * price;
    if (
      shares > holding.shares ||
      Math.round(coinAmount * 100) >= Math.round(fullSellValue * 100)
    ) {
      shares = holding.shares;
      total = shares * price;
      fee = total * config.tradeFeePct;
    }
  }

  // Per-trade price impact: a buy pushes price up, a sell pushes it down, by
  // a fraction of `total` (the actual executed order value, post-clamp)
  // relative to demandLiquidityDenominator, clamped so no single trade can
  // move price more than demandMaxPctPerTrade.
  const rawImpactPct = total / config.demandLiquidityDenominator;
  const clampedImpactPct = Math.min(config.demandMaxPctPerTrade, rawImpactPct);
  const impactPct = clampedImpactPct * (side === 'buy' ? 1 : -1);
  const priceAfter = price * (1 + impactPct);

  const now = Date.now();
  db.exec('BEGIN');
  try {
    if (side === 'buy') {
      const newShares = (holding?.shares ?? 0) + shares;
      const newCostBasis = (holding?.cost_basis_total ?? 0) + total;
      db.prepare(
        `INSERT INTO holdings (user_id, warrior_id, shares, cost_basis_total) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, warrior_id) DO UPDATE SET shares = excluded.shares, cost_basis_total = excluded.cost_basis_total`,
      ).run(userId, warriorId, newShares, newCostBasis);
      db.prepare(
        `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
      ).run(total + fee, userId);
    } else {
      const remainingShares = holding!.shares - shares;
      if (remainingShares <= 0) {
        db.prepare(
          `DELETE FROM holdings WHERE user_id = ? AND warrior_id = ?`,
        ).run(userId, warriorId);
      } else {
        const remainingCostBasis =
          holding!.cost_basis_total * (remainingShares / holding!.shares);
        db.prepare(
          `UPDATE holdings SET shares = ?, cost_basis_total = ? WHERE user_id = ? AND warrior_id = ?`,
        ).run(remainingShares, remainingCostBasis, userId, warriorId);
      }
      db.prepare(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
      ).run(total - fee, userId);
    }

    const result = db
      .prepare(
        `INSERT INTO transactions (user_id, warrior_id, side, shares, price, total, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, warriorId, side, shares, price, total, now);

    insertPriceSnapshot(warriorId, priceAfter, 'drift', null, now);
    setAnchorPrice(warriorId, priceAfter);

    db.exec('COMMIT');
    return {
      id: Number(result.lastInsertRowid),
      user_id: userId,
      warrior_id: warriorId,
      side,
      shares,
      price,
      total,
      created_at: now,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface NotificationRow {
  id: number;
  user_id: string;
  message: string;
  warrior_id: number | null;
  amount: number | null;
  created_at: number;
  read_at: number | null;
}

export function listUnreadNotifications(userId: string): NotificationRow[] {
  return db
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC`,
    )
    .all(userId) as unknown as NotificationRow[];
}

export function markNotificationRead(userId: string, id: number) {
  db.prepare(
    `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`,
  ).run(Date.now(), id, userId);
}

export interface TransactionWithContext extends TransactionRow {
  player_name: string;
  server: string;
  username: string;
  avatar: string | null;
}

export function listTransactions(
  opts: { warriorId?: number; userId?: string; limit?: number } = {},
): TransactionWithContext[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.warriorId !== undefined) {
    clauses.push('t.warrior_id = ?');
    params.push(opts.warriorId);
  }
  if (opts.userId !== undefined) {
    clauses.push('t.user_id = ?');
    params.push(opts.userId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(opts.limit ?? 100);

  return db
    .prepare(
      `SELECT t.*, w.player_name, w.server, u.username, u.avatar
       FROM transactions t
       JOIN warriors w ON w.id = t.warrior_id
       JOIN users u ON u.discord_id = t.user_id
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as TransactionWithContext[];
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar: string | null;
  balance: number;
  holdingsValue: number;
  netWorth: number;
  linkedWarrior: { playerName: string; server: string } | null;
}

// Net worth per user. Latest price per warrior is resolved once here (via
// MAX(id), since ids are inserted in chronological order) rather than
// per-holding, so this stays cheap even with many holders.
export function getLeaderboard(): LeaderboardEntry[] {
  const wallets = db
    .prepare(
      `SELECT w.*, u.username, u.avatar, wr.player_name AS linked_player_name, wr.server AS linked_server
       FROM wallets w
       JOIN users u ON u.discord_id = w.user_id
       LEFT JOIN user_warrior_links l ON l.user_id = w.user_id
       LEFT JOIN warriors wr ON wr.id = l.warrior_id`,
    )
    .all() as unknown as (WalletRow & {
    username: string;
    avatar: string | null;
    linked_player_name: string | null;
    linked_server: string | null;
  })[];
  const holdings = db
    .prepare(`SELECT * FROM holdings WHERE shares > 0`)
    .all() as unknown as HoldingRow[];

  const latestPrices = new Map<number, number>();
  const priceRows = db
    .prepare(
      `SELECT warrior_id, price FROM price_snapshots WHERE id IN (SELECT MAX(id) FROM price_snapshots GROUP BY warrior_id)`,
    )
    .all() as unknown as { warrior_id: number; price: number }[];
  for (const r of priceRows) latestPrices.set(r.warrior_id, r.price);

  const holdingsValueByUser = new Map<string, number>();
  for (const h of holdings) {
    const price = latestPrices.get(h.warrior_id) ?? 0;
    holdingsValueByUser.set(
      h.user_id,
      (holdingsValueByUser.get(h.user_id) ?? 0) + h.shares * price,
    );
  }

  return wallets
    .map((w) => {
      const holdingsValue = holdingsValueByUser.get(w.user_id) ?? 0;
      return {
        user_id: w.user_id,
        username: w.username,
        avatar: w.avatar,
        balance: w.balance,
        holdingsValue,
        netWorth: w.balance + holdingsValue,
        linkedWarrior:
          w.linked_player_name !== null
            ? { playerName: w.linked_player_name, server: w.linked_server! }
            : null,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth);
}

export interface AdminWalletOverviewEntry {
  userId: string;
  username: string;
  avatar: string | null;
  balance: number;
  holdingsValue: number;
  netWorth: number;
}

// Like getLeaderboard(), but starts from every registered user (not just
// ones who already have a wallets row) so the Manage Market page can show
// (and adjust the balance of) a user who's never traded - they implicitly
// have STARTING_BALANCE and no holdings until getOrCreateWallet() lazily
// creates their real row.
export function getAdminWalletOverview(): AdminWalletOverviewEntry[] {
  const users = db
    .prepare(`SELECT discord_id, username, avatar FROM users`)
    .all() as unknown as {
    discord_id: string;
    username: string;
    avatar: string | null;
  }[];
  const walletByUser = new Map(
    (db.prepare(`SELECT * FROM wallets`).all() as unknown as WalletRow[]).map(
      (w) => [w.user_id, w.balance],
    ),
  );
  const holdings = db
    .prepare(`SELECT * FROM holdings WHERE shares > 0`)
    .all() as unknown as HoldingRow[];

  const latestPrices = new Map<number, number>();
  const priceRows = db
    .prepare(
      `SELECT warrior_id, price FROM price_snapshots WHERE id IN (SELECT MAX(id) FROM price_snapshots GROUP BY warrior_id)`,
    )
    .all() as unknown as { warrior_id: number; price: number }[];
  for (const r of priceRows) latestPrices.set(r.warrior_id, r.price);

  const holdingsValueByUser = new Map<string, number>();
  for (const h of holdings) {
    const price = latestPrices.get(h.warrior_id) ?? 0;
    holdingsValueByUser.set(
      h.user_id,
      (holdingsValueByUser.get(h.user_id) ?? 0) + h.shares * price,
    );
  }

  return users
    .map((u) => {
      const balance = walletByUser.get(u.discord_id) ?? STARTING_BALANCE;
      const holdingsValue = holdingsValueByUser.get(u.discord_id) ?? 0;
      return {
        userId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
        balance,
        holdingsValue,
        netWorth: balance + holdingsValue,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth);
}

export class AdminActionError extends Error {}

// Manually adjusts a user's coin balance (e.g. a prize, correcting a
// mistake) - validated, audited (admin_wallet_adjustments), and notifies
// the affected user, mirroring the existing liquidation notification shape.
export function adjustWalletBalance(
  targetUserId: string,
  delta: number,
  adminDiscordId: string,
  reason: string | null,
): WalletRow {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new AdminActionError('Amount must be a non-zero number');
  }
  const wallet = getOrCreateWallet(targetUserId);
  const newBalance = wallet.balance + delta;
  if (newBalance < 0) {
    throw new AdminActionError("Resulting balance can't go below 0");
  }

  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE wallets SET balance = ? WHERE user_id = ?`).run(
      newBalance,
      targetUserId,
    );
    db.prepare(
      `INSERT INTO admin_wallet_adjustments (admin_discord_id, target_user_id, delta, balance_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(adminDiscordId, targetUserId, delta, newBalance, reason, now);
    db.prepare(
      `INSERT INTO notifications (user_id, message, warrior_id, amount, created_at) VALUES (?, ?, NULL, ?, ?)`,
    ).run(
      targetUserId,
      `An admin adjusted your balance by ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} coins.`,
      delta,
      now,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return {
    user_id: targetUserId,
    balance: newBalance,
    created_at: wallet.created_at,
  };
}

export interface AdminWalletAdjustmentView {
  id: number;
  adminUsername: string;
  targetUsername: string;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: number;
}

// Full history of adjustWalletBalance() calls, newest first - the audit
// trail is admin_wallet_adjustments itself; this just joins in usernames
// for display since the table only stores discord IDs.
export function getAdminWalletAdjustments(): AdminWalletAdjustmentView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.delta, a.balance_after, a.reason, a.created_at,
              admin.username AS admin_username, target.username AS target_username
       FROM admin_wallet_adjustments a
       JOIN users admin ON admin.discord_id = a.admin_discord_id
       JOIN users target ON target.discord_id = a.target_user_id
       ORDER BY a.id DESC`,
    )
    .all() as unknown as {
    id: number;
    delta: number;
    balance_after: number;
    reason: string | null;
    created_at: number;
    admin_username: string;
    target_username: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    adminUsername: r.admin_username,
    targetUsername: r.target_username,
    delta: r.delta,
    balanceAfter: r.balance_after,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

// Wipes market state back to a clean slate: every wallet reset to
// STARTING_BALANCE, all holdings/transactions/notifications cleared, and
// price_snapshots (both raid and drift) cleared - the caller is responsible
// for calling stock.ts's rebuildRaidPriceSnapshots() right after, and this
// resets last_drift_at so a stale timestamp doesn't fire an immediate
// catch-up drift tick against the freshly rebuilt prices. Raid/report data
// itself (reports, casts, damage, warriors, links) is untouched -
// out of scope for a *market* reset. admin_wallet_adjustments is also left
// alone - it's a historical admin-action audit log, not market state.
export function resetMarketState(): void {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM transactions`).run();
    db.prepare(`DELETE FROM holdings`).run();
    db.prepare(`DELETE FROM notifications`).run();
    db.prepare(`UPDATE wallets SET balance = ?`).run(STARTING_BALANCE);
    db.prepare(`DELETE FROM price_snapshots`).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  setLastDriftAt(Date.now());
}

export interface MarketStats {
  totalCoinInWallets: number;
  totalCoinInHoldings: number;
  totalNetWorth: number;
  totalTradeVolume: number;
  userCount: number;
  perWarriorVolume: {
    player_name: string;
    server: string;
    volume: number;
    tradeCount: number;
  }[];
  topTraders: {
    user_id: string;
    username: string;
    turnover: number;
    tradeCount: number;
  }[];
}

export function getMarketStats(): MarketStats {
  const leaderboard = getLeaderboard();
  const totalCoinInWallets = leaderboard.reduce((sum, u) => sum + u.balance, 0);
  const totalCoinInHoldings = leaderboard.reduce(
    (sum, u) => sum + u.holdingsValue,
    0,
  );

  const perWarriorVolume = db
    .prepare(
      `SELECT w.player_name, w.server, SUM(t.total) AS volume, COUNT(*) AS tradeCount
       FROM transactions t
       JOIN warriors w ON w.id = t.warrior_id
       GROUP BY t.warrior_id
       ORDER BY volume DESC`,
    )
    .all() as unknown as {
    player_name: string;
    server: string;
    volume: number;
    tradeCount: number;
  }[];

  const topTraders = db
    .prepare(
      `SELECT u.discord_id AS user_id, u.username, SUM(t.total) AS turnover, COUNT(*) AS tradeCount
       FROM transactions t
       JOIN users u ON u.discord_id = t.user_id
       GROUP BY t.user_id
       ORDER BY turnover DESC
       LIMIT 20`,
    )
    .all() as unknown as {
    user_id: string;
    username: string;
    turnover: number;
    tradeCount: number;
  }[];

  // All-time, every side (buy/sell/liquidation) included - matches
  // perWarriorVolume/topTraders' existing definition of "volume" exactly, so
  // this headline number reconciles with the detail tables below it.
  const totalTradeVolume = perWarriorVolume.reduce(
    (sum, r) => sum + r.volume,
    0,
  );

  return {
    totalCoinInWallets,
    totalCoinInHoldings,
    totalNetWorth: totalCoinInWallets + totalCoinInHoldings,
    totalTradeVolume,
    userCount: leaderboard.length,
    perWarriorVolume,
    topTraders,
  };
}

export interface MarketSummary {
  totalMarketSize: number;
  totalTradeVolume: number;
}

// Public-safe subset of getMarketStats() - just the two headline numbers,
// no per-warrior/per-trader breakdowns (topTraders reveals identities+
// turnover, which is admin-only info per the trade feed's anonymization
// rules elsewhere).
export function getMarketSummary(): MarketSummary {
  const stats = getMarketStats();
  return {
    totalMarketSize: stats.totalNetWorth,
    totalTradeVolume: stats.totalTradeVolume,
  };
}

export function getLastDriftAt(): number | null {
  const row = db
    .prepare(`SELECT last_drift_at FROM scheduler_state WHERE id = 1`)
    .get() as unknown as { last_drift_at: number } | undefined;
  return row ? row.last_drift_at : null;
}

export function setLastDriftAt(ts: number) {
  db.prepare(
    `INSERT INTO scheduler_state (id, last_drift_at) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_drift_at = excluded.last_drift_at`,
  ).run(ts);
}

// Stock scoring config lives entirely in the DB (seeded with
// DEFAULT_STOCK_CONFIG on first run) so it can be tuned from the admin page
// without a server restart - stock.ts re-reads it on every computeStock()
// call rather than caching it at import time.
export function getStockConfigRaw(): string | null {
  const row = db
    .prepare(`SELECT data FROM stock_config WHERE id = 1`)
    .get() as unknown as { data: string } | undefined;
  return row ? row.data : null;
}

export function setStockConfigRaw(json: string) {
  db.prepare(
    `
    INSERT INTO stock_config (id, data) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `,
  ).run(json);
}

export interface UserRow {
  discord_id: string;
  username: string;
  avatar: string | null;
  is_admin: number;
  first_login_at: number;
  last_login_at: number;
}

export function getUserById(discordId: string): UserRow | null {
  return (
    (db
      .prepare(`SELECT * FROM users WHERE discord_id = ?`)
      .get(discordId) as unknown as UserRow) ?? null
  );
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
  isBootstrapAdmin: boolean,
): UserRow {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO users (discord_id, username, avatar, is_admin, first_login_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      avatar = excluded.avatar,
      last_login_at = excluded.last_login_at
  `,
  ).run(discordId, username, avatar, isBootstrapAdmin ? 1 : 0, now, now);

  if (isBootstrapAdmin) {
    db.prepare(`UPDATE users SET is_admin = 1 WHERE discord_id = ?`).run(
      discordId,
    );
  }

  return db
    .prepare(`SELECT * FROM users WHERE discord_id = ?`)
    .get(discordId) as unknown as UserRow;
}

export function listUsers(): (UserRow & {
  linked_warrior_id: number | null;
  linked_player_name: string | null;
  linked_server: string | null;
})[] {
  return db
    .prepare(
      `SELECT u.*, l.warrior_id AS linked_warrior_id, w.player_name AS linked_player_name, w.server AS linked_server
       FROM users u
       LEFT JOIN user_warrior_links l ON l.user_id = u.discord_id
       LEFT JOIN warriors w ON w.id = l.warrior_id
       ORDER BY u.last_login_at DESC`,
    )
    .all() as unknown as (UserRow & {
    linked_warrior_id: number | null;
    linked_player_name: string | null;
    linked_server: string | null;
  })[];
}

export function setUserAdmin(discordId: string, isAdmin: boolean) {
  db.prepare(`UPDATE users SET is_admin = ? WHERE discord_id = ?`).run(
    isAdmin ? 1 : 0,
    discordId,
  );
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(discordId: string): {
  sessionId: string;
  expiresAt: number;
} {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());

  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    `INSERT INTO sessions (session_id, discord_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
  ).run(sessionId, discordId, now, expiresAt);
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
       WHERE s.session_id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as unknown as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(sessionId: string) {
  db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
}
