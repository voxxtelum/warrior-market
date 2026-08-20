import { Router } from "express";
import {
  addWarriorBoardEntry,
  adjustWarriorBoardScore,
  listWarriorBoardEntries,
  removeWarriorBoardEntry,
  resetWarriorBoardBaseline,
  WarriorBoardError,
} from "../db";

export const adminWarriorBoardRouter = Router();

adminWarriorBoardRouter.get("/", (_req, res) => {
  res.json(listWarriorBoardEntries());
});

adminWarriorBoardRouter.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Request body must include a non-empty 'name' string" });
    return;
  }
  try {
    addWarriorBoardEntry(name);
    res.status(201).json(listWarriorBoardEntries());
  } catch (err) {
    if (err instanceof WarriorBoardError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminWarriorBoardRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  removeWarriorBoardEntry(id);
  res.json(listWarriorBoardEntries());
});

adminWarriorBoardRouter.post("/:id/adjust", (req, res) => {
  const id = Number(req.params.id);
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(id) || (delta !== 1 && delta !== -1)) {
    res.status(400).json({ error: "id must be an integer and delta must be 1 or -1" });
    return;
  }
  adjustWarriorBoardScore(id, delta);
  res.json(listWarriorBoardEntries());
});

adminWarriorBoardRouter.post("/mark-posted", (_req, res) => {
  resetWarriorBoardBaseline();
  res.json(listWarriorBoardEntries());
});
