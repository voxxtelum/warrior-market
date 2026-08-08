import { Router } from "express";
import { getAllCasts, getAllDamage, getAllDamageTaken } from "../db";

export const warriorsRouter = Router();

interface WarriorStats {
  player_name: string;
  server: string;
  totalDamage: number;
  damageByInstance: Record<string, number>;
  totalDamageTaken: number;
  damageTakenByInstance: Record<string, number>;
  totalCasts: number;
  castsByInstance: Record<string, number>;
}

warriorsRouter.get("/", (_req, res) => {
  const byKey = new Map<string, WarriorStats>();

  function get(playerName: string, server: string): WarriorStats {
    const key = `${playerName}::${server}`;
    let stats = byKey.get(key);
    if (!stats) {
      stats = {
        player_name: playerName,
        server,
        totalDamage: 0,
        damageByInstance: {},
        totalDamageTaken: 0,
        damageTakenByInstance: {},
        totalCasts: 0,
        castsByInstance: {},
      };
      byKey.set(key, stats);
    }
    return stats;
  }

  for (const d of getAllDamage()) {
    const stats = get(d.player_name, d.server);
    const instance = d.zone ?? "Unknown";
    stats.totalDamage += d.total_damage;
    stats.damageByInstance[instance] = (stats.damageByInstance[instance] ?? 0) + d.total_damage;
  }

  for (const d of getAllDamageTaken()) {
    const stats = get(d.player_name, d.server);
    const instance = d.zone ?? "Unknown";
    stats.totalDamageTaken += d.total_taken;
    stats.damageTakenByInstance[instance] = (stats.damageTakenByInstance[instance] ?? 0) + d.total_taken;
  }

  for (const c of getAllCasts()) {
    const stats = get(c.player_name, c.server);
    const instance = c.zone ?? "Unknown";
    stats.totalCasts += c.cast_count;
    stats.castsByInstance[instance] = (stats.castsByInstance[instance] ?? 0) + c.cast_count;
  }

  res.json(
    Array.from(byKey.values()).sort((a, b) => a.player_name.localeCompare(b.player_name)),
  );
});
