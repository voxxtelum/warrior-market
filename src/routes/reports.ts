import { Router } from "express";
import { fetchAndIngestReport } from "../ingest";
import { deleteReport, getReportDetail, liquidateOrphanedHoldings, listReports } from "../db";
import { requireAdmin } from "../middleware/auth";
import { rebuildRaidPriceSnapshots } from "../stock";

export const reportsRouter = Router();

reportsRouter.get("/", (_req, res) => {
  res.json(listReports());
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

reportsRouter.delete("/:code", requireAdmin, (req, res) => {
  const detail = getReportDetail(req.params.code);
  if (!detail.report) {
    res.status(404).json({ error: "Report not found" });
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
