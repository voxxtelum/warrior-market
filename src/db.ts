import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

export const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'warrior.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    zone TEXT,
    start_time INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'committed'
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

// Report preview/hold feature: a report sits as 'pending' (raw data ingested,
// no price impact applied yet) until an admin reviews its computed price
// preview and explicitly commits it - see stock.ts's computeReportPriceImpact/
// commitReport and routes/reports.ts's /preview and /commit routes. The
// ALTER's DEFAULT 'committed' exists only to backfill pre-existing rows
// (added under the old instant-commit path, so their price impact is already
// live) - upsertReport always passes status explicitly, so a newly-ingested
// report is never silently miscategorized by this column default.
const reportsHasStatus = (
  db.prepare(`PRAGMA table_info(reports)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'status');
if (!reportsHasStatus) {
  db.exec(`ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'committed'`);
}

// At most one report may be pending review at a time (see fetchAndIngestReport's
// getPendingReport() guard) - same "single active row" pattern as
// idx_admin_notifications_single_active below.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_single_pending
    ON reports (status) WHERE status = 'pending';
`);

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
    delta REAL,
    source TEXT NOT NULL CHECK (source IN ('raid', 'raid_anchor', 'drift', 'swing', 'trade')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_warrior ON price_snapshots (warrior_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_source_created ON price_snapshots (source, created_at DESC);

  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY REFERENCES users(discord_id),
    balance REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- One row per user, overwritten in place on every hourly drift tick (see
  -- refreshPortfolioSnapshots()) - this is not a history log, just "net
  -- worth as of the last refresh," used to compute a "since last hour"
  -- delta. Seeded at the configured starting wallet balance when created.
  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    user_id TEXT PRIMARY KEY REFERENCES users(discord_id),
    net_worth REAL NOT NULL,
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

  -- Funds never own real warrior shares - pool_value/shares_outstanding are
  -- a synthetic mutual-fund-style ledger, moved only by trades (mint/redeem
  -- at NAV) and the periodic valuation tick (fundValuation.ts), which sums
  -- constituent price changes weighted by fund_constituents.stock_count and
  -- applies gain_multiplier/loss_multiplier. risk is a plain 1-5 int with
  -- all label/color logic client-side (see funds.md REVISIONS) - kept off a
  -- CHECK constraint deliberately, see the price_snapshots.source rebuild
  -- below for why widening a CHECK later is expensive in this codebase.
  -- Soft-deleted only (deleted_at), never hard DELETE, so fund_transactions/
  -- fund_value_snapshots history survives a deletion.
  CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    risk INTEGER NOT NULL,
    fee_pct REAL NOT NULL,
    tax_pct REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    gain_multiplier REAL NOT NULL DEFAULT 1,
    loss_multiplier REAL NOT NULL DEFAULT 1,
    seed_nav REAL NOT NULL DEFAULT 100,
    pool_value REAL NOT NULL DEFAULT 0,
    shares_outstanding REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  -- last_snapshot_price is the constituent warrior's price as of the last
  -- valuation tick (seeded at add-time so a newly added constituent's first
  -- tick contributes zero change, not a garbage jump from whenever the fund
  -- itself was created).
  CREATE TABLE IF NOT EXISTS fund_constituents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL REFERENCES funds(id),
    warrior_id INTEGER NOT NULL REFERENCES warriors(id),
    stock_count REAL NOT NULL,
    last_snapshot_price REAL,
    UNIQUE (fund_id, warrior_id)
  );
  CREATE INDEX IF NOT EXISTS idx_fund_constituents_fund ON fund_constituents (fund_id);

  CREATE TABLE IF NOT EXISTS fund_value_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL,
    nav REAL NOT NULL,
    pool_value REAL NOT NULL,
    shares_outstanding REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fund_value_snapshots_fund ON fund_value_snapshots (fund_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS fund_holdings (
    user_id TEXT NOT NULL,
    fund_id INTEGER NOT NULL,
    shares REAL NOT NULL,
    cost_basis_total REAL NOT NULL,
    PRIMARY KEY (user_id, fund_id)
  );

  CREATE TABLE IF NOT EXISTS fund_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    fund_id INTEGER NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'liquidation')),
    shares REAL NOT NULL,
    nav REAL NOT NULL,
    total REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fund_transactions_user ON fund_transactions (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fund_transactions_fund ON fund_transactions (fund_id, created_at DESC);

  -- Admin-authored broadcast popups (distinct from the per-user "notifications"
  -- table above, which is system-generated wallet-event messages). The partial
  -- unique index enforces "only one active at a time" at the DB layer, not just
  -- in application code - activateAdminNotification() deactivates the current
  -- row before activating the new one, in the same transaction, so this index
  -- is never violated mid-request.
  CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    button_text TEXT NOT NULL,
    button_link TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_notifications_single_active
    ON admin_notifications (active) WHERE active = 1;

  -- One row per (notification, user) once that user has dismissed it (via the
  -- popup's close X or its CTA button) - absence of a row means unseen.
  -- Editing a notification's content never touches this table, so already-seen
  -- users never see it resurface just because the admin tweaked the copy.
  CREATE TABLE IF NOT EXISTS admin_notification_views (
    notification_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    viewed_at INTEGER NOT NULL,
    PRIMARY KEY (notification_id, user_id)
  );

  -- Audit trail for admin_notifications mutations, shown in the Audit Log tab
  -- alongside admin_wallet_adjustments. notification_id is nullable-safe
  -- against a later delete (SQLite has no FK enforcement in this codebase).
  CREATE TABLE IF NOT EXISTS admin_notification_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_discord_id TEXT NOT NULL,
    notification_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );

  -- One row per (week_start, week_end), upserted - see upsertWeeklySummary.
  -- Admin-edited Discord-post text for the /admin/summary page, saved on
  -- demand so past weeks' posts can be reviewed later; the raw metrics that
  -- generated the draft are NOT stored, only the final text (this is a
  -- save-what-you-posted log, not a re-renderable snapshot).
  CREATE TABLE IF NOT EXISTS weekly_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start INTEGER NOT NULL,
    week_end INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_summaries_week ON weekly_summaries (week_start, week_end);

  -- One row per backup file written to data/backups/ - see backup.ts for the
  -- actual VACUUM INTO / restore logic, this table is just the registry.
  -- 'hourly'/'daily' rows are pruned automatically per backup_settings;
  -- 'manual'/'pre_report'/'pre_restore' rows are kept until an admin deletes
  -- them explicitly (see backup.ts's pruneBackups, only ever called with
  -- 'hourly'/'daily').
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Single-row table (id=1), same upsert style as stock_config/scheduler_state -
  -- admin-editable retention counts for the hourly/daily backup schedulers,
  -- surfaced on /admin/backup rather than the Manage App page.
  CREATE TABLE IF NOT EXISTS backup_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    retain_hourly INTEGER NOT NULL DEFAULT 12,
    retain_daily INTEGER NOT NULL DEFAULT 3
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

// raid_anchor_price is the "fundamental" anchor, set only by raid results
// (see setRaidAnchorPrice, called from stock.ts alongside setAnchorPrice).
// anchor_price remains the trading anchor moved by both raids and demand;
// the gap between the two is how far demand has pushed a price from
// fundamentals, and drift.ts decays that gap back down every tick instead
// of letting a demand-driven move stick forever.
const warriorsHasRaidAnchorPrice = (
  db.prepare(`PRAGMA table_info(warriors)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'raid_anchor_price');
if (!warriorsHasRaidAnchorPrice) {
  db.exec(`ALTER TABLE warriors ADD COLUMN raid_anchor_price REAL`);
}

// WoW class (Druid/Hunter/Mage/.../Warrior), used to color character names
// on the leaderboard and admin pages. Nullable - existing warriors have no
// value until an admin sets one via the Link Character modal.
const warriorsHasClass = (
  db.prepare(`PRAGMA table_info(warriors)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'class');
if (!warriorsHasClass) {
  db.exec(`ALTER TABLE warriors ADD COLUMN class TEXT`);
}

// Additive columns for the Funds feature (see funds.md) - notifications
// gains a nullable fund_id (parallels the existing warrior_id) so a fund's
// wallet-credit notifications can be traced back to it, and scheduler_state
// gains its own last-tick timestamp for the fund valuation scheduler
// (fundValuation.ts), independent of drift's last_drift_at.
const notificationsHasFundId = (
  db.prepare(`PRAGMA table_info(notifications)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'fund_id');
if (!notificationsHasFundId) {
  db.exec(`ALTER TABLE notifications ADD COLUMN fund_id INTEGER`);
}

const schedulerStateHasLastFundValuationAt = (
  db.prepare(`PRAGMA table_info(scheduler_state)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'last_fund_valuation_at');
if (!schedulerStateHasLastFundValuationAt) {
  db.exec(`ALTER TABLE scheduler_state ADD COLUMN last_fund_valuation_at INTEGER`);
}

// Independent last-tick timestamps for the hourly/daily backup schedulers
// (backup.ts), same reasoning as last_fund_valuation_at above.
const schedulerStateHasLastHourlyBackupAt = (
  db.prepare(`PRAGMA table_info(scheduler_state)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'last_hourly_backup_at');
if (!schedulerStateHasLastHourlyBackupAt) {
  db.exec(`ALTER TABLE scheduler_state ADD COLUMN last_hourly_backup_at INTEGER`);
}

const schedulerStateHasLastDailyBackupAt = (
  db.prepare(`PRAGMA table_info(scheduler_state)`).all() as unknown as {
    name: string;
  }[]
).some((c) => c.name === 'last_daily_backup_at');
if (!schedulerStateHasLastDailyBackupAt) {
  db.exec(`ALTER TABLE scheduler_state ADD COLUMN last_daily_backup_at INTEGER`);
}

// price_snapshots.source has a CHECK constraint, which SQLite can't widen
// via ALTER TABLE - installs that predate the 'swing', 'trade', and/or
// 'raid_anchor' sources (and the 'delta' column) need the table rebuilt.
// Guarded by inspecting the stored constraint text so this only ever runs
// once; the CREATE TABLE above already includes the final shape for fresh
// installs, so this is a no-op there. Checking for 'raid_anchor' alone (the
// newest addition) covers every older state - pre-'swing', pre-'trade', and
// pre-'raid_anchor' installs alike - in a single pass.
const priceSnapshotsSql = (
  db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'price_snapshots'`)
    .get() as unknown as { sql: string } | undefined
)?.sql;
if (priceSnapshotsSql && !priceSnapshotsSql.includes("'raid_anchor'")) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE price_snapshots_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warrior_id INTEGER NOT NULL,
        report_code TEXT,
        price REAL NOT NULL,
        delta REAL,
        source TEXT NOT NULL CHECK (source IN ('raid', 'raid_anchor', 'drift', 'swing', 'trade')),
        created_at INTEGER NOT NULL
      );
      INSERT INTO price_snapshots_new (id, warrior_id, report_code, price, source, created_at)
        SELECT id, warrior_id, report_code, price, source, created_at FROM price_snapshots;
      DROP TABLE price_snapshots;
      ALTER TABLE price_snapshots_new RENAME TO price_snapshots;
      CREATE INDEX IF NOT EXISTS idx_price_snapshots_warrior ON price_snapshots (warrior_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_snapshots_source_created ON price_snapshots (source, created_at DESC);
    `);

    // One-time backfill of the new delta column: price minus the same
    // warrior's immediately preceding row, NULL for each warrior's first
    // row. Rides along on the rebuild above at no extra migration cost -
    // never re-runs after this, guarded by the same 'trade' check.
    const rows = db
      .prepare(
        `SELECT id, warrior_id, price FROM price_snapshots ORDER BY warrior_id, created_at ASC, id ASC`,
      )
      .all() as unknown as { id: number; warrior_id: number; price: number }[];
    const updateDelta = db.prepare(`UPDATE price_snapshots SET delta = ? WHERE id = ?`);
    let prevWarriorId: number | null = null;
    let prevPrice: number | null = null;
    for (const row of rows) {
      const delta = row.warrior_id === prevWarriorId ? row.price - (prevPrice as number) : null;
      updateDelta.run(delta, row.id);
      prevWarriorId = row.warrior_id;
      prevPrice = row.price;
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
  tankTopNByZone: [
    { zone: 'Molten Core', topN: 3 },
    { zone: 'Blackwing Lair', topN: 3 },
    { zone: "Temple of Ahn'Qiraj", topN: 4 },
    { zone: 'Naxxramas', topN: 4 },
  ],
  minBucketSize: 2,
  coldStartReports: 3,
  dpsEmaAlpha: 0.15,
  damageWeight: 0.6,
  castWeight: 0.4,
  pricePerScorePointUp: 8,
  pricePerScorePointDown: 8,
  startingPrice: 100,
  startingWalletBalance: 1000,
  newPlayerGraceReports: 2,
  newPlayerPenaltyLeniency: 0.3,
  minAttendancePct: 0.3,
  damageTrendWeight: 0.5,
  damagePeerWeight: 0.5,
  damageTrendZClampUp: 4,
  damageTrendZClampDown: 4,
  driftIntervalMs: 60 * 60 * 1000,
  fundValuationIntervalMs: 60 * 60 * 1000,
  driftMaxPct: 0.005,
  driftNoisePct: 0.005,
  driftReversionStrength: 0.3,
  demandMaxPctPerTrade: 0.015,
  demandLiquidityDenominator: 50000,
  tradeFeePct: 0.0025,
  demandAnchorDecayPct: 0.05,
  marketGravityStrength: 0.03,
  swingChancePct: 0.01,
  swingUpMagnitude: 20,
  swingDownMagnitude: 20,
  swingMagnitudeFuzz: 5,
  swingCooldownGapPct: 0.08,
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

// Backfill raid_anchor_price the same way, for installs that predate the
// anchor-decay feature - it becomes each warrior's latest raid price (or
// their current anchor_price, or startingPrice) so nothing reverts sharply
// on first boot after upgrading. Idempotent for the same reason as above.
const warriorsMissingRaidAnchor = db
  .prepare(`SELECT id, anchor_price FROM warriors WHERE raid_anchor_price IS NULL`)
  .all() as unknown as { id: number; anchor_price: number | null }[];
if (warriorsMissingRaidAnchor.length > 0) {
  const getLatestRaidForRaidAnchorBackfill = db.prepare(
    `SELECT price FROM price_snapshots WHERE warrior_id = ? AND source = 'raid' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const updateRaidAnchor = db.prepare(
    `UPDATE warriors SET raid_anchor_price = ? WHERE id = ?`,
  );
  for (const { id, anchor_price } of warriorsMissingRaidAnchor) {
    const raidRow = getLatestRaidForRaidAnchorBackfill.get(id) as unknown as
      | { price: number }
      | undefined;
    updateRaidAnchor.run(
      raidRow ? raidRow.price : (anchor_price ?? DEFAULT_STOCK_CONFIG.startingPrice),
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
  // Required (not optional) so every insert site must be explicit - if this
  // were ever silently omitted, SQLite's column default would land a
  // brand-new report as 'committed' while it has no price_snapshots row and
  // no anchor set, looking done but never having actually moved anything.
  status: 'pending' | 'committed';
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
    INSERT INTO reports (code, title, zone, start_time, end_time, fetched_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      title = excluded.title,
      zone = excluded.zone,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      fetched_at = excluded.fetched_at,
      status = excluded.status
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
      data.report.status,
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

// Defaults to excluding a pending report - the safe default for every public
// consumer (computeStock() and friends), which keep calling this with no
// args. Only the report-preview compute path and the admin reports list need
// to see the pending row, and pass includePending: true explicitly.
export function listReports(opts: { includePending?: boolean } = {}): ReportRow[] {
  const where = opts.includePending ? '' : `WHERE status != 'pending'`;
  return db
    .prepare(`SELECT * FROM reports ${where} ORDER BY start_time ASC`)
    .all() as unknown as ReportRow[];
}

// At most one row can have status='pending' (enforced by
// idx_reports_single_pending) - used to block adding a second report while
// one is held for review.
export function getPendingReport(): ReportRow | null {
  return (
    (db.prepare(`SELECT * FROM reports WHERE status = 'pending' LIMIT 1`).get() as
      | ReportRow
      | undefined) ?? null
  );
}

export function getReportStatus(code: string): 'pending' | 'committed' | null {
  const row = db.prepare(`SELECT status FROM reports WHERE code = ?`).get(code) as
    | { status: 'pending' | 'committed' }
    | undefined;
  return row ? row.status : null;
}

// Manually cascades the same way upsertReport's re-ingest delete step does -
// removes a report's raw raid data entirely. Deliberately does not touch
// price_snapshots; the caller is responsible for calling stock.ts's
// undoReportPriceImpact() afterward to undo this report's price effect
// without this report ever having existed.
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

// Excludes a pending report's raw rows - these zone-scoped readers are only
// ever consumed by the fully-public compare.ts/overview.ts routes, so this
// is always on, no param, unlike the includePending-optional variants below.
const NOT_PENDING_CLAUSE = `r.status != 'pending'`;

export function getCastsForZone(
  zone: string,
): (CastRow & { start_time: number })[] {
  return db
    .prepare(
      `SELECT t.*, r.start_time
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE} AND ${NOT_PENDING_CLAUSE}
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
       WHERE r.zone = ? AND ${NOT_HIDDEN_CLAUSE} AND ${NOT_PENDING_CLAUSE}
       ORDER BY r.start_time ASC`,
    )
    .all(zone) as unknown as (DamageRow & { start_time: number })[];
}

export function getReportsForZone(zone: string): ReportRow[] {
  return db
    .prepare(`SELECT * FROM reports WHERE zone = ? AND status != 'pending' ORDER BY start_time ASC`)
    .all(zone) as unknown as ReportRow[];
}

// Unscoped-by-zone variants for the stock market calculation, which blends
// signals across every instance a player has raided. Default excludes a
// pending report's rows (the safe default for every public caller, which
// keep calling with no args); computeStock({ includePending: true }) is the
// only caller that needs to see a held report's own just-ingested data.
export function getAllCasts(opts: { includePending?: boolean } = {}): (CastRow & {
  start_time: number;
  zone: string | null;
})[] {
  const clause = opts.includePending ? NOT_HIDDEN_CLAUSE : `${NOT_HIDDEN_CLAUSE} AND ${NOT_PENDING_CLAUSE}`;
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM casts t
       JOIN reports r ON r.code = t.report_code
       WHERE ${clause}
       ORDER BY r.start_time ASC`,
    )
    .all() as unknown as (CastRow & {
    start_time: number;
    zone: string | null;
  })[];
}

export function getAllDamage(opts: { includePending?: boolean } = {}): (DamageRow & {
  start_time: number;
  zone: string | null;
})[] {
  const clause = opts.includePending ? NOT_HIDDEN_CLAUSE : `${NOT_HIDDEN_CLAUSE} AND ${NOT_PENDING_CLAUSE}`;
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage t
       JOIN reports r ON r.code = t.report_code
       WHERE ${clause}
       ORDER BY r.start_time ASC`,
    )
    .all() as unknown as (DamageRow & {
    start_time: number;
    zone: string | null;
  })[];
}

export function getAllDamageTaken(opts: { includePending?: boolean } = {}): (DamageTakenRow & {
  start_time: number;
  zone: string | null;
})[] {
  const clause = opts.includePending ? NOT_HIDDEN_CLAUSE : `${NOT_HIDDEN_CLAUSE} AND ${NOT_PENDING_CLAUSE}`;
  return db
    .prepare(
      `SELECT t.*, r.start_time, r.zone
       FROM damage_taken t
       JOIN reports r ON r.code = t.report_code
       WHERE ${clause}
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
      // Fund holders are NOT liquidated/notified here - only this
      // warrior's own direct market holders are (above). A fund just
      // silently drops the hidden warrior and rebalances its remaining
      // constituents, same proportional formula as a manual admin
      // removal (see removeFundConstituent) - a locked decision from
      // planning, not an oversight.
      const warriorId = getWarriorId(playerName, server);
      if (warriorId !== null) {
        const affectedFunds = db
          .prepare(`SELECT DISTINCT fund_id FROM fund_constituents WHERE warrior_id = ?`)
          .all(warriorId) as unknown as { fund_id: number }[];
        for (const { fund_id } of affectedFunds) {
          removeFundConstituent(fund_id, warriorId);
        }
      }
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
      createWalletNotification(holding.user_id, refund, `${playerName} ${reason} and your holding was liquidated`, {
        warriorId,
      });
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
  class: string | null;
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

// Admin-driven alternative to getOrCreateWarriorId: used when manually
// linking a character that isn't from raid-log ingestion. Unlike that path,
// this never hides the warrior - the admin is deliberately creating/claiming
// it, not discovering it - and it always sets/updates the class.
export function createOrUpdateManualWarrior(
  playerName: string,
  server: string,
  characterClass: string,
): number {
  const existing = db
    .prepare(`SELECT id FROM warriors WHERE player_name = ? AND server = ?`)
    .get(playerName, server) as unknown as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE warriors SET class = ? WHERE id = ?`).run(
      characterClass,
      existing.id,
    );
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO warriors (player_name, server, class, first_seen_at) VALUES (?, ?, ?, ?)`,
    )
    .run(playerName, server, characterClass, Date.now());
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
): { warrior_id: number; player_name: string; server: string; class: string | null } | null {
  const row = db
    .prepare(
      `SELECT w.id AS warrior_id, w.player_name, w.server, w.class
       FROM user_warrior_links l
       JOIN warriors w ON w.id = l.warrior_id
       WHERE l.user_id = ?`,
    )
    .get(userId) as unknown as
    | { warrior_id: number; player_name: string; server: string; class: string | null }
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
  delta: number | null;
  source: 'raid' | 'raid_anchor' | 'drift' | 'swing' | 'trade';
  created_at: number;
}

// delta is the caller's responsibility, not computed here off getLatestPrice()
// - the bulk historical rebuild path (replaceRaidPriceSnapshots) inserts rows
// out of real-time order interleaved with existing drift/trade rows, so
// "latest row right now" would not mean "the row immediately before this one"
// there. Real-time callers (executeTrade, runDriftTick,
// commitReport/applyReportPriceImpact) each already have the correct "price before" on
// hand and pass an accurate delta directly.
export function insertPriceSnapshot(
  warriorId: number,
  price: number,
  delta: number | null,
  source: 'raid' | 'raid_anchor' | 'drift' | 'swing' | 'trade',
  reportCode: string | null,
  createdAt: number,
) {
  db.prepare(
    `INSERT INTO price_snapshots (warrior_id, report_code, price, delta, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(warriorId, reportCode, price, delta, source, createdAt);
}

export function getPriceSnapshotCount(): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM price_snapshots`)
      .get() as unknown as { c: number }
  ).c;
}

// Used to guard the single-warrior raid backfill (stock.ts's
// backfillRaidPriceSnapshotsForWarrior) against re-inserting duplicate raid
// history if a warrior is hidden and unhidden more than once.
export function warriorHasRaidSnapshot(warriorId: number): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM price_snapshots WHERE warrior_id = ? AND source = 'raid' LIMIT 1`)
      .get(warriorId) !== undefined
  );
}

// Wipes every raid-sourced snapshot and replaces it with a freshly computed
// set (see stock.ts's rebuildRaidPriceSnapshots) - used for the one-time
// historical backfill and a full market reset, the only two cases with no
// live-compounded history to preserve. A report delete does NOT go through
// here (see stock.ts's undoReportPriceImpact, which removes just that
// report's own rows). Drift-sourced snapshots are never touched here.
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
    // Also clears 'raid_anchor' audit rows - a full rebuild regenerates the
    // raid series from scratch as a pure 'raid'-tagged series (see
    // rebuildRaidPriceSnapshots), so any pre-rebuild audit rows would
    // otherwise linger and no longer correspond to anything real.
    db.prepare(`DELETE FROM price_snapshots WHERE source IN ('raid', 'raid_anchor')`).run();
    for (const e of entries) {
      // delta: null - this is a bulk historical replay of a warrior's raid
      // series interleaved with existing drift/trade rows that keep their
      // own real timestamps, so there's no single well-defined "row right
      // before this one" the way there is for a live insert.
      insertPriceSnapshot(
        e.warriorId,
        e.price,
        null,
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

export interface ReportPriceImpactWrite {
  warriorId: number;
  price: number; // the price to write to price_snapshots and to both anchors
  delta: number | null; // null for a warrior's first-ever price, same convention as insertPriceSnapshot
  source: 'raid' | 'raid_anchor';
}

// Writes every entry's price_snapshots row + anchor updates AND flips the
// report's status to 'committed', all in one transaction - either the
// report's entire price impact lands and it becomes committed, or none of
// it does and it's still pending (see stock.ts's commitReport, the only
// caller). The status flip is guarded by `AND status = 'pending'` so a
// concurrent commit/discard (e.g. two admin tabs) can't double-apply: if 0
// rows are affected, someone else already changed this report's status
// since the caller read it, and we roll back and throw rather than
// silently re-applying.
export function applyReportPriceImpact(
  reportCode: string,
  entries: ReportPriceImpactWrite[],
  createdAt: number = Date.now(),
): void {
  db.exec('BEGIN');
  try {
    const result = db
      .prepare(`UPDATE reports SET status = 'committed' WHERE code = ? AND status = 'pending'`)
      .run(reportCode);
    if (result.changes === 0) {
      throw new Error(`Report "${reportCode}" is no longer pending (already committed or discarded)`);
    }
    for (const e of entries) {
      insertPriceSnapshot(e.warriorId, e.price, e.delta, e.source, reportCode, createdAt);
      setAnchorPrice(e.warriorId, e.price);
      setRaidAnchorPrice(e.warriorId, e.price);
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
      // Excludes 'raid_anchor' rows - those are audit-only records of an
      // anchor move (see computeReportPriceImpact), never the live price.
      `SELECT price FROM price_snapshots WHERE warrior_id = ? AND source != 'raid_anchor' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(warriorId) as unknown as { price: number } | undefined;
  return row ? row.price : null;
}

// Pairs with getLatestPrice() to build the same "change since last raid"
// figure the trade modal and stock leaderboard show, elsewhere keyed off
// computeStock()'s own series instead of this table. Reads raid_anchor_price
// directly rather than scanning price_snapshots - since every raid (not just
// the first) now keeps both anchors in sync, this value IS continuously "what
// the most recent raid set", with no ledger dependency or staleness risk.
export function getLastRaidPrice(warriorId: number): number | null {
  return getRaidAnchorPrice(warriorId);
}

// Pairs with getLatestPrice() to build the same "last tick" figure the
// Stock page's price cell shows next to the live price - how much just the
// most recent price_snapshots event (drift, swing, trade, or raid) moved
// the price, independent of the raid anchor.
export function getLastTickDelta(warriorId: number): number | null {
  const row = db
    .prepare(
      `SELECT delta FROM price_snapshots WHERE warrior_id = ? AND source != 'raid_anchor' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(warriorId) as unknown as { delta: number | null } | undefined;
  return row ? row.delta : null;
}

// Looks up one specific report's raid-ledger row for one warrior - used by
// stock.ts's undoReportPriceImpact to find exactly how much a report being
// deleted moved this warrior's anchors, regardless of whether it was their
// most recent raid or an older one (anchors are a pure running sum of
// deltas, so subtracting any one of them is an exact undo either way).
export function getRaidSnapshotForReport(
  warriorId: number,
  reportCode: string,
): { delta: number | null } | null {
  const row = db
    .prepare(
      `SELECT delta FROM price_snapshots WHERE warrior_id = ? AND report_code = ? AND source IN ('raid', 'raid_anchor') LIMIT 1`,
    )
    .get(warriorId, reportCode) as unknown as { delta: number | null } | undefined;
  return row ? { delta: row.delta } : null;
}

// Whether a warrior has any raid history left besides the given report -
// used by undoReportPriceImpact to tell whether a warrior whose first-ever
// raid is the one being deleted still has later raids (anchors stay as-is,
// since later deltas are already correct absolute figures) or none at all
// (anchors reset to "never raided").
export function warriorHasOtherRaidSnapshot(
  warriorId: number,
  excludeReportCode: string,
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM price_snapshots WHERE warrior_id = ? AND report_code != ? AND source IN ('raid', 'raid_anchor') LIMIT 1`,
      )
      .get(warriorId, excludeReportCode) !== undefined
  );
}

// Removes exactly one report's own price_snapshots rows - the surgical
// counterpart to replaceRaidPriceSnapshots' full-table wipe, used when a
// report is deleted so no other report's history (for this warrior or any
// other) is touched.
export function deletePriceSnapshotsForReport(reportCode: string): void {
  db.prepare(`DELETE FROM price_snapshots WHERE report_code = ?`).run(reportCode);
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

// The "fundamental" anchor - set only by raid results (see stock.ts's
// commitReport/rebuildRaidPriceSnapshots), never by trades or
// drift. drift.ts decays anchor_price toward this every tick, so a
// demand-driven move fades without sustained buying instead of sticking
// forever.
export function getRaidAnchorPrice(warriorId: number): number | null {
  const row = db
    .prepare(`SELECT raid_anchor_price FROM warriors WHERE id = ?`)
    .get(warriorId) as unknown as { raid_anchor_price: number | null } | undefined;
  return row ? row.raid_anchor_price : null;
}

export function setRaidAnchorPrice(warriorId: number, price: number): void {
  db.prepare(`UPDATE warriors SET raid_anchor_price = ? WHERE id = ?`).run(
    price,
    warriorId,
  );
}

// Reverts both anchors to "never raided" (NULL) - used by
// undoReportPriceImpact() when a report delete leaves a warrior with no
// raid history left at all, so their anchors stop pointing at a raid that no
// longer exists instead of just going stale.
export function clearAnchorPrices(warriorId: number): void {
  db.prepare(`UPDATE warriors SET anchor_price = NULL, raid_anchor_price = NULL WHERE id = ?`).run(warriorId);
}

// Excludes 'raid_anchor' rows - same reasoning as getLatestPrice(): those
// record an anchor move, not a real live-price event, and callers here
// (fundStats.ts's daily basket series) need the actual tradeable price
// history, not audit annotations.
export function getPriceHistory(warriorId: number): PriceSnapshotRow[] {
  return db
    .prepare(
      `SELECT * FROM price_snapshots WHERE warrior_id = ? AND source != 'raid_anchor' ORDER BY created_at ASC, id ASC`,
    )
    .all(warriorId) as unknown as PriceSnapshotRow[];
}

// "Latest tradeable price at or before this timestamp" - same idiom as
// getFundNavAt, used by the weekly summary (summary.ts) to measure a
// warrior's price move across an arbitrary past window rather than only
// "since the last snapshot right now".
export function getPriceAtOrBefore(warriorId: number, atOrBefore: number): number | null {
  const row = db
    .prepare(
      `SELECT price FROM price_snapshots WHERE warrior_id = ? AND source != 'raid_anchor' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(warriorId, atOrBefore) as unknown as { price: number } | undefined;
  return row ? row.price : null;
}

// All non-'raid_anchor' price snapshots within [startMs, endMs] across every
// warrior, for the weekly summary's "biggest mover"/volatility scan. Ordered
// by warrior so callers can reduce per-warrior in a single pass.
export function getPriceSnapshotsInRange(
  startMs: number,
  endMs: number,
): (PriceSnapshotRow & { player_name: string; server: string; class: string | null })[] {
  return db
    .prepare(
      `SELECT ps.*, w.player_name, w.server, w.class
       FROM price_snapshots ps
       JOIN warriors w ON w.id = ps.warrior_id
       WHERE ps.source != 'raid_anchor' AND ps.created_at >= ? AND ps.created_at <= ?
       ORDER BY ps.warrior_id ASC, ps.created_at ASC, ps.id ASC`,
    )
    .all(startMs, endMs) as unknown as (PriceSnapshotRow & {
    player_name: string;
    server: string;
    class: string | null;
  })[];
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
      // Excludes 'raid_anchor' rows - those record an anchor move, not a
      // real live-price event, and would otherwise plot a fake jump/dip
      // into the chart (see getLatestPrice()'s own exclusion for why).
      `SELECT ps.*, w.player_name, w.server
       FROM price_snapshots ps
       JOIN warriors w ON w.id = ps.warrior_id
       WHERE ps.source != 'raid_anchor'
         AND NOT EXISTS (
           SELECT 1 FROM hidden_players hp WHERE hp.player_name = w.player_name AND hp.server = w.server
         )
       ORDER BY ps.created_at ASC, ps.id ASC`,
    )
    .all() as unknown as (PriceSnapshotRow & {
    player_name: string;
    server: string;
  })[];
}

// The full raid-only ledger (both 'raid' and 'raid_anchor' sources) across
// every warrior - unlike getAllPriceSnapshots above, which excludes
// 'raid_anchor' because it feeds the live-price chart, this is for
// Gain/raid-style stats that need every raid a warrior ever had, not just
// the ones that moved their tradable price directly. Same hidden_players
// exclusion as getAllPriceSnapshots for a consistent roster.
export function getAllRaidLedgerSnapshots(): (PriceSnapshotRow & {
  player_name: string;
  server: string;
})[] {
  return db
    .prepare(
      `SELECT ps.*, w.player_name, w.server
       FROM price_snapshots ps
       JOIN warriors w ON w.id = ps.warrior_id
       WHERE ps.source IN ('raid', 'raid_anchor')
         AND NOT EXISTS (
           SELECT 1 FROM hidden_players hp WHERE hp.player_name = w.player_name AND hp.server = w.server
         )
       ORDER BY ps.warrior_id ASC, ps.created_at ASC, ps.id ASC`,
    )
    .all() as unknown as (PriceSnapshotRow & {
    player_name: string;
    server: string;
  })[];
}

export interface PriceHistoryFilters {
  sources: ('raid' | 'raid_anchor' | 'drift' | 'swing' | 'trade')[];
  warriorId?: number;
  limit: number;
  offset: number;
}

export interface PriceHistoryEntry {
  id: number;
  playerName: string;
  server: string;
  price: number;
  delta: number | null;
  source: 'raid' | 'raid_anchor' | 'drift' | 'swing' | 'trade';
  createdAt: number;
}

// Admin-only price history, unlike getAllPriceSnapshots() above: not
// filtered to hide currently-hidden warriors (an admin diagnosing history
// wants to see everything), cross-warrior rather than one chart's worth,
// and genuinely paginated in SQL rather than fetched whole - price_snapshots
// grows unboundedly (hourly drift ticks, forever, across every warrior), so
// unlike this codebase's other admin tables it can't be fetched in full and
// paginated client-side.
export function getAdminPriceHistory(filters: PriceHistoryFilters): {
  entries: PriceHistoryEntry[];
  total: number;
} {
  const { sources, warriorId, limit, offset } = filters;
  if (sources.length === 0) return { entries: [], total: 0 };

  const placeholders = sources.map(() => '?').join(', ');
  const warriorClause = warriorId !== undefined ? 'AND ps.warrior_id = ?' : '';
  const whereParams: (string | number)[] =
    warriorId !== undefined ? [...sources, warriorId] : [...sources];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM price_snapshots ps WHERE ps.source IN (${placeholders}) ${warriorClause}`,
      )
      .get(...whereParams) as unknown as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT ps.id, ps.price, ps.delta, ps.source, ps.created_at, w.player_name, w.server
       FROM price_snapshots ps
       JOIN warriors w ON w.id = ps.warrior_id
       WHERE ps.source IN (${placeholders}) ${warriorClause}
       ORDER BY ps.created_at DESC, ps.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...whereParams, limit, offset) as unknown as {
    id: number;
    price: number;
    delta: number | null;
    source: PriceHistoryEntry['source'];
    created_at: number;
    player_name: string;
    server: string;
  }[];

  return {
    entries: rows.map((r) => ({
      id: r.id,
      playerName: r.player_name,
      server: r.server,
      price: r.price,
      delta: r.delta,
      source: r.source,
      createdAt: r.created_at,
    })),
    total,
  };
}

// Admin-tunable via stock_config (see StockConfig.startingWalletBalance in
// stock.ts) rather than a hardcoded constant. Reads the raw config blob
// directly instead of going through stock.ts's loadStockConfig() - stock.ts
// already imports from this file, so importing back from stock.ts here
// would create a circular dependency. Re-read on every call (not cached) to
// match the rest of stock_config's "no restart needed" behavior.
function getStartingWalletBalance(): number {
  const raw = getStockConfigRaw();
  if (!raw) return 1000;
  return (JSON.parse(raw) as { startingWalletBalance?: number }).startingWalletBalance ?? 1000;
}

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
  const startingBalance = getStartingWalletBalance();
  db.prepare(
    `INSERT INTO wallets (user_id, balance, created_at) VALUES (?, ?, ?)`,
  ).run(userId, startingBalance, now);
  db.prepare(
    `INSERT INTO portfolio_snapshots (user_id, net_worth, created_at) VALUES (?, ?, ?)`,
  ).run(userId, startingBalance, now);
  return { user_id: userId, balance: startingBalance, created_at: now };
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

// Every open (shares > 0) holding across every user, for the weekly
// summary's Diamond Hands metric - deliberately unscoped by the report
// window, since "how long has this position gone without a sell" is a
// current-state fact, not something that resets each week.
export function getAllOpenHoldings(): (HoldingRow & {
  username: string;
  player_name: string;
  server: string;
  class: string | null;
})[] {
  return db
    .prepare(
      `SELECT h.*, u.username, w.player_name, w.server, w.class
       FROM holdings h
       JOIN users u ON u.discord_id = h.user_id
       JOIN warriors w ON w.id = h.warrior_id
       WHERE h.shares > 0`,
    )
    .all() as unknown as (HoldingRow & {
    username: string;
    player_name: string;
    server: string;
    class: string | null;
  })[];
}

export function listHoldingsWithContext(userId: string): (HoldingRow & {
  player_name: string;
  server: string;
  latest_price: number | null;
  last_raid_price: number | null;
  last_tick_delta: number | null;
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
    last_tick_delta: getLastTickDelta(r.warrior_id),
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

// All buy/sell/liquidation rows in [startMs, endMs] across every user, for
// the weekly summary (summary.ts). Joined with username/character identity
// since every summary metric needs one or the other for display/mentions.
export function getTransactionsInRange(
  startMs: number,
  endMs: number,
): (TransactionRow & { username: string; player_name: string; server: string; class: string | null })[] {
  return db
    .prepare(
      `SELECT t.*, u.username, w.player_name, w.server, w.class
       FROM transactions t
       JOIN users u ON u.discord_id = t.user_id
       JOIN warriors w ON w.id = t.warrior_id
       WHERE t.created_at >= ? AND t.created_at <= ?
       ORDER BY t.created_at ASC, t.id ASC`,
    )
    .all(startMs, endMs) as unknown as (TransactionRow & {
    username: string;
    player_name: string;
    server: string;
    class: string | null;
  })[];
}

// One (side, created_at) pair per transaction for a single (user, warrior)
// holding, oldest first - used by the weekly summary's Diamond Hands metric
// to find when the current unbroken "no sell" streak on an open position
// began (see summary.ts).
export function listTransactionsForHolding(
  userId: string,
  warriorId: number,
): { side: 'buy' | 'sell' | 'liquidation'; created_at: number }[] {
  return db
    .prepare(
      `SELECT side, created_at FROM transactions WHERE user_id = ? AND warrior_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(userId, warriorId) as unknown as { side: 'buy' | 'sell' | 'liquidation'; created_at: number }[];
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

export interface WarriorVolumeEntry {
  warriorId: number;
  playerName: string;
  server: string;
  volume: number;
  tradeCount: number;
  totalShares: number;
  holderCount: number;
  totalInvested: number;
  hidden: boolean;
  price: number | null;
  anchorPrice: number | null;
  raidAnchorPrice: number | null;
  class: string | null;
}

// Per-warrior trade volume, for the admin Characters tab and the Price
// History filter dropdown - includes EVERY warrior, not just ones that have
// been traded (starts from `warriors`, left-joining transactions, rather
// than the other way around - an untraded warrior still needs to show up
// with zero volume, both in the Characters roster and as a filterable
// option in Price History, which has raid/drift entries for warriors no
// one has ever bought or sold). totalShares is today's outstanding
// position (sum of current holdings), separate from volume (all-time
// traded coin). totalInvested mirrors getWarriorHolders' totalInvested (sum
// of per-holder marketValue), which collapses to totalShares * latest
// price since every holder of a warrior shares the same latest price.
// `hidden` reports each warrior's Players-tab visibility so callers can
// decide whether to filter it out - the Characters roster only wants
// enabled warriors, while Price History intentionally shows hidden ones too
// (see getAdminPriceHistory).
export function getWarriorVolumeOverview(): WarriorVolumeEntry[] {
  const rows = db
    .prepare(
      `SELECT w.id AS warrior_id, w.player_name, w.server, w.class,
              w.anchor_price, w.raid_anchor_price,
              COALESCE(SUM(t.total), 0) AS volume, COUNT(t.id) AS tradeCount,
              EXISTS(
                SELECT 1 FROM hidden_players hp
                WHERE hp.player_name = w.player_name AND hp.server = w.server
              ) AS hidden
       FROM warriors w
       LEFT JOIN transactions t ON t.warrior_id = w.id
       GROUP BY w.id
       ORDER BY volume DESC`,
    )
    .all() as unknown as {
    warrior_id: number;
    player_name: string;
    server: string;
    class: string | null;
    anchor_price: number | null;
    raid_anchor_price: number | null;
    volume: number;
    tradeCount: number;
    hidden: number;
  }[];

  const sharesByWarrior = new Map<number, number>();
  const holdersByWarrior = new Map<number, number>();
  const shareRows = db
    .prepare(
      `SELECT warrior_id, SUM(shares) AS totalShares, COUNT(*) AS holderCount
       FROM holdings WHERE shares > 0 GROUP BY warrior_id`,
    )
    .all() as unknown as { warrior_id: number; totalShares: number; holderCount: number }[];
  for (const r of shareRows) {
    sharesByWarrior.set(r.warrior_id, r.totalShares);
    holdersByWarrior.set(r.warrior_id, r.holderCount);
  }

  return rows.map((r) => {
    const totalShares = sharesByWarrior.get(r.warrior_id) ?? 0;
    const price = getLatestPrice(r.warrior_id);
    return {
      warriorId: r.warrior_id,
      playerName: r.player_name,
      server: r.server,
      volume: r.volume,
      tradeCount: r.tradeCount,
      totalShares,
      holderCount: holdersByWarrior.get(r.warrior_id) ?? 0,
      totalInvested: price !== null ? totalShares * price : 0,
      hidden: !!r.hidden,
      price,
      anchorPrice: r.anchor_price,
      raidAnchorPrice: r.raid_anchor_price,
      class: r.class,
    };
  });
}

export interface WarriorTradeEntry {
  id: number;
  username: string;
  avatar: string | null;
  side: 'buy' | 'sell' | 'liquidation';
  shares: number;
  price: number;
  total: number;
  createdAt: number;
}

// Every trade against one warrior, across all users - the admin Characters
// tab's "View Trades" detail card paginates this client-side the same way
// the per-user trade-history table does, so a generous cap here is enough.
export function getWarriorTrades(warriorId: number): WarriorTradeEntry[] {
  const rows = db
    .prepare(
      `SELECT t.id, u.username, u.avatar, t.side, t.shares, t.price, t.total, t.created_at
       FROM transactions t
       JOIN users u ON u.discord_id = t.user_id
       WHERE t.warrior_id = ?
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 300`,
    )
    .all(warriorId) as unknown as {
    id: number;
    username: string;
    avatar: string | null;
    side: 'buy' | 'sell' | 'liquidation';
    shares: number;
    price: number;
    total: number;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    avatar: r.avatar,
    side: r.side,
    shares: r.shares,
    price: r.price,
    total: r.total,
    createdAt: r.created_at,
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

    insertPriceSnapshot(warriorId, priceAfter, priceAfter - price, 'trade', null, now);
    // Nudge the anchor by this trade's own proportional impact rather than
    // snapping it to match the traded price - preserves whatever gap a
    // recent raid or prior trades left, instead of a single trade silently
    // overwriting it. impactPct is bounded well within (-1, 1) by
    // demandMaxPctPerTrade, so a positive anchor can never cross zero here.
    const currentAnchor = getAnchorPrice(warriorId);
    const anchorAfter = currentAnchor !== null && currentAnchor > 0 ? currentAnchor * (1 + impactPct) : priceAfter;
    setAnchorPrice(warriorId, anchorAfter);

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

export class AdminNotificationError extends Error {}

export interface AdminNotificationRow {
  id: number;
  name: string;
  content: string;
  button_text: string;
  button_link: string;
  active: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export function getAdminNotificationById(id: number): AdminNotificationRow | null {
  return (
    (db.prepare(`SELECT * FROM admin_notifications WHERE id = ?`).get(id) as
      | AdminNotificationRow
      | undefined) ?? null
  );
}

export function listAdminNotifications(): AdminNotificationRow[] {
  return db
    .prepare(`SELECT * FROM admin_notifications ORDER BY id DESC`)
    .all() as unknown as AdminNotificationRow[];
}

export function recordNotificationAudit(
  adminDiscordId: string,
  notificationId: number | null,
  action: string,
  detail: string | null,
): void {
  db.prepare(
    `INSERT INTO admin_notification_audit (admin_discord_id, notification_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(adminDiscordId, notificationId, action, detail, Date.now());
}

export interface CreateAdminNotificationInput {
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
  createdBy: string;
}

export function createAdminNotification(input: CreateAdminNotificationInput): AdminNotificationRow {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const result = db
      .prepare(
        `INSERT INTO admin_notifications (name, content, button_text, button_link, active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(input.name, input.content, input.buttonText, input.buttonLink, input.createdBy, now, now);
    const id = Number(result.lastInsertRowid);
    recordNotificationAudit(input.createdBy, id, 'create', input.name);
    db.exec('COMMIT');
    return getAdminNotificationById(id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface UpdateAdminNotificationInput {
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
}

export function updateAdminNotification(
  id: number,
  input: UpdateAdminNotificationInput,
  adminDiscordId: string,
): AdminNotificationRow {
  const existing = getAdminNotificationById(id);
  if (!existing) throw new AdminNotificationError('Unknown notification');
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE admin_notifications SET name = ?, content = ?, button_text = ?, button_link = ?, updated_at = ? WHERE id = ?`,
    ).run(input.name, input.content, input.buttonText, input.buttonLink, Date.now(), id);
    recordNotificationAudit(adminDiscordId, id, 'update', input.name);
    db.exec('COMMIT');
    return getAdminNotificationById(id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Deactivates whichever notification is currently active (if any) before
// activating this one, in the same transaction - enforces "only one active"
// alongside the partial unique index on admin_notifications(active) WHERE
// active = 1, which guards the invariant even if this ever raced.
export function activateAdminNotification(id: number, adminDiscordId: string): AdminNotificationRow {
  const target = getAdminNotificationById(id);
  if (!target) throw new AdminNotificationError('Unknown notification');
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE admin_notifications SET active = 0, updated_at = ? WHERE active = 1 AND id != ?`).run(
      now,
      id,
    );
    db.prepare(`UPDATE admin_notifications SET active = 1, updated_at = ? WHERE id = ?`).run(now, id);
    recordNotificationAudit(adminDiscordId, id, 'activate', target.name);
    db.exec('COMMIT');
    return getAdminNotificationById(id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deactivateAdminNotification(id: number, adminDiscordId: string): AdminNotificationRow {
  const target = getAdminNotificationById(id);
  if (!target) throw new AdminNotificationError('Unknown notification');
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE admin_notifications SET active = 0, updated_at = ? WHERE id = ?`).run(Date.now(), id);
    recordNotificationAudit(adminDiscordId, id, 'deactivate', target.name);
    db.exec('COMMIT');
    return getAdminNotificationById(id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteAdminNotification(id: number, adminDiscordId: string): void {
  const target = getAdminNotificationById(id);
  if (!target) throw new AdminNotificationError('Unknown notification');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM admin_notification_views WHERE notification_id = ?`).run(id);
    db.prepare(`DELETE FROM admin_notifications WHERE id = ?`).run(id);
    recordNotificationAudit(adminDiscordId, null, 'delete', target.name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// The single active notification, or null if none is active or this user has
// already dismissed it (a view row already exists).
export function getActiveNotificationForUser(userId: string): AdminNotificationRow | null {
  return (
    (db
      .prepare(
        `SELECT n.* FROM admin_notifications n
         WHERE n.active = 1
           AND NOT EXISTS (
             SELECT 1 FROM admin_notification_views v
             WHERE v.notification_id = n.id AND v.user_id = ?
           )`,
      )
      .get(userId) as AdminNotificationRow | undefined) ?? null
  );
}

// Idempotent: both the popup's close-X and its CTA button call this before
// dismissing/navigating, and a user should never be able to trigger it twice.
export function recordNotificationView(notificationId: number, userId: string): void {
  db.prepare(
    `INSERT INTO admin_notification_views (notification_id, user_id, viewed_at) VALUES (?, ?, ?)
     ON CONFLICT (notification_id, user_id) DO NOTHING`,
  ).run(notificationId, userId, Date.now());
}

export interface AdminNotificationAuditView {
  id: number;
  adminUsername: string;
  notificationId: number | null;
  notificationName: string | null;
  action: string;
  detail: string | null;
  createdAt: number;
}

// notification_name comes from the audit row's own `detail` snapshot when the
// live admin_notifications row is gone (deleted), falling back to the LEFT
// JOIN's live name otherwise - so a deleted notification's history still
// reads sensibly instead of showing a blank name forever.
export function getAdminNotificationAudit(): AdminNotificationAuditView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.notification_id, a.action, a.detail, a.created_at,
              admin.username AS admin_username, n.name AS notification_name
       FROM admin_notification_audit a
       JOIN users admin ON admin.discord_id = a.admin_discord_id
       LEFT JOIN admin_notifications n ON n.id = a.notification_id
       ORDER BY a.id DESC`,
    )
    .all() as unknown as {
    id: number;
    notification_id: number | null;
    action: string;
    detail: string | null;
    created_at: number;
    admin_username: string;
    notification_name: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    adminUsername: r.admin_username,
    notificationId: r.notification_id,
    notificationName: r.notification_name ?? r.detail,
    action: r.action,
    detail: r.detail,
    createdAt: r.created_at,
  }));
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

// True all-time trade count for one user, independent of listTransactions'
// display limit (200/500 depending on caller) - used by the wallet-summary
// "Trades" stat, which would otherwise silently cap out for active traders.
export function getUserTradeCount(userId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?`)
    .get(userId) as unknown as { count: number };
  return row.count;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar: string | null;
  balance: number;
  holdingsValue: number;
  netWorth: number;
  linkedWarrior: { playerName: string; server: string; class: string | null } | null;
}

// Net worth per user. Latest price per warrior is resolved once here (via
// MAX(id), since ids are inserted in chronological order) rather than
// per-holding, so this stays cheap even with many holders.
export function getLeaderboard(): LeaderboardEntry[] {
  const wallets = db
    .prepare(
      `SELECT w.*, u.username, u.avatar, wr.player_name AS linked_player_name, wr.server AS linked_server, wr.class AS linked_class
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
    linked_class: string | null;
  })[];
  const holdings = db
    .prepare(`SELECT * FROM holdings WHERE shares > 0`)
    .all() as unknown as HoldingRow[];

  const latestPrices = getAllLatestTradablePrices();

  const holdingsValueByUser = new Map<string, number>();
  for (const h of holdings) {
    const price = latestPrices.get(h.warrior_id) ?? 0;
    holdingsValueByUser.set(
      h.user_id,
      (holdingsValueByUser.get(h.user_id) ?? 0) + h.shares * price,
    );
  }
  const fundHoldingsValueByUser = getFundHoldingsValueByUser();

  return wallets
    .map((w) => {
      const holdingsValue = holdingsValueByUser.get(w.user_id) ?? 0;
      const fundHoldingsValue = fundHoldingsValueByUser.get(w.user_id) ?? 0;
      return {
        user_id: w.user_id,
        username: w.username,
        avatar: w.avatar,
        balance: w.balance,
        holdingsValue,
        netWorth: w.balance + holdingsValue + fundHoldingsValue,
        linkedWarrior:
          w.linked_player_name !== null
            ? {
                playerName: w.linked_player_name,
                server: w.linked_server!,
                class: w.linked_class,
              }
            : null,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth);
}

// Overwrites every existing portfolio_snapshots row with each user's
// current net worth (reusing getLeaderboard()'s already-batched
// computation) - called once per drift tick, *before* that tick's price
// updates are applied (see runDriftTick), so the row holds "net worth as of
// the previous tick" for the whole interval until the next tick refreshes
// it again. Table stays exactly one row per user; this is not a history
// log, see the table's own comment.
export function refreshPortfolioSnapshots(): void {
  const leaderboard = getLeaderboard();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO portfolio_snapshots (user_id, net_worth, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET net_worth = excluded.net_worth, created_at = excluded.created_at`,
  );
  db.exec('BEGIN');
  try {
    for (const entry of leaderboard) {
      stmt.run(entry.user_id, entry.netWorth, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Net worth as of the last hourly refresh, for computing a "since last
// hour" delta against a live-computed net worth. Null only if the user has
// no wallet yet (getOrCreateWallet() seeds this alongside the wallet).
export function getPortfolioSnapshotNetWorth(userId: string): number | null {
  const row = db
    .prepare(`SELECT net_worth FROM portfolio_snapshots WHERE user_id = ?`)
    .get(userId) as unknown as { net_worth: number } | undefined;
  return row ? row.net_worth : null;
}

export interface AdminWalletOverviewEntry {
  userId: string;
  username: string;
  avatar: string | null;
  linkedWarrior: { id: number; playerName: string; server: string; class: string | null } | null;
  firstLoginAt: number;
  lastLoginAt: number;
  balance: number;
  holdingsValue: number;
  netWorth: number;
  turnover: number;
  tradeCount: number;
}

// Like getLeaderboard(), but starts from every registered user (not just
// ones who already have a wallets row) so the Manage Market page can show
// (and adjust the balance of) a user who's never traded - they implicitly
// have the configured starting wallet balance and no holdings until getOrCreateWallet() lazily
// creates their real row. This is also the single source for the
// consolidated admin Users table, so it carries the login/link/turnover
// fields that used to live on the separate Admin Users and Market Stats
// pages.
export function getAdminWalletOverview(): AdminWalletOverviewEntry[] {
  const startingBalance = getStartingWalletBalance();
  const users = db
    .prepare(
      `SELECT u.discord_id, u.username, u.avatar, u.first_login_at, u.last_login_at,
              l.warrior_id AS linked_warrior_id, w.player_name AS linked_player_name, w.server AS linked_server, w.class AS linked_class
       FROM users u
       LEFT JOIN user_warrior_links l ON l.user_id = u.discord_id
       LEFT JOIN warriors w ON w.id = l.warrior_id`,
    )
    .all() as unknown as {
    discord_id: string;
    username: string;
    avatar: string | null;
    first_login_at: number;
    last_login_at: number;
    linked_warrior_id: number | null;
    linked_player_name: string | null;
    linked_server: string | null;
    linked_class: string | null;
  }[];
  const walletByUser = new Map(
    (db.prepare(`SELECT * FROM wallets`).all() as unknown as WalletRow[]).map(
      (w) => [w.user_id, w.balance],
    ),
  );
  const holdings = db
    .prepare(`SELECT * FROM holdings WHERE shares > 0`)
    .all() as unknown as HoldingRow[];

  const latestPrices = getAllLatestTradablePrices();

  const holdingsValueByUser = new Map<string, number>();
  for (const h of holdings) {
    const price = latestPrices.get(h.warrior_id) ?? 0;
    holdingsValueByUser.set(
      h.user_id,
      (holdingsValueByUser.get(h.user_id) ?? 0) + h.shares * price,
    );
  }

  const turnoverByUser = new Map<string, number>();
  const tradeCountByUser = new Map<string, number>();
  const turnoverRows = db
    .prepare(
      `SELECT user_id, SUM(total) AS turnover, COUNT(*) AS tradeCount FROM transactions GROUP BY user_id`,
    )
    .all() as unknown as {
    user_id: string;
    turnover: number;
    tradeCount: number;
  }[];
  for (const r of turnoverRows) {
    turnoverByUser.set(r.user_id, r.turnover);
    tradeCountByUser.set(r.user_id, r.tradeCount);
  }

  const fundHoldingsValueByUser = getFundHoldingsValueByUser();

  return users
    .map((u) => {
      const balance = walletByUser.get(u.discord_id) ?? startingBalance;
      const holdingsValue = holdingsValueByUser.get(u.discord_id) ?? 0;
      const fundHoldingsValue = fundHoldingsValueByUser.get(u.discord_id) ?? 0;
      return {
        userId: u.discord_id,
        username: u.username,
        avatar: u.avatar,
        linkedWarrior:
          u.linked_warrior_id !== null
            ? {
                id: u.linked_warrior_id,
                playerName: u.linked_player_name!,
                server: u.linked_server!,
                class: u.linked_class,
              }
            : null,
        firstLoginAt: u.first_login_at,
        lastLoginAt: u.last_login_at,
        balance,
        holdingsValue,
        netWorth: balance + holdingsValue + fundHoldingsValue,
        turnover: turnoverByUser.get(u.discord_id) ?? 0,
        tradeCount: tradeCountByUser.get(u.discord_id) ?? 0,
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
    createWalletNotification(
      targetUserId,
      delta,
      reason && reason.trim() !== '' ? reason : 'Manual adjustment by an admin',
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

// Bulk variant of adjustWalletBalance, for the Danger Zone's "global
// add/remove coins" tool (funds.md - most users start at 0 balance, and
// funds need to be affordable without forcing everyone to liquidate their
// stock positions first). Applies to EVERY registered user, including ones
// who've never traded and so have no wallets row yet (getOrCreateWallet
// lazily materializes it, same as the single-user path). Locked decision:
// if removal would take a user below 0, clamp that user to 0 and continue -
// never skip them, never abort the whole batch over one low balance. The
// audited/notified delta is the actual applied delta (post-clamp), not the
// raw requested one, so the audit trail and notification never claim a
// removal that didn't fully happen.
export function adjustAllWalletBalances(
  delta: number,
  adminDiscordId: string,
  reason: string | null,
): void {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new AdminActionError('Amount must be a non-zero number');
  }
  const userIds = (
    db.prepare(`SELECT discord_id FROM users`).all() as unknown as { discord_id: string }[]
  ).map((r) => r.discord_id);
  const now = Date.now();
  const finalReason = reason && reason.trim() !== '' ? reason : 'Global balance adjustment by an admin';

  db.exec('BEGIN');
  try {
    for (const userId of userIds) {
      const wallet = getOrCreateWallet(userId);
      const newBalance = Math.max(0, wallet.balance + delta);
      const appliedDelta = newBalance - wallet.balance;
      if (appliedDelta === 0) continue;
      db.prepare(`UPDATE wallets SET balance = ? WHERE user_id = ?`).run(newBalance, userId);
      db.prepare(
        `INSERT INTO admin_wallet_adjustments (admin_discord_id, target_user_id, delta, balance_after, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(adminDiscordId, userId, appliedDelta, newBalance, reason, now);
      createWalletNotification(userId, appliedDelta, finalReason);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

// Wipes market state back to a clean slate: every wallet reset to the
// configured starting wallet balance, all holdings/transactions/notifications cleared, and
// price_snapshots (both raid and drift) cleared - the caller is responsible
// for calling stock.ts's rebuildRaidPriceSnapshots() right after, and this
// resets last_drift_at so a stale timestamp doesn't fire an immediate
// catch-up drift tick against the freshly rebuilt prices. Raid/report data
// itself (reports, casts, damage, warriors, links) is untouched -
// out of scope for a *market* reset. admin_wallet_adjustments is also left
// alone - it's a historical admin-action audit log, not market state.
export function resetMarketState(): void {
  const startingBalance = getStartingWalletBalance();
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM transactions`).run();
    db.prepare(`DELETE FROM holdings`).run();
    db.prepare(`DELETE FROM notifications`).run();
    db.prepare(`UPDATE wallets SET balance = ?`).run(startingBalance);
    db.prepare(`UPDATE portfolio_snapshots SET net_worth = ?`).run(startingBalance);
    db.prepare(`DELETE FROM price_snapshots`).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  setLastDriftAt(Date.now());
}

export interface MarketSummary {
  totalMarketSize: number;
  totalTradeVolume: number;
}

// Public-safe headline numbers only - no per-warrior/per-trader breakdowns
// (those reveal identities+turnover, which is admin-only info per the trade
// feed's anonymization rules elsewhere; see getAdminWalletOverview and
// getWarriorVolumeOverview for the admin-only detail views).
export function getMarketSummary(): MarketSummary {
  const leaderboard = getLeaderboard();
  const totalMarketSize = leaderboard.reduce((sum, u) => sum + u.netWorth, 0);
  // All-time, every side (buy/sell/liquidation) included.
  const totalTradeVolume = (
    db
      .prepare(`SELECT COALESCE(SUM(total), 0) AS total FROM transactions`)
      .get() as unknown as { total: number }
  ).total;
  return { totalMarketSize, totalTradeVolume };
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

// ---------------------------------------------------------------------------
// Funds (see funds.md) - a fund is a synthetic basket of existing warriors.
// It never owns real warrior shares: pool_value/shares_outstanding is a
// mutual-fund-style ledger moved only by trades (executeFundTrade, mint/
// redeem at NAV) and the periodic valuation tick (fundValuation.ts), which
// sums constituent price changes weighted by stock_count and applies
// gain_multiplier/loss_multiplier. NAV is never stored directly - always
// derived via getCurrentFundNav so there is exactly one divide-by-zero guard
// (shares_outstanding === 0 falls back to seed_nav) rather than one per call
// site.
// ---------------------------------------------------------------------------

export class FundError extends Error {}

export interface FundRow {
  id: number;
  name: string;
  risk: number;
  fee_pct: number;
  tax_pct: number;
  description: string;
  gain_multiplier: number;
  loss_multiplier: number;
  seed_nav: number;
  pool_value: number;
  shares_outstanding: number;
  created_at: number;
  deleted_at: number | null;
}

export interface FundConstituentRow {
  id: number;
  fund_id: number;
  warrior_id: number;
  stock_count: number;
  last_snapshot_price: number | null;
}

export interface FundConstituentInput {
  playerName: string;
  server: string;
  stockCount: number;
}

export function getCurrentFundNav(fund: FundRow): number {
  return fund.shares_outstanding > 0
    ? fund.pool_value / fund.shares_outstanding
    : fund.seed_nav;
}

export function getActiveFunds(): FundRow[] {
  return db
    .prepare(`SELECT * FROM funds WHERE deleted_at IS NULL ORDER BY name ASC`)
    .all() as unknown as FundRow[];
}

export function getAllFundsIncludingDeleted(): FundRow[] {
  return db
    .prepare(`SELECT * FROM funds ORDER BY name ASC`)
    .all() as unknown as FundRow[];
}

export function getFundById(id: number): FundRow | null {
  return (
    (db.prepare(`SELECT * FROM funds WHERE id = ?`).get(id) as unknown as FundRow) ?? null
  );
}

export function getFundByName(name: string): FundRow | null {
  return (
    (db
      .prepare(`SELECT * FROM funds WHERE name = ?`)
      .get(name) as unknown as FundRow) ?? null
  );
}

export function getFundConstituents(
  fundId: number,
): (FundConstituentRow & { player_name: string; server: string })[] {
  return db
    .prepare(
      `SELECT fc.*, w.player_name, w.server
       FROM fund_constituents fc
       JOIN warriors w ON w.id = fc.warrior_id
       WHERE fc.fund_id = ?
       ORDER BY fc.stock_count DESC`,
    )
    .all(fundId) as unknown as (FundConstituentRow & {
    player_name: string;
    server: string;
  })[];
}

export interface FundValueSnapshotRow {
  id: number;
  fund_id: number;
  nav: number;
  pool_value: number;
  shares_outstanding: number;
  created_at: number;
}

// "Latest snapshot at or before this timestamp" - used for N-days-ago
// deltas (e.g. the public funds list's "Last 7 Days" figure). Returns null
// if the fund has no snapshot that old yet (younger than N days, or the
// valuation scheduler hasn't ticked yet) - callers treat that as "no
// visible change" rather than guessing.
export function getFundNavAt(fundId: number, atOrBefore: number): number | null {
  const row = db
    .prepare(
      `SELECT nav FROM fund_value_snapshots WHERE fund_id = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(fundId, atOrBefore) as unknown as { nav: number } | undefined;
  return row ? row.nav : null;
}

export function getFundValueSnapshotsSince(fundId: number, sinceMs: number): FundValueSnapshotRow[] {
  return db
    .prepare(
      `SELECT * FROM fund_value_snapshots WHERE fund_id = ? AND created_at >= ? ORDER BY created_at ASC, id ASC`,
    )
    .all(fundId, sinceMs) as unknown as FundValueSnapshotRow[];
}

const FUND_NAME_PATTERN = /^[A-Z]{1,6}$/;

function validateFundScalars(data: {
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  gainMultiplier: number;
  lossMultiplier: number;
}): string {
  const name = data.name.toUpperCase();
  if (!FUND_NAME_PATTERN.test(name)) {
    throw new FundError('Name must be 1-6 letters (a-z)');
  }
  if (!Number.isInteger(data.risk) || data.risk < 1 || data.risk > 5) {
    throw new FundError('Risk must be a whole number from 1 to 5');
  }
  if (!Number.isFinite(data.feePct) || data.feePct < 0) {
    throw new FundError('Fee must be a non-negative number');
  }
  if (!Number.isFinite(data.taxPct) || data.taxPct < 0) {
    throw new FundError('Tax must be a non-negative number');
  }
  if (!Number.isFinite(data.gainMultiplier) || data.gainMultiplier < 0) {
    throw new FundError('Gain multiplier must be a non-negative number');
  }
  if (!Number.isFinite(data.lossMultiplier) || data.lossMultiplier < 0) {
    throw new FundError('Loss multiplier must be a non-negative number');
  }
  return name;
}

// Resolves each (playerName, server) constituent to a warrior_id - unmatched
// names (e.g. an imported fund referencing a warrior that doesn't exist on
// this DB) are skipped rather than aborting the whole create, since a fund
// export/import is keyed by identity, not the non-portable warrior_id
// primary key (see funds.md's export/import ask). Duplicate warriors in the
// input are rejected outright rather than silently collapsed, since that's
// almost certainly a client-side bug, not a legitimate case.
function resolveConstituentInputs(
  inputs: FundConstituentInput[],
): { resolved: { warriorId: number; stockCount: number }[]; skipped: FundConstituentInput[] } {
  const resolved: { warriorId: number; stockCount: number }[] = [];
  const skipped: FundConstituentInput[] = [];
  const seen = new Set<number>();
  for (const c of inputs) {
    if (!Number.isFinite(c.stockCount) || c.stockCount <= 0) {
      throw new FundError(`Stock count for ${c.playerName} must be a positive number`);
    }
    const warriorId = getWarriorId(c.playerName, c.server);
    if (warriorId === null) {
      skipped.push(c);
      continue;
    }
    if (seen.has(warriorId)) {
      throw new FundError(`${c.playerName} is listed more than once`);
    }
    seen.add(warriorId);
    resolved.push({ warriorId, stockCount: c.stockCount });
  }
  return { resolved, skipped };
}

// Creates a fund and its initial constituent basket in one transaction.
// pool_value/shares_outstanding always start at 0 - a fund has no NAV
// movement of its own until someone actually buys in (see
// getCurrentFundNav's seed_nav fallback).
export function createFund(data: {
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  gainMultiplier: number;
  lossMultiplier: number;
  seedNav?: number;
  constituents: FundConstituentInput[];
}): { fund: FundRow; skippedConstituents: FundConstituentInput[] } {
  const name = validateFundScalars(data);
  if (getFundByName(name)) {
    throw new FundError(`A fund named ${name} already exists`);
  }
  const { resolved, skipped } = resolveConstituentInputs(data.constituents);

  const now = Date.now();
  db.exec('BEGIN');
  try {
    const result = db
      .prepare(
        `INSERT INTO funds (name, risk, fee_pct, tax_pct, description, gain_multiplier, loss_multiplier, seed_nav, pool_value, shares_outstanding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(
        name,
        data.risk,
        data.feePct,
        data.taxPct,
        data.description,
        data.gainMultiplier,
        data.lossMultiplier,
        data.seedNav ?? 100,
        now,
      );
    const fundId = Number(result.lastInsertRowid);
    const insertConstituent = db.prepare(
      `INSERT INTO fund_constituents (fund_id, warrior_id, stock_count, last_snapshot_price) VALUES (?, ?, ?, ?)`,
    );
    for (const c of resolved) {
      insertConstituent.run(fundId, c.warriorId, c.stockCount, getLatestPrice(c.warriorId));
    }
    db.exec('COMMIT');
    return { fund: getFundById(fundId)!, skippedConstituents: skipped };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Create-or-replace by name, for config import: unlike createFund's hard
// duplicate-name rejection, a name match here means "this is the same fund,
// resync it" - scalars are overwritten and the whole constituent basket is
// replaced with the imported one (direct stock_counts, no rebalance - this
// is a full resync, not an incremental admin edit).
export function upsertFund(data: {
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  gainMultiplier: number;
  lossMultiplier: number;
  seedNav?: number;
  constituents: FundConstituentInput[];
}): { fund: FundRow; skippedConstituents: FundConstituentInput[]; created: boolean } {
  const name = validateFundScalars(data);
  const existing = getFundByName(name);
  const { resolved, skipped } = resolveConstituentInputs(data.constituents);

  if (!existing) {
    const { fund, skippedConstituents } = createFund({ ...data, name, constituents: data.constituents });
    return { fund, skippedConstituents, created: true };
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE funds SET name = ?, risk = ?, fee_pct = ?, tax_pct = ?, description = ?, gain_multiplier = ?, loss_multiplier = ?, deleted_at = NULL WHERE id = ?`,
    ).run(name, data.risk, data.feePct, data.taxPct, data.description, data.gainMultiplier, data.lossMultiplier, existing.id);
    db.prepare(`DELETE FROM fund_constituents WHERE fund_id = ?`).run(existing.id);
    const insertConstituent = db.prepare(
      `INSERT INTO fund_constituents (fund_id, warrior_id, stock_count, last_snapshot_price) VALUES (?, ?, ?, ?)`,
    );
    for (const c of resolved) {
      insertConstituent.run(existing.id, c.warriorId, c.stockCount, getLatestPrice(c.warriorId));
    }
    db.exec('COMMIT');
    return { fund: getFundById(existing.id)!, skippedConstituents: skipped, created: false };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Scalar fields only - constituents are excluded here and go through
// addFundConstituent/removeFundConstituent/updateFundConstituentWeight
// instead, since adding/removing carries rebalance side effects a bulk
// scalar update shouldn't also trigger.
export function updateFund(
  id: number,
  data: {
    name: string;
    risk: number;
    feePct: number;
    taxPct: number;
    description: string;
    gainMultiplier: number;
    lossMultiplier: number;
  },
): FundRow {
  const fund = getFundById(id);
  if (!fund || fund.deleted_at !== null) throw new FundError('Unknown fund');
  const name = validateFundScalars(data);
  const nameTaken = db
    .prepare(`SELECT id FROM funds WHERE name = ? AND id != ?`)
    .get(name, id);
  if (nameTaken) throw new FundError(`A fund named ${name} already exists`);

  db.prepare(
    `UPDATE funds SET name = ?, risk = ?, fee_pct = ?, tax_pct = ?, description = ?, gain_multiplier = ?, loss_multiplier = ? WHERE id = ?`,
  ).run(
    name,
    data.risk,
    data.feePct,
    data.taxPct,
    data.description,
    data.gainMultiplier,
    data.lossMultiplier,
    id,
  );
  return getFundById(id)!;
}

// Proportional reweight: removes one constituent and rescales the survivors
// so their stock_counts still sum to the same total as before the removal
// (the ratio between survivors is preserved). A no-op if the warrior isn't
// actually a constituent, so callers like the hidden-warrior cascade (which
// walks every active fund regardless of membership) can call this
// unconditionally. Also the template for the hidden-constituent cascade in
// setPlayerHidden below - same formula, same function.
export function removeFundConstituent(fundId: number, warriorId: number): void {
  const constituents = db
    .prepare(`SELECT * FROM fund_constituents WHERE fund_id = ?`)
    .all(fundId) as unknown as FundConstituentRow[];
  const removed = constituents.find((c) => c.warrior_id === warriorId);
  if (!removed) return;

  const totalBefore = constituents.reduce((sum, c) => sum + c.stock_count, 0);
  const remainingBefore = totalBefore - removed.stock_count;

  db.exec('BEGIN');
  try {
    if (remainingBefore > 0) {
      const factor = totalBefore / remainingBefore;
      const updateStockCount = db.prepare(
        `UPDATE fund_constituents SET stock_count = ? WHERE id = ?`,
      );
      for (const c of constituents) {
        if (c.id === removed.id) continue;
        updateStockCount.run(c.stock_count * factor, c.id);
      }
    }
    db.prepare(`DELETE FROM fund_constituents WHERE id = ?`).run(removed.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Inverse of removeFundConstituent: adds a new constituent and rescales the
// existing ones down to make room, so the total stays constant. Seeds
// last_snapshot_price at the warrior's current price so this constituent's
// first valuation tick contributes zero change, not a garbage jump from
// whenever the fund itself was created.
export function addFundConstituent(
  fundId: number,
  warriorId: number,
  stockCount: number,
): void {
  if (!Number.isFinite(stockCount) || stockCount <= 0) {
    throw new FundError('Stock count must be a positive number');
  }
  const existing = db
    .prepare(`SELECT 1 FROM fund_constituents WHERE fund_id = ? AND warrior_id = ?`)
    .get(fundId, warriorId);
  if (existing) throw new FundError('This warrior is already a constituent of this fund');

  const constituents = db
    .prepare(`SELECT * FROM fund_constituents WHERE fund_id = ?`)
    .all(fundId) as unknown as FundConstituentRow[];
  const totalBefore = constituents.reduce((sum, c) => sum + c.stock_count, 0);
  if (totalBefore > 0 && stockCount >= totalBefore) {
    throw new FundError('New weight must be smaller than the current total weight');
  }

  db.exec('BEGIN');
  try {
    if (totalBefore > 0) {
      const factor = (totalBefore - stockCount) / totalBefore;
      const updateStockCount = db.prepare(
        `UPDATE fund_constituents SET stock_count = ? WHERE id = ?`,
      );
      for (const c of constituents) {
        updateStockCount.run(c.stock_count * factor, c.id);
      }
    }
    db.prepare(
      `INSERT INTO fund_constituents (fund_id, warrior_id, stock_count, last_snapshot_price) VALUES (?, ?, ?, ?)`,
    ).run(fundId, warriorId, stockCount, getLatestPrice(warriorId));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Direct weight override with no rebalance - a deliberate admin edit, unlike
// add/remove which carry rebalance side effects.
export function updateFundConstituentWeight(
  fundId: number,
  warriorId: number,
  stockCount: number,
): void {
  if (!Number.isFinite(stockCount) || stockCount <= 0) {
    throw new FundError('Stock count must be a positive number');
  }
  const result = db
    .prepare(`UPDATE fund_constituents SET stock_count = ? WHERE fund_id = ? AND warrior_id = ?`)
    .run(stockCount, fundId, warriorId);
  if (result.changes === 0) {
    throw new FundError('This warrior is not a constituent of this fund');
  }
}

export interface FundHoldingRow {
  user_id: string;
  fund_id: number;
  shares: number;
  cost_basis_total: number;
}

export interface FundTransactionRow {
  id: number;
  user_id: string;
  fund_id: number;
  side: 'buy' | 'sell' | 'liquidation';
  shares: number;
  nav: number;
  total: number;
  fee: number;
  tax: number;
  created_at: number;
}

export interface FundTransactionWithContext extends FundTransactionRow {
  fund_name: string;
  username: string;
  avatar: string | null;
}

export function listFundTransactions(
  opts: { fundId?: number; userId?: string; limit?: number } = {},
): FundTransactionWithContext[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.fundId !== undefined) {
    clauses.push('ft.fund_id = ?');
    params.push(opts.fundId);
  }
  if (opts.userId !== undefined) {
    clauses.push('ft.user_id = ?');
    params.push(opts.userId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(opts.limit ?? 100);

  return db
    .prepare(
      `SELECT ft.*, f.name AS fund_name, u.username, u.avatar
       FROM fund_transactions ft
       JOIN funds f ON f.id = ft.fund_id
       JOIN users u ON u.discord_id = ft.user_id
       ${where}
       ORDER BY ft.created_at DESC, ft.id DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as FundTransactionWithContext[];
}

export function listAllFundTransactionsForUser(userId: string): FundTransactionRow[] {
  return db
    .prepare(
      `SELECT * FROM fund_transactions WHERE user_id = ?
       ORDER BY fund_id ASC, created_at ASC, id ASC`,
    )
    .all(userId) as unknown as FundTransactionRow[];
}

export function getFundHolding(userId: string, fundId: number): FundHoldingRow | null {
  return (
    (db
      .prepare(`SELECT * FROM fund_holdings WHERE user_id = ? AND fund_id = ?`)
      .get(userId, fundId) as unknown as FundHoldingRow | undefined) ?? null
  );
}

export interface FundPositionView {
  fundId: number;
  name: string;
  risk: number;
  shares: number;
  costBasisTotal: number;
  nav: number;
  marketValue: number;
}

export function listFundHoldingsWithContext(userId: string): FundPositionView[] {
  const rows = db
    .prepare(
      `SELECT fh.*, f.name, f.risk, f.pool_value, f.shares_outstanding, f.seed_nav
       FROM fund_holdings fh
       JOIN funds f ON f.id = fh.fund_id
       WHERE fh.user_id = ? AND fh.shares > 0`,
    )
    .all(userId) as unknown as (FundHoldingRow & {
    name: string;
    risk: number;
    pool_value: number;
    shares_outstanding: number;
    seed_nav: number;
  })[];
  return rows.map((r) => {
    const nav = r.shares_outstanding > 0 ? r.pool_value / r.shares_outstanding : r.seed_nav;
    return {
      fundId: r.fund_id,
      name: r.name,
      risk: r.risk,
      shares: r.shares,
      costBasisTotal: r.cost_basis_total,
      nav,
      marketValue: r.shares * nav,
    };
  });
}

// Current market value of one user's fund positions - NOT folded into the
// warrior-holdings-only `holdings`/`holdingsValue` used elsewhere, but
// callers computing net worth (wallet summary, leaderboard, admin overview)
// must add this in too, or a fund purchase would visibly *shrink* a user's
// displayed net worth by exactly the fee (the fund value itself would
// otherwise be invisible).
export function getUserFundHoldingsValue(userId: string): number {
  const rows = db
    .prepare(
      `SELECT fh.shares, f.pool_value, f.shares_outstanding, f.seed_nav
       FROM fund_holdings fh JOIN funds f ON f.id = fh.fund_id
       WHERE fh.user_id = ? AND fh.shares > 0`,
    )
    .all(userId) as unknown as {
    shares: number;
    pool_value: number;
    shares_outstanding: number;
    seed_nav: number;
  }[];
  return rows.reduce((sum, r) => {
    const nav = r.shares_outstanding > 0 ? r.pool_value / r.shares_outstanding : r.seed_nav;
    return sum + r.shares * nav;
  }, 0);
}

// Batched equivalent of getUserFundHoldingsValue for every user with a fund
// position at once, for getLeaderboard()/getAdminWalletOverview() - avoids
// an N+1 query per user the way the warrior-holdings side already avoids it
// via a single latestPrices batch lookup.
function getFundHoldingsValueByUser(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT fh.user_id, fh.shares, f.pool_value, f.shares_outstanding, f.seed_nav
       FROM fund_holdings fh JOIN funds f ON f.id = fh.fund_id
       WHERE fh.shares > 0`,
    )
    .all() as unknown as {
    user_id: string;
    shares: number;
    pool_value: number;
    shares_outstanding: number;
    seed_nav: number;
  }[];
  const result = new Map<string, number>();
  for (const r of rows) {
    const nav = r.shares_outstanding > 0 ? r.pool_value / r.shares_outstanding : r.seed_nav;
    result.set(r.user_id, (result.get(r.user_id) ?? 0) + r.shares * nav);
  }
  return result;
}

// Batched "current price of every warrior" lookup for the fund valuation
// tick - avoids one getLatestPrice() query per constituent per fund.
// Includes 'raid_anchor' rows (unlike getAllLatestTradablePrices()), since
// funds should value against the current anchor, not just tradable prices.
//
// Ranks by created_at (not id): 'raid'/'raid_anchor' rows are inserted
// whenever a raid report is processed, which can be well after their
// created_at (the raid's actual in-game timestamp) trails newer drift/trade
// rows. A plain MAX(id) GROUP BY would let such a backdated row outrank a
// genuinely more recent snapshot.
export function getAllLatestWarriorPrices(): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT warrior_id, price FROM (
         SELECT warrior_id, price,
                ROW_NUMBER() OVER (
                  PARTITION BY warrior_id ORDER BY created_at DESC, id DESC
                ) AS rn
         FROM price_snapshots
       ) WHERE rn = 1`,
    )
    .all() as unknown as { warrior_id: number; price: number }[];
  return new Map(rows.map((r) => [r.warrior_id, r.price]));
}

// Same batched shape as getAllLatestWarriorPrices(), but excludes
// 'raid_anchor' rows - same reasoning as getLatestPrice()'s own exclusion:
// an anchor move is an audit record, never the live/tradable price. Needed
// wherever code wants "current price of every warrior" as a comparison set
// (e.g. percentile-ranking for the price-curve gating in stock.ts) without
// the batched query drifting semantics away from what getLatestPrice()
// would return for the same warrior one at a time.
//
// Ranks by created_at (not id): 'raid' rows are inserted whenever a raid
// report is processed, which can be well after their created_at (the raid's
// actual in-game timestamp) trails newer drift/trade rows. A plain MAX(id)
// GROUP BY would let such a backdated raid row outrank a genuinely more
// recent drift/trade snapshot - the same ordering getLatestPrice() uses.
export function getAllLatestTradablePrices(): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT warrior_id, price FROM (
         SELECT warrior_id, price,
                ROW_NUMBER() OVER (
                  PARTITION BY warrior_id ORDER BY created_at DESC, id DESC
                ) AS rn
         FROM price_snapshots
         WHERE source != 'raid_anchor'
       ) WHERE rn = 1`,
    )
    .all() as unknown as { warrior_id: number; price: number }[];
  return new Map(rows.map((r) => [r.warrior_id, r.price]));
}

// Lifetime raid attendance per warrior - true count of distinct raids
// they've participated in, used to gate drift reversion speed by tenure
// (see reversionStrengthForRaidCount in drift.ts). Deliberately NOT the
// same thing as the "Raids" column on the Stock page
// (client/src/pages/StockPage.tsx), which counts every price_snapshots row
// except 'raid_anchor' (so it includes drift/swing/trade events too) - a
// raid, whether a warrior's first ('raid'-tagged) or a later one
// ('raid_anchor'-tagged), always writes exactly one row per report per
// warrior, so counting distinct report codes across both tags is the
// correct "how many raids has this warrior actually been in" figure.
export function getWarriorRaidCounts(): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT warrior_id, COUNT(DISTINCT report_code) AS raid_count
       FROM price_snapshots
       WHERE source IN ('raid', 'raid_anchor')
       GROUP BY warrior_id`,
    )
    .all() as unknown as { warrior_id: number; raid_count: number }[];
  return new Map(rows.map((r) => [r.warrior_id, r.raid_count]));
}

export function getLastFundValuationAt(): number | null {
  const row = db
    .prepare(`SELECT last_fund_valuation_at FROM scheduler_state WHERE id = 1`)
    .get() as unknown as { last_fund_valuation_at: number | null } | undefined;
  return row ? row.last_fund_valuation_at : null;
}

export function setLastFundValuationAt(ts: number): void {
  db.prepare(
    `INSERT INTO scheduler_state (id, last_drift_at, last_fund_valuation_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_fund_valuation_at = excluded.last_fund_valuation_at`,
  ).run(ts, ts);
}

// Atomically applies one fund's valuation-tick result - updates pool_value
// and writes a matching fund_value_snapshots row (skipped via
// newPoolValue=null when the fund has no shares outstanding yet, since an
// untraded fund has no pool to move and NAV just reads seed_nav), and
// advances every given constituent's last_snapshot_price baseline for next
// tick. Called once per active fund from fundValuation.ts's
// runFundValuationTick(), which does the read-only rawChange computation
// beforehand - kept here (rather than in fundValuation.ts, unlike
// drift.ts's runDriftTick) because it's the one piece of this tick that
// needs BEGIN/COMMIT atomicity across two related tables.
export function recordFundValuationTick(
  fund: FundRow,
  newPoolValue: number | null,
  priceUpdates: { constituentId: number; price: number }[],
  now: number,
): void {
  db.exec('BEGIN');
  try {
    if (newPoolValue !== null) {
      db.prepare(`UPDATE funds SET pool_value = ? WHERE id = ?`).run(newPoolValue, fund.id);
      db.prepare(
        `INSERT INTO fund_value_snapshots (fund_id, nav, pool_value, shares_outstanding, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        fund.id,
        newPoolValue / fund.shares_outstanding,
        newPoolValue,
        fund.shares_outstanding,
        now,
      );
    }
    const updateStmt = db.prepare(`UPDATE fund_constituents SET last_snapshot_price = ? WHERE id = ?`);
    for (const u of priceUpdates) updateStmt.run(u.price, u.constituentId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export class FundTradeError extends Error {}

// Buy/sell fund shares at the current NAV, minted/redeemed mutual-fund
// style - NAV itself never moves here (only the periodic valuation tick
// moves it, see fundValuation.ts); trading only changes pool_value/
// shares_outstanding (supply), never touches warrior-market liquidity.
// Buy: fee_pct on top, added to cost basis excluded (mirrors executeTrade's
// `total` convention). Sell: avg-cost basis, tax_pct on the GAIN portion
// only (zero tax on a loss), same average-cost approach pnl.ts already uses
// for warrior trades. Same synchronous-transaction discipline as
// executeTrade - every read happens before BEGIN, nothing yields mid-trade.
export function executeFundTrade(
  userId: string,
  fundId: number,
  side: 'buy' | 'sell',
  coinAmount: number,
): FundTransactionRow {
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
    throw new FundTradeError('Amount must be a positive number');
  }
  const fund = getFundById(fundId);
  if (!fund || fund.deleted_at !== null) throw new FundTradeError('Unknown fund');

  const nav = getCurrentFundNav(fund);
  const wallet = getOrCreateWallet(userId);
  const holding = getFundHolding(userId, fundId);

  let shares = coinAmount / nav;
  let total = coinAmount;
  let fee = 0;
  let tax = 0;

  if (side === 'buy') {
    // pool_value is floored at 0 (see fundValuation.ts), so a fund can go
    // to but never below 0 NAV - at exactly 0, coinAmount / nav is
    // Infinity shares, so buys must be rejected outright rather than
    // minting an unbounded position for a real coin cost.
    if (nav <= 0) {
      throw new FundTradeError('This fund has 0 NAV and cannot be bought into right now');
    }
    fee = coinAmount * fund.fee_pct;
    // Cent-rounded comparison, same rationale as executeTrade - a client
    // "use 100% of balance" amount can differ from wallet.balance by a
    // sub-cent float rounding error while still displaying as the same
    // cent value.
    if (Math.round((coinAmount + fee) * 100) > Math.round(wallet.balance * 100)) {
      throw new FundTradeError('Insufficient balance');
    }
  } else {
    if (!holding || holding.shares <= 0) {
      throw new FundTradeError("You don't hold any shares of this fund");
    }
    const fullSellValue = holding.shares * nav;
    if (shares > holding.shares || Math.round(coinAmount * 100) >= Math.round(fullSellValue * 100)) {
      shares = holding.shares;
      total = shares * nav;
    }
    const avgCost = holding.cost_basis_total / holding.shares;
    const gain = total - avgCost * shares;
    tax = Math.max(0, gain) * fund.tax_pct;
  }

  const now = Date.now();
  db.exec('BEGIN');
  try {
    if (side === 'buy') {
      const newShares = (holding?.shares ?? 0) + shares;
      const newCostBasis = (holding?.cost_basis_total ?? 0) + total;
      db.prepare(
        `INSERT INTO fund_holdings (user_id, fund_id, shares, cost_basis_total) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, fund_id) DO UPDATE SET shares = excluded.shares, cost_basis_total = excluded.cost_basis_total`,
      ).run(userId, fundId, newShares, newCostBasis);
      db.prepare(`UPDATE wallets SET balance = balance - ? WHERE user_id = ?`).run(total + fee, userId);
      db.prepare(
        `UPDATE funds SET pool_value = pool_value + ?, shares_outstanding = shares_outstanding + ? WHERE id = ?`,
      ).run(total, shares, fundId);
    } else {
      const avgCost = holding!.cost_basis_total / holding!.shares;
      const remainingShares = holding!.shares - shares;
      if (remainingShares <= 0) {
        db.prepare(`DELETE FROM fund_holdings WHERE user_id = ? AND fund_id = ?`).run(userId, fundId);
      } else {
        db.prepare(
          `UPDATE fund_holdings SET shares = ?, cost_basis_total = ? WHERE user_id = ? AND fund_id = ?`,
        ).run(remainingShares, holding!.cost_basis_total - avgCost * shares, userId, fundId);
      }
      db.prepare(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`).run(total - tax, userId);
      db.prepare(
        `UPDATE funds SET pool_value = pool_value - ?, shares_outstanding = shares_outstanding - ? WHERE id = ?`,
      ).run(total, shares, fundId);
    }

    const result = db
      .prepare(
        `INSERT INTO fund_transactions (user_id, fund_id, side, shares, nav, total, fee, tax, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, fundId, side, shares, nav, total, fee, tax, now);

    db.exec('COMMIT');
    return {
      id: Number(result.lastInsertRowid),
      user_id: userId,
      fund_id: fundId,
      side,
      shares,
      nav,
      total,
      fee,
      tax,
      created_at: now,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Shared by every wallet-credit/debit notification (see funds.md's
// "Notification System" ask) - centralizes the
// "{coins} coins were (added to|removed from) your wallet. Reason: {reason}"
// format string in one place. Module-private: every call site lives in this
// file (liquidateWarriorHoldings, adjustWalletBalance, deleteFund, and the
// bulk adjustAllWalletBalances below).
function createWalletNotification(
  userId: string,
  delta: number,
  reason: string,
  opts?: { warriorId?: number | null; fundId?: number | null },
): void {
  const verb = delta >= 0 ? 'added to' : 'removed from';
  const message = `${Math.abs(delta).toFixed(2)} coins were ${verb} your wallet. Reason: ${reason}`;
  db.prepare(
    `INSERT INTO notifications (user_id, message, warrior_id, fund_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, message, opts?.warriorId ?? null, opts?.fundId ?? null, delta, Date.now());
}

// Soft-deletes a fund and refunds every holder at the fund's current NAV,
// penalty-free (no tax), mirroring liquidateWarriorHoldings' shape. History
// (fund_transactions, fund_value_snapshots) survives - only funds.deleted_at
// is set, never a hard DELETE, so a holder's past trades still resolve.
export function deleteFund(fundId: number, reason?: string): void {
  const fund = getFundById(fundId);
  if (!fund || fund.deleted_at !== null) throw new FundError('Unknown fund');

  const holders = db
    .prepare(`SELECT * FROM fund_holdings WHERE fund_id = ? AND shares > 0`)
    .all(fundId) as unknown as FundHoldingRow[];
  const nav = getCurrentFundNav(fund);
  const now = Date.now();
  const finalReason = reason && reason.trim() !== '' ? reason : `${fund.name} fund was deleted by an admin`;

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE funds SET deleted_at = ? WHERE id = ?`).run(now, fundId);
    for (const holding of holders) {
      const value = holding.shares * nav;
      db.prepare(`DELETE FROM fund_holdings WHERE user_id = ? AND fund_id = ?`).run(
        holding.user_id,
        fundId,
      );
      db.prepare(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`).run(
        value,
        holding.user_id,
      );
      db.prepare(
        `INSERT INTO fund_transactions (user_id, fund_id, side, shares, nav, total, fee, tax, created_at)
         VALUES (?, ?, 'liquidation', ?, ?, ?, 0, 0, ?)`,
      ).run(holding.user_id, fundId, holding.shares, nav, value, now);
      createWalletNotification(holding.user_id, value, finalReason, { fundId });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Weekly summaries (Admin > Summary page) - see weekly_summaries table
// comment for what this does and doesn't store.

export interface WeeklySummaryRow {
  id: number;
  week_start: number;
  week_end: number;
  content: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export function upsertWeeklySummary(
  weekStart: number,
  weekEnd: number,
  content: string,
  createdBy: string,
): WeeklySummaryRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO weekly_summaries (week_start, week_end, content, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_start, week_end) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(weekStart, weekEnd, content, createdBy, now, now);
  return db
    .prepare(`SELECT * FROM weekly_summaries WHERE week_start = ? AND week_end = ?`)
    .get(weekStart, weekEnd) as unknown as WeeklySummaryRow;
}

export function listWeeklySummaries(): WeeklySummaryRow[] {
  return db
    .prepare(`SELECT * FROM weekly_summaries ORDER BY week_start DESC`)
    .all() as unknown as WeeklySummaryRow[];
}

export function getWeeklySummaryByWeek(weekStart: number, weekEnd: number): WeeklySummaryRow | null {
  return (
    (db
      .prepare(`SELECT * FROM weekly_summaries WHERE week_start = ? AND week_end = ?`)
      .get(weekStart, weekEnd) as unknown as WeeklySummaryRow) ?? null
  );
}

export function getWeeklySummaryById(id: number): WeeklySummaryRow | null {
  return (
    (db.prepare(`SELECT * FROM weekly_summaries WHERE id = ?`).get(id) as unknown as WeeklySummaryRow) ?? null
  );
}

// ---------------------------------------------------------------------------
// Backups (Admin > Backup page) - see backup.ts for VACUUM INTO / scheduling
// / restore logic. This module only owns raw access to the `backups` and
// `backup_settings` tables and the scheduler_state backup columns, matching
// the rest of this file's role as the sole owner of the `db` connection.

export type BackupKind = 'hourly' | 'daily' | 'manual' | 'pre_report' | 'pre_restore';

export interface BackupRow {
  id: number;
  filename: string;
  kind: BackupKind;
  size_bytes: number;
  created_at: number;
}

// Runs SQLite's own consistent-snapshot export - safe to call even with
// concurrent readers/writers on `db`, unlike a raw file copy of the live
// database file (see backup.ts's restoreBackup for why a raw copy of the
// *backup* file back onto warrior.db is fine, but this direction - db to
// backup - always goes through SQLite itself).
export function vacuumInto(destPath: string): void {
  db.prepare(`VACUUM INTO ?`).run(destPath);
}

export function insertBackupRow(row: { filename: string; kind: BackupKind; sizeBytes: number; createdAt: number }): BackupRow {
  db.prepare(
    `INSERT INTO backups (filename, kind, size_bytes, created_at) VALUES (?, ?, ?, ?)`,
  ).run(row.filename, row.kind, row.sizeBytes, row.createdAt);
  return db
    .prepare(`SELECT * FROM backups WHERE filename = ?`)
    .get(row.filename) as unknown as BackupRow;
}

export function listBackupRows(): BackupRow[] {
  return db.prepare(`SELECT * FROM backups ORDER BY created_at DESC`).all() as unknown as BackupRow[];
}

export function listBackupRowsByKind(kind: BackupKind): BackupRow[] {
  return db
    .prepare(`SELECT * FROM backups WHERE kind = ? ORDER BY created_at DESC`)
    .all(kind) as unknown as BackupRow[];
}

export function getBackupRowById(id: number): BackupRow | null {
  return (db.prepare(`SELECT * FROM backups WHERE id = ?`).get(id) as unknown as BackupRow) ?? null;
}

export function deleteBackupRow(id: number): void {
  db.prepare(`DELETE FROM backups WHERE id = ?`).run(id);
}

export interface BackupSettings {
  retainHourly: number;
  retainDaily: number;
}

export function getBackupSettings(): BackupSettings {
  const row = db
    .prepare(`SELECT retain_hourly, retain_daily FROM backup_settings WHERE id = 1`)
    .get() as unknown as { retain_hourly: number; retain_daily: number } | undefined;
  return row ? { retainHourly: row.retain_hourly, retainDaily: row.retain_daily } : { retainHourly: 12, retainDaily: 3 };
}

export function setBackupSettings(retainHourly: number, retainDaily: number): void {
  db.prepare(
    `INSERT INTO backup_settings (id, retain_hourly, retain_daily) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET retain_hourly = excluded.retain_hourly, retain_daily = excluded.retain_daily`,
  ).run(retainHourly, retainDaily);
}

export function getLastHourlyBackupAt(): number | null {
  const row = db
    .prepare(`SELECT last_hourly_backup_at FROM scheduler_state WHERE id = 1`)
    .get() as unknown as { last_hourly_backup_at: number | null } | undefined;
  return row ? row.last_hourly_backup_at : null;
}

export function setLastHourlyBackupAt(ts: number): void {
  db.prepare(
    `INSERT INTO scheduler_state (id, last_drift_at, last_hourly_backup_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_hourly_backup_at = excluded.last_hourly_backup_at`,
  ).run(ts, ts);
}

export function getLastDailyBackupAt(): number | null {
  const row = db
    .prepare(`SELECT last_daily_backup_at FROM scheduler_state WHERE id = 1`)
    .get() as unknown as { last_daily_backup_at: number | null } | undefined;
  return row ? row.last_daily_backup_at : null;
}

export function setLastDailyBackupAt(ts: number): void {
  db.prepare(
    `INSERT INTO scheduler_state (id, last_drift_at, last_daily_backup_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_daily_backup_at = excluded.last_daily_backup_at`,
  ).run(ts, ts);
}
