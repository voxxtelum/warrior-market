import { Router } from "express";
import {
  FundError,
  addFundConstituent,
  createFund,
  deleteFund,
  getAllFundsIncludingDeleted,
  getCurrentFundNav,
  getFundById,
  getFundConstituents,
  getWarriorId,
  removeFundConstituent,
  updateFund,
  updateFundConstituentWeight,
  type FundConstituentInput,
  type FundRow,
} from "../db";
import { computeFundStats } from "../fundStats";

export const adminFundsRouter = Router();

function serializeFund(fund: FundRow) {
  return {
    id: fund.id,
    name: fund.name,
    risk: fund.risk,
    feePct: fund.fee_pct,
    taxPct: fund.tax_pct,
    description: fund.description,
    gainMultiplier: fund.gain_multiplier,
    lossMultiplier: fund.loss_multiplier,
    seedNav: fund.seed_nav,
    nav: getCurrentFundNav(fund),
    poolValue: fund.pool_value,
    sharesOutstanding: fund.shares_outstanding,
    createdAt: fund.created_at,
    deletedAt: fund.deleted_at,
  };
}

function parseConstituentInputs(body: unknown): FundConstituentInput[] | null {
  if (!Array.isArray(body)) return null;
  const result: FundConstituentInput[] = [];
  for (const item of body) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).playerName !== "string" ||
      typeof (item as Record<string, unknown>).server !== "string" ||
      typeof (item as Record<string, unknown>).stockCount !== "number"
    ) {
      return null;
    }
    const c = item as Record<string, unknown>;
    result.push({
      playerName: c.playerName as string,
      server: c.server as string,
      stockCount: c.stockCount as number,
    });
  }
  return result;
}

adminFundsRouter.get("/", (_req, res) => {
  res.json(getAllFundsIncludingDeleted().map(serializeFund));
});

adminFundsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid fund id" });
    return;
  }
  const fund = getFundById(id);
  if (!fund) {
    res.status(404).json({ error: "Unknown fund" });
    return;
  }
  res.json({
    ...serializeFund(fund),
    constituents: getFundConstituents(id).map((c) => ({
      warriorId: c.warrior_id,
      playerName: c.player_name,
      server: c.server,
      stockCount: c.stock_count,
    })),
  });
});

