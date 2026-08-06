import { Router } from "express";
import { fetchAndIngestReport } from "../ingest";
import { getReportDetail, listReports } from "../db";

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

reportsRouter.post("/", async (req, res) => {
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
