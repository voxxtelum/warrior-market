import { Router } from "express";
import { getWeeklySummaryById, listWeeklySummaries, upsertWeeklySummary, type WeeklySummaryRow } from "../db";
import { buildWeeklySummary } from "../summary";

export const adminSummaryRouter = Router();

function serializeSummary(row: WeeklySummaryRow) {
  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRangeQuery(req: { query: Record<string, unknown> }): { start: number; end: number } | null {
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

adminSummaryRouter.get("/", (req, res) => {
  const range = parseRangeQuery(req);
  if (!range) {
    res.status(400).json({ error: "Query params start and end (epoch ms, end >= start) are required" });
    return;
  }
  res.json(buildWeeklySummary(range.start, range.end));
});

// Registered before GET /history/:id so "history" itself never gets parsed
// as an id there - this route has no :id segment so there's no collision,
// but kept in the same relative order as the notifications router's
// meta-before-:id convention for consistency.
adminSummaryRouter.get("/history", (_req, res) => {
  res.json(listWeeklySummaries().map(serializeSummary));
});

adminSummaryRouter.get("/history/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid summary id" });
    return;
  }
  const row = getWeeklySummaryById(id);
  if (!row) {
    res.status(404).json({ error: "Unknown summary" });
    return;
  }
  res.json(serializeSummary(row));
});

adminSummaryRouter.put("/history", (req, res) => {
  const { weekStart, weekEnd, content } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof weekStart !== "number" ||
    typeof weekEnd !== "number" ||
    weekEnd < weekStart ||
    typeof content !== "string" ||
    content.trim() === ""
  ) {
    res.status(400).json({ error: "Request body must include weekStart, weekEnd (numbers) and content (non-empty string)" });
    return;
  }
  const saved = upsertWeeklySummary(weekStart, weekEnd, content, req.user!.discord_id);
  res.json(serializeSummary(saved));
});
