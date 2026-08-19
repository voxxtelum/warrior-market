import { Router } from "express";
import { applyRaidLedgerCorrections, findRaidLedgerCorrections } from "../raidLedgerRepair";
import { createBackup } from "../backup";

// Temporary, one-off tooling for the historical raid-ledger corruption
// described in raidLedgerRepair.ts - mounted (requireAdmin) in server.ts.
// Delete this file, the mount line, and the client page/nav entry once it's
// been run in production.
export const adminRaidRepairRouter = Router();

// Read-only, safe to call repeatedly (e.g. after a partial apply, or just
// to double-check before committing).
adminRaidRepairRouter.get("/preview", (_req, res) => {
  res.json({ corrections: findRaidLedgerCorrections() });
});

// Recomputes fresh server-side rather than trusting whatever the client
// last previewed - avoids acting on a stale diff if anything changed
// between preview and apply.
adminRaidRepairRouter.post("/apply", (_req, res) => {
  const corrections = findRaidLedgerCorrections();
  if (corrections.length === 0) {
    res.json({ applied: 0 });
    return;
  }
  createBackup("manual");
  applyRaidLedgerCorrections(corrections);
  res.json({ applied: corrections.length });
});
