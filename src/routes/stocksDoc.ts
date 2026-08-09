import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

export const stocksDocRouter = Router();

// Read from disk on every request (not required into memory at boot) so
// editing STOCKS.md takes effect immediately, no server restart needed -
// same pattern as faq.ts.
const stocksDocPath = path.join(__dirname, "..", "..", "STOCKS.md");

stocksDocRouter.get("/", (_req, res) => {
  fs.readFile(stocksDocPath, "utf8", (err, content) => {
    if (err) {
      res.status(404).json({ error: "STOCKS.md not found" });
      return;
    }
    res.type("text/markdown").send(content);
  });
});
