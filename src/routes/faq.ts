import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

export const faqRouter = Router();

// Read from disk on every request (not required into memory at boot) so
// editing FAQ.md takes effect immediately, no server restart needed.
const faqPath = path.join(__dirname, "..", "..", "FAQ.md");

faqRouter.get("/", (_req, res) => {
  fs.readFile(faqPath, "utf8", (err, content) => {
    if (err) {
      res.status(404).json({ error: "FAQ.md not found" });
      return;
    }
    res.type("text/markdown").send(content);
  });
});
