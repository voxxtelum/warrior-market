import "dotenv/config";
import express from "express";
import path from "node:path";
import { reportsRouter } from "./routes/reports";
import { compareRouter } from "./routes/compare";
import { playersRouter } from "./routes/players";
import { stockRouter } from "./routes/stock";
import { overviewRouter } from "./routes/overview";

const app = express();
app.use(express.json());

app.use("/api/reports", reportsRouter);
app.use("/api/compare", compareRouter);
app.use("/api/players", playersRouter);
app.use("/api/stock", stockRouter);
app.use("/api/overview", overviewRouter);

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
