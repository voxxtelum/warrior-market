import { Router } from "express";
import { getCastsForZone, getDamageForZone, getReportsForZone, listZones } from "../db";
import trackedConfig from "../../config.json";

export const compareRouter = Router();

compareRouter.get("/zones", (_req, res) => {
  res.json(listZones());
});

compareRouter.get("/config", (_req, res) => {
  res.json(trackedConfig);
});

compareRouter.get("/", (req, res) => {
  const zone = req.query.zone;
  if (!zone || typeof zone !== "string") {
    res.status(400).json({ error: "Query param 'zone' is required" });
    return;
  }

  const reports = getReportsForZone(zone);
  const castRows = getCastsForZone(zone);
  const damageRows = getDamageForZone(zone);

  // Two different characters can share a display name (e.g. same name on
  // different realms) - identity is (player_name, server), but we only want
  // to clutter the UI with a "(server)" suffix for names that actually
  // collide within this zone's data.
  const serversByName = new Map<string, Set<string>>();
  for (const row of [...castRows, ...damageRows]) {
    if (!serversByName.has(row.player_name)) serversByName.set(row.player_name, new Set());
    serversByName.get(row.player_name)!.add(row.server);
  }
  function displayName(name: string, server: string): string {
    const servers = serversByName.get(name);
    return servers && servers.size > 1 ? `${name} (${server})` : name;
  }

  const castsByKey = new Map<
    string,
    { player_name: string; ability_id: number; ability_name: string; values: Record<string, number> }
  >();
  for (const row of castRows) {
    const key = `${row.player_name}::${row.server}::${row.ability_id}`;
    if (!castsByKey.has(key)) {
      castsByKey.set(key, {
        player_name: displayName(row.player_name, row.server),
        ability_id: row.ability_id,
        ability_name: row.ability_name,
        values: {},
      });
    }
    castsByKey.get(key)!.values[row.report_code] = row.cast_count;
  }

  const damageByPlayer = new Map<string, { player_name: string; values: Record<string, number> }>();
  for (const row of damageRows) {
    const key = `${row.player_name}::${row.server}`;
    if (!damageByPlayer.has(key)) {
      damageByPlayer.set(key, { player_name: displayName(row.player_name, row.server), values: {} });
    }
    damageByPlayer.get(key)!.values[row.report_code] = row.total_damage;
  }

  res.json({
    zone,
    reports: reports.map((r) => ({ code: r.code, title: r.title, start_time: r.start_time })),
    trackedAbilities: trackedConfig.trackedAbilities,
    casts: Array.from(castsByKey.values()),
    damage: Array.from(damageByPlayer.values()),
  });
});
