import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { reportsRouter } from "./routes/reports";
import { compareRouter } from "./routes/compare";
import { playersRouter } from "./routes/players";
import { stockRouter } from "./routes/stock";
import { overviewRouter } from "./routes/overview";
import { authRouter } from "./routes/auth";
import { adminUsersRouter } from "./routes/adminUsers";
import { tradingRouter } from "./routes/trading";
import { notificationsRouter } from "./routes/notifications";
import { adminMarketStatsRouter } from "./routes/adminMarketStats";
import { adminMarketRouter } from "./routes/adminMarket";
import { attachUser, requireAdmin } from "./middleware/auth";
import { backfillPriceSnapshotsIfNeeded } from "./stock";
import { startDriftScheduler } from "./drift";

// One-time (idempotent) migration for installs with pre-existing raid
// history, so trading has a price series to read from immediately.
backfillPriceSnapshotsIfNeeded();
startDriftScheduler();

const app = express();
app.use(express.json());
app.use(cookieParser(process.env.SESSION_COOKIE_SECRET));
app.use(attachUser);

app.use("/api/auth", authRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/compare", compareRouter);
app.use("/api/players", requireAdmin, playersRouter);
app.use("/api/stock", stockRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/admin/users", requireAdmin, adminUsersRouter);
app.use("/api/trading", tradingRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/admin/market-stats", requireAdmin, adminMarketStatsRouter);
app.use("/api/admin/market", requireAdmin, adminMarketRouter);

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// SPA fallback: any non-API GET that isn't a static asset is a client-side
// route (react-router handles it, including the "/" -> "/stock" redirect),
// so always hand back index.html rather than 404ing.
app.get("*", (_req, res) => {
  const indexPath = path.join(clientDist, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(500).send("Client build not found - run `npm run build`, or use the Vite dev server on :5173 instead of hitting this port directly.");
    }
  });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Warrior log dashboard running at http://localhost:${port}`);
});
