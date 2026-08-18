import fs from "node:fs";
import path from "node:path";
import {
  dataDir,
  deleteBackupRow,
  getBackupRowById,
  getBackupSettings,
  getLastDailyBackupAt,
  getLastHourlyBackupAt,
  insertBackupRow,
  listBackupRows,
  listBackupRowsByKind,
  setLastDailyBackupAt,
  setLastHourlyBackupAt,
  vacuumInto,
  type BackupKind,
  type BackupRow,
} from "./db";

const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const backupsDir = path.join(dataDir, "backups");
fs.mkdirSync(backupsDir, { recursive: true });

const dbPath = path.join(dataDir, "warrior.db");

function fmtTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function createBackup(kind: BackupKind, opts?: { reportCode?: string }): BackupRow {
  const now = new Date();
  const suffix = opts?.reportCode ? `-${opts.reportCode}` : "";
  const filename = `warriors-${kind}-${fmtTimestamp(now)}${suffix}.db`;
  const destPath = path.join(backupsDir, filename);

  vacuumInto(destPath);
  const sizeBytes = fs.statSync(destPath).size;
  const row = insertBackupRow({ filename, kind, sizeBytes, createdAt: now.getTime() });

  if (kind === "hourly" || kind === "daily") {
    pruneBackups(kind);
  }

  return row;
}

// Only ever called with 'hourly'/'daily' - 'manual'/'pre_report'/'pre_restore'
// rows are kept until an admin deletes them explicitly (see AdminBackupPage).
export function pruneBackups(kind: "hourly" | "daily"): void {
  const settings = getBackupSettings();
  const retain = kind === "hourly" ? settings.retainHourly : settings.retainDaily;
  const rows = listBackupRowsByKind(kind);
  for (const row of rows.slice(Math.max(retain, 0))) {
    deleteBackupFile(row);
  }
}

export function listBackups(): BackupRow[] {
  return listBackupRows();
}

function deleteBackupFile(row: BackupRow): void {
  try {
    fs.unlinkSync(path.join(backupsDir, row.filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  deleteBackupRow(row.id);
}

export function deleteBackup(id: number): void {
  const row = getBackupRowById(id);
  if (!row) throw new Error("Backup not found");
  deleteBackupFile(row);
}

export function getBackupPath(id: number): { path: string; filename: string } | null {
  const row = getBackupRowById(id);
  if (!row) return null;
  return { path: path.join(backupsDir, row.filename), filename: row.filename };
}

// Replaces the live database file with a backup's contents and restarts the
// process - see the "Restore" section of the implementation plan for why
// this is copy-then-restart rather than an in-process hot-swap: `db` (the
// open DatabaseSync handle in db.ts) is never imported anywhere else in this
// codebase, so nothing needs live-swapping, but the open handle also means
// we can't safely keep serving requests against a file we just overwrote out
// from under it - the whole process must restart to get a clean re-open.
export function restoreBackup(id: number): void {
  const backup = getBackupPath(id);
  if (!backup) throw new Error("Backup not found");

  // Safety net: a bad restore is itself recoverable from the same list.
  createBackup("pre_restore");

  // Synchronous - blocks the event loop for its duration, which guarantees
  // no other request's handler can interleave a read/write against the file
  // while it's being overwritten.
  fs.copyFileSync(backup.path, dbPath);

  // Defensively clear any sidecar files so the next process start doesn't
  // try to replay a journal/WAL that no longer matches the restored content.
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

// Self-rescheduling setTimeout (not setInterval), same pattern as
// drift.ts's scheduleNextTick/startDriftScheduler - restart-safety comes
// from scheduler_state's last_*_backup_at columns, not process uptime.
function scheduleNext(kind: "hourly" | "daily") {
  const intervalMs = kind === "hourly" ? HOURLY_INTERVAL_MS : DAILY_INTERVAL_MS;
  setTimeout(() => {
    createBackup(kind);
    if (kind === "hourly") setLastHourlyBackupAt(Date.now());
    else setLastDailyBackupAt(Date.now());
    scheduleNext(kind);
  }, intervalMs).unref();
}

function startScheduler(kind: "hourly" | "daily") {
  const intervalMs = kind === "hourly" ? HOURLY_INTERVAL_MS : DAILY_INTERVAL_MS;
  const lastAt = kind === "hourly" ? getLastHourlyBackupAt() : getLastDailyBackupAt();
  const elapsed = lastAt === null ? Infinity : Date.now() - lastAt;

  const runNow = () => {
    createBackup(kind);
    if (kind === "hourly") setLastHourlyBackupAt(Date.now());
    else setLastDailyBackupAt(Date.now());
    scheduleNext(kind);
  };

  if (elapsed >= intervalMs) {
    runNow();
  } else {
    setTimeout(runNow, intervalMs - elapsed).unref();
  }
}

export function startBackupScheduler() {
  startScheduler("hourly");
  startScheduler("daily");
}
