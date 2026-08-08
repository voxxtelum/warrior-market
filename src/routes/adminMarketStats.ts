import { Router } from "express";
import { getMarketStats } from "../db";

export const adminMarketStatsRouter = Router();

adminMarketStatsRouter.get("/", (_req, res) => {
  res.json(getMarketStats());
});
