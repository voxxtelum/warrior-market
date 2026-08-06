import { Router } from "express";
import { getCastsForZone, getDamageForZone, getReportsForZone } from "../db";
import rawConfig from "../../config.json";

export const overviewRouter = Router();

interface OverviewAbilityConfig {
  id: number;
  name: string;
}

const overviewAbilities = rawConfig.overviewAbilities as OverviewAbilityConfig[];
const RECENT_COUNT = 5;

overviewRouter.get("/", (req, res) => {
  const zone = req.query.zone;
  if (!zone || typeof zone !== "string") {
    res.status(400).json({ error: "Query param 'zone' is required" });
    return;
  }

  const recentReports = getReportsForZone(zone).slice(-RECENT_COUNT);
  const reportCodes = new Set(recentReports.map((r) => r.code));

  const damageRows = getDamageForZone(zone).filter((d) => reportCodes.has(d.report_code));
  const castRows = getCastsForZone(zone).filter((c) => reportCodes.has(c.report_code));

  const damageByReport = new Map<string, typeof damageRows>();
  for (const d of damageRows) {
    if (!damageByReport.has(d.report_code)) damageByReport.set(d.report_code, []);
    damageByReport.get(d.report_code)!.push(d);
  }

  const dps: { report_code: string; total: number; average: number }[] = [];
  const damage: { report_code: string; total: number; average: number }[] = [];

  for (const report of recentReports) {
    const participants = damageByReport.get(report.code) ?? [];
    const count = participants.length;
    const totalDamage = participants.reduce((sum, p) => sum + p.total_damage, 0);
    const totalDps = participants.reduce((sum, p) => {
      const d = p.active_time && p.active_time > 0 ? p.total_damage / (p.active_time / 1000) : 0;
      return sum + d;
    }, 0);
    damage.push({ report_code: report.code, total: totalDamage, average: count > 0 ? totalDamage / count : 0 });
    dps.push({ report_code: report.code, total: totalDps, average: count > 0 ? totalDps / count : 0 });
  }

  const abilities = overviewAbilities.map((ability) => ({
    id: ability.id,
    name: ability.name,
    values: recentReports.map((report) => {
      const participantCount = (damageByReport.get(report.code) ?? []).length;
      const totalCasts = castRows
        .filter((c) => c.report_code === report.code && c.ability_id === ability.id)
        .reduce((sum, c) => sum + c.cast_count, 0);
      return {
        report_code: report.code,
        average: participantCount > 0 ? totalCasts / participantCount : 0,
      };
    }),
  }));

  res.json({
    zone,
    reports: recentReports.map((r) => ({ code: r.code, title: r.title, start_time: r.start_time })),
    dps,
    damage,
    abilities,
  });
});
