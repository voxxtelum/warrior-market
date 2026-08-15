import { Router } from "express";
import { computeStock, loadStockConfig } from "../stock";
import type { StockConfig } from "../stock";
import { getAllPriceSnapshots, getLinkedAvatarsByIdentity, setStockConfigRaw } from "../db";
import { requireAdmin } from "../middleware/auth";

export const stockRouter = Router();

// computeStock() itself stays user-unaware (pure function of raid data) -
// the linked Discord avatar is merged in here, at the response boundary.
stockRouter.get("/", (_req, res) => {
  const stock = computeStock();
  const avatars = getLinkedAvatarsByIdentity();
  res.json(stock.map((s) => ({ ...s, avatar: avatars.get(`${s.player_name}::${s.server}`) ?? null })));
});

// The immutable snapshot ledger (raid + drift points together), shaped for
// charting - this is what the Stock page's chart reads post-Phase-4, since
// it's the only series dense enough to show drift and the only one that
// can't be retroactively changed by a later stock_config edit.
stockRouter.get("/history", (_req, res) => {
  const rows = getAllPriceSnapshots();
  const byPlayer = new Map<
    string,
    {
      player_name: string;
      server: string;
      series: { created_at: number; price: number; delta: number | null; source: string; report_code: string | null }[];
    }
  >();
  for (const row of rows) {
    const key = `${row.player_name}::${row.server}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, { player_name: row.player_name, server: row.server, series: [] });
    }
    byPlayer.get(key)!.series.push({
      created_at: row.created_at,
      price: row.price,
      delta: row.delta,
      source: row.source,
      report_code: row.report_code,
    });
  }
  res.json(Array.from(byPlayer.values()));
});

stockRouter.get("/config", requireAdmin, (_req, res) => {
  res.json(loadStockConfig());
});

const NUMERIC_FIELDS: (keyof StockConfig)[] = [
  "tankTopN",
  "minBucketSize",
  "coldStartReports",
  "dpsEmaAlpha",
  "damageWeight",
  "castWeight",
  "pricePerScorePointUp",
  "pricePerScorePointDown",
  "startingPrice",
  "startingWalletBalance",
  "newPlayerGraceReports",
  "newPlayerPenaltyLeniency",
  "minAttendancePct",
  "damageTrendWeight",
  "damagePeerWeight",
  "damageTrendZClampUp",
  "damageTrendZClampDown",
  "driftIntervalMs",
  "fundValuationIntervalMs",
  "driftMaxPct",
  "driftReversionStrength",
  "demandMaxPctPerTrade",
  "demandLiquidityDenominator",
  "tradeFeePct",
  "demandAnchorDecayPct",
  "marketGravityStrength",
  "swingChancePct",
  "swingUpMagnitude",
  "swingDownMagnitude",
  "swingMagnitudeFuzz",
  "swingCooldownGapPct",
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

  if (!Array.isArray(cfg.tankTopNByZone)) return "'tankTopNByZone' must be an array";
  for (const z of cfg.tankTopNByZone) {
    if (
      !z ||
      typeof z !== "object" ||
      typeof (z as Record<string, unknown>).zone !== "string" ||
      typeof (z as Record<string, unknown>).topN !== "number"
    ) {
      return "Each tankTopNByZone entry needs a string zone and numeric topN";
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
