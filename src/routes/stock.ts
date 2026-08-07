import { Router } from "express";
import { computeStock, loadStockConfig } from "../stock";
import type { StockConfig } from "../stock";
import { setStockConfigRaw } from "../db";
import { requireAdmin } from "../middleware/auth";

export const stockRouter = Router();

stockRouter.get("/", (_req, res) => {
  res.json(computeStock());
});

stockRouter.get("/config", requireAdmin, (_req, res) => {
  res.json(loadStockConfig());
});

const NUMERIC_FIELDS: (keyof StockConfig)[] = [
  "tankTopN",
  "tankMinUptimePct",
  "minBucketSize",
  "coldStartReports",
  "dpsEmaAlpha",
  "damageWeight",
  "castWeight",
  "priceSensitivity",
  "startingPrice",
  "newPlayerGraceReports",
  "newPlayerPenaltyLeniency",
  "minAttendancePct",
  "damageTrendWeight",
  "damagePeerWeight",
  "damageTrendZClamp",
];

function validateStockConfig(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Request body must be a JSON object";
  const cfg = body as Record<string, unknown>;

  if (!Array.isArray(cfg.abilities)) return "'abilities' must be an array";
  for (const a of cfg.abilities) {
    if (
      !a ||
      typeof a !== "object" ||
      typeof (a as Record<string, unknown>).id !== "number" ||
      typeof (a as Record<string, unknown>).name !== "string" ||
      typeof (a as Record<string, unknown>).weight !== "number" ||
      typeof (a as Record<string, unknown>).bucket !== "string"
    ) {
      return "Each ability needs a numeric id, string name, numeric weight, and string bucket";
    }
  }

  for (const field of NUMERIC_FIELDS) {
    const value = cfg[field];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return `'${field}' must be a number`;
    }
  }

  return null;
}

stockRouter.put("/config", requireAdmin, (req, res) => {
  const error = validateStockConfig(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  setStockConfigRaw(JSON.stringify(req.body));
  res.status(204).end();
});