adminFundsRouter.post("/", (req, res) => {
  const { name, risk, feePct, taxPct, description, gainMultiplier, lossMultiplier, constituents } =
    req.body ?? {};
  if (
    typeof name !== "string" ||
    typeof risk !== "number" ||
    typeof feePct !== "number" ||
    typeof taxPct !== "number" ||
    typeof description !== "string" ||
    typeof gainMultiplier !== "number" ||
    typeof lossMultiplier !== "number"
  ) {
    res.status(400).json({
      error:
        "Request body must include name, risk, feePct, taxPct, description, gainMultiplier, lossMultiplier",
    });
    return;
  }
  const parsedConstituents = parseConstituentInputs(constituents ?? []);
  if (!parsedConstituents) {
    res.status(400).json({ error: "constituents must be an array of {playerName, server, stockCount}" });
    return;
  }

  try {
    const { fund, skippedConstituents } = createFund({
      name,
      risk,
      feePct,
      taxPct,
      description,
      gainMultiplier,
      lossMultiplier,
      constituents: parsedConstituents,
    });
    res.status(201).json({ ...serializeFund(fund), skippedConstituents });
  } catch (err) {
    if (err instanceof FundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminFundsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid fund id" });
    return;
  }
  const { name, risk, feePct, taxPct, description, gainMultiplier, lossMultiplier } = req.body ?? {};
  if (
    typeof name !== "string" ||
    typeof risk !== "number" ||
    typeof feePct !== "number" ||
    typeof taxPct !== "number" ||
    typeof description !== "string" ||
    typeof gainMultiplier !== "number" ||
    typeof lossMultiplier !== "number"
  ) {
    res.status(400).json({
      error:
        "Request body must include name, risk, feePct, taxPct, description, gainMultiplier, lossMultiplier",
    });
    return;
  }
  try {
    res.json(serializeFund(updateFund(id, { name, risk, feePct, taxPct, description, gainMultiplier, lossMultiplier })));
  } catch (err) {
    if (err instanceof FundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminFundsRouter.post("/:id/constituents", (req, res) => {
  const fundId = Number(req.params.id);
  const { playerName, server, stockCount } = req.body ?? {};
  if (
    !Number.isInteger(fundId) ||
    typeof playerName !== "string" ||
    typeof server !== "string" ||
    typeof stockCount !== "number"
  ) {
    res.status(400).json({ error: "Request body must include playerName, server, stockCount" });
    return;
  }
  const warriorId = getWarriorId(playerName, server);
  if (warriorId === null) {
    res.status(404).json({ error: "Unknown warrior" });
    return;
  }
  try {
    addFundConstituent(fundId, warriorId, stockCount);
    res.status(204).end();
  } catch (err) {
    if (err instanceof FundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminFundsRouter.delete("/:id/constituents/:warriorId", (req, res) => {
  const fundId = Number(req.params.id);
  const warriorId = Number(req.params.warriorId);
  if (!Number.isInteger(fundId) || !Number.isInteger(warriorId)) {
    res.status(400).json({ error: "Invalid fund or warrior id" });
    return;
  }
  removeFundConstituent(fundId, warriorId);
  res.status(204).end();
});

adminFundsRouter.put("/:id/constituents/:warriorId", (req, res) => {
  const fundId = Number(req.params.id);
  const warriorId = Number(req.params.warriorId);
  const { stockCount } = req.body ?? {};
  if (!Number.isInteger(fundId) || !Number.isInteger(warriorId) || typeof stockCount !== "number") {
    res.status(400).json({ error: "Request body must include stockCount (number)" });
    return;
  }
  try {
    updateFundConstituentWeight(fundId, warriorId, stockCount);
    res.status(204).end();
  } catch (err) {
    if (err instanceof FundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminFundsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid fund id" });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  try {
    deleteFund(id, reason);
    res.status(204).end();
  } catch (err) {
    if (err instanceof FundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminFundsRouter.get("/:id/stats", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid fund id" });
    return;
  }
  const fund = getFundById(id);
  if (!fund) {
    res.status(404).json({ error: "Unknown fund" });
    return;
  }
  const constituents = getFundConstituents(id).map((c) => ({
    warriorId: c.warrior_id,
    stockCount: c.stock_count,
  }));
  res.json(computeFundStats(constituents, fund.gain_multiplier, fund.loss_multiplier));
});

// Live estimate for a fund still being drafted in FundForm - same math as
// the saved-fund endpoint above, but takes constituents/multipliers
// straight from the request body instead of an existing row. Unmatched
// (playerName, server) pairs are silently dropped rather than erroring,
// since this is just a preview.
adminFundsRouter.post("/stats/estimate", (req, res) => {
  const { constituents, gainMultiplier, lossMultiplier } = req.body ?? {};
  const parsedConstituents = parseConstituentInputs(constituents);
  if (!parsedConstituents || typeof gainMultiplier !== "number" || typeof lossMultiplier !== "number") {
    res.status(400).json({
      error:
        "Request body must include constituents ({playerName, server, stockCount}[]), gainMultiplier, lossMultiplier",
    });
    return;
  }
  const resolved: { warriorId: number; stockCount: number }[] = [];
  for (const c of parsedConstituents) {
    const warriorId = getWarriorId(c.playerName, c.server);
    if (warriorId !== null) resolved.push({ warriorId, stockCount: c.stockCount });
  }
  res.json(computeFundStats(resolved, gainMultiplier, lossMultiplier));
});
