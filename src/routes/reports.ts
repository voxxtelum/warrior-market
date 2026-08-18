import { Router } from "express";
import { fetchAndIngestReport } from "../ingest";
import { deleteReport, getReportDetail, liquidateOrphanedHoldings, listReports } from "../db";
import { requireAdmin } from "../middleware/auth";
import { commitReport, computeReportPriceImpact, rebuildRaidPriceSnapshots } from "../stock";

export const reportsRouter = Router();

// Includes pending reports deliberately - the admin page needs to see the
// held report (title/zone/status) to recover its "showing the preview"
// state on load/refresh, and to disable the Add form while one is pending.
reportsRouter.get("/", (_req, res) => {
  res.json(listReports({ includePending: true }));
});

reportsRouter.get("/:code", (req, res) => {
  const detail = getReportDetail(req.params.code);
  if (!detail.report) {
    res.status(404).json({ error: "Report not found in local data" });
    return;
  }
  res.json(detail);
});

reportsRouter.post("/", requireAdmin, async (req, res) => {
  const url = req.body?.url;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Request body must include a 'url' string" });
    return;
  }

  try {
    const result = await fetchAndIngestReport(url);
    res.status(201).json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Compute-only, safe to call repeatedly (e.g. "Refresh" after a stock_config
// edit on the Stock Config tab) - never writes.
reportsRouter.get("/:code/preview", requireAdmin, (req, res) => {
  const detail = getReportDetail(req.params.code);
  if (!detail.report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (detail.report.status !== "pending") {
    res.status(409).json({ error: "This report is not pending review" });
    return;
  }
  const participants = computeReportPriceImpact(req.params.code);
  res.json({ reportCode: req.params.code, title: detail.report.title, zone: detail.report.zone, participants });
});

// The actual live push - same response shape as /preview so the client can
// reuse one render path for "about to happen" and "just happened."
reportsRouter.post("/:code/commit", requireAdmin, (req, res) => {
  try {
    const participants = commitReport(req.params.code);
    const detail = getReportDetail(req.params.code);
    res.json({ reportCode: req.params.code, title: detail.report!.title, zone: detail.report!.zone, participants });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reportsRouter.delete("/:code", requireAdmin, (req, res) => {
  const detail = getReportDetail(req.params.code);
  if (!detail.report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (detail.report.status === "pending") {
    // Discarding a held-but-never-applied report: nothing was ever written
    // to price_snapshots/anchor_price/raid_anchor_price for it, so there's
    // nothing to undo - just remove the raw rows. Deliberately skips
    // rebuildRaidPriceSnapshots/liquidateOrphanedHoldings, both of which
    // exist only to undo an already-committed report's live effects. A
    // warrior discovered only in this discarded report stays in the
    // warriors table (auto-hidden, zero price_snapshots rows) - the same
    // inert state as any not-yet-unhidden first-time raider, intentionally
    // left alone rather than cleaned up.
    deleteReport(req.params.code);
    res.status(204).end();
    return;
  }

  // Captured before deleteReport() removes this report's damage rows -
  // scopes the anchor rebuild to just these warriors (see
  // rebuildRaidPriceSnapshots's own comment) rather than resetting every
  // warrior in the game over one unrelated report going away.
  const participantKeys = new Set(detail.damage.map((d) => `${d.player_name}::${d.server}`));
  deleteReport(req.params.code);
  rebuildRaidPriceSnapshots({ participantKeys, deletedReportCode: req.params.code });
  liquidateOrphanedHoldings();
  res.status(204).end();
});
