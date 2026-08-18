import { Router } from "express";
import fs from "node:fs";
import {
  createBackup,
  deleteBackup,
  getBackupPath,
  listBackups,
  pruneBackups,
  restoreBackup,
} from "../backup";
import { getBackupSettings, setBackupSettings } from "../db";

export const adminBackupRouter = Router();

function serializeBackup(row: ReturnType<typeof listBackups>[number]) {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

adminBackupRouter.get("/", (_req, res) => {
  res.json(listBackups().map(serializeBackup));
});

adminBackupRouter.get("/settings", (_req, res) => {
  res.json(getBackupSettings());
});

adminBackupRouter.put("/settings", (req, res) => {
  const { retainHourly, retainDaily } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof retainHourly !== "number" ||
    !Number.isInteger(retainHourly) ||
    retainHourly < 0 ||
    typeof retainDaily !== "number" ||
    !Number.isInteger(retainDaily) ||
    retainDaily < 0
  ) {
    res.status(400).json({ error: "retainHourly and retainDaily must be non-negative integers" });
    return;
  }
  setBackupSettings(retainHourly, retainDaily);
  // Apply the new limits immediately rather than waiting for the next tick,
  // matching how stock_config edits take effect without a restart.
  pruneBackups("hourly");
  pruneBackups("daily");
  res.json(getBackupSettings());
});

adminBackupRouter.post("/manual", (_req, res) => {
  const row = createBackup("manual");
  res.status(201).json(serializeBackup(row));
});

adminBackupRouter.get("/:id/download", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid backup id" });
    return;
  }
  const backup = getBackupPath(id);
  if (!backup || !fs.existsSync(backup.path)) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }
  res.download(backup.path, backup.filename);
});

adminBackupRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid backup id" });
    return;
  }
  try {
    deleteBackup(id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Backup not found" });
  }
});

// Highly destructive - replaces the entire live database and restarts the
// process (see backup.ts's restoreBackup). Gated behind the same typed-phrase
// confirmation pattern as POST /api/admin/market/reset.
adminBackupRouter.post("/:id/restore", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid backup id" });
    return;
  }
  if (req.body?.confirmationPhrase !== "RESTORE BACKUP") {
    res.status(400).json({ error: "Confirmation phrase didn't match" });
    return;
  }
  try {
    restoreBackup(id);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Backup not found" });
    return;
  }
  res.json({ restarting: true });
  // Let the response above flush before the process exits - the container's
  // restart policy (restart: unless-stopped) brings it back up reading the
  // freshly restored data/warrior.db. In local dev (tsx watch) this requires
  // a manual restart, since tsx only restarts on file changes.
  setImmediate(() => process.exit(0));
});
