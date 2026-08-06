import { graphqlRequest } from "./wclClient";
import { upsertReport, CastRow, DamageRow, DamageTakenRow, FightRow, ReportRow } from "./db";
import trackedConfig from "../config.json";

const trackedAbilityNames = new Map<number, string>(trackedConfig.trackedAbilities.map((a) => [a.id, a.name]));

export function parseReportCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/reports\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) return trimmed;
  throw new Error(`Could not find a report code in "${input}"`);
}

interface ReportQueryResult {
  reportData: {
    report: {
      title: string;
      startTime: number;
      endTime: number;
      zone: { name: string } | null;
      fights: { id: number; encounterID: number; name: string; kill: boolean | null }[];
      masterData: {
        actors: { id: number; name: string; server: string | null }[];
      } | null;
    } | null;
  };
}

// dataType: Casts with viewBy: Ability, grouped by ability with a per-player
// breakdown in `subentries`. The default per-player view truncates each
// player's abilities to their top few by cast count, silently dropping
// low-frequency cooldowns (e.g. Recklessness, Death Wish) for busy players -
// viewBy: Ability's subentries are the untruncated per-player counts instead.
interface CastAbilityEntry {
  name: string;
  guid: number;
  subentries?: { actor: number; actorName: string; actorType?: string; total: number }[];
}

interface DamageEntry {
  id: number;
  name: string;
  type?: string;
  total: number;
  activeTime?: number;
}

interface CastsQueryResult {
  reportData: {
    report: { casts: { data: { entries: CastAbilityEntry[] } } | null } | null;
  };
}

interface DamageQueryResult {
  reportData: {
    report: { damage: { data: { entries: DamageEntry[] } } | null } | null;
  };
}

interface DamageTakenQueryResult {
  reportData: {
    report: { damageTaken: { data: { entries: DamageEntry[] } } | null } | null;
  };
}

const REPORT_QUERY = `
  query ($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        endTime
        zone { name }
        fights(killType: All) {
          id
          encounterID
          name
          kill
        }
        masterData {
          actors(type: "Player") {
            id
            name
            server
          }
        }
      }
    }
  }
`;

const CASTS_QUERY = `
  query ($code: String!, $fightIDs: [Int]) {
    reportData {
      report(code: $code) {
        casts: table(dataType: Casts, sourceClass: "Warrior", fightIDs: $fightIDs, viewBy: Ability)
      }
    }
  }
`;

const DAMAGE_QUERY = `
  query ($code: String!, $fightIDs: [Int]) {
    reportData {
      report(code: $code) {
        damage: table(dataType: DamageDone, sourceClass: "Warrior", fightIDs: $fightIDs)
      }
    }
  }
`;

const DAMAGE_TAKEN_QUERY = `
  query ($code: String!, $fightIDs: [Int]) {
    reportData {
      report(code: $code) {
        damageTaken: table(dataType: DamageTaken, sourceClass: "Warrior", fightIDs: $fightIDs)
      }
    }
  }
`;

interface AggregatedActorTotal {
  name: string;
  server: string;
  class: string;
  total: number;
  activeTime: number;
}

// A player who disconnects/reconnects mid-raid shows up as more than one
// entry with the same name for a report, so entries are aggregated by
// (name, server) - summing totals and active time - rather than assuming
// one entry per player. Shared between DamageDone and DamageTaken since
// both tables return the same entry shape.
function aggregateActorTotals(
  entries: DamageEntry[],
  actorServerById: Map<number, string>
): Map<string, AggregatedActorTotal> {
  const byKey = new Map<string, AggregatedActorTotal>();
  for (const entry of entries) {
    if (entry.type && entry.type !== "Warrior") continue;
    const server = actorServerById.get(entry.id) ?? "Unknown";
    const key = `${entry.name}::${server}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.total += entry.total;
      existing.activeTime += entry.activeTime ?? 0;
    } else {
      byKey.set(key, {
        name: entry.name,
        server,
        class: entry.type ?? "Warrior",
        total: entry.total,
        activeTime: entry.activeTime ?? 0,
      });
    }
  }
  return byKey;
}

export async function fetchAndIngestReport(codeOrUrl: string): Promise<{ code: string; title: string; zone: string | null }> {
  const code = parseReportCode(codeOrUrl);

  const reportResult = await graphqlRequest<ReportQueryResult>(REPORT_QUERY, { code });
  const report = reportResult.reportData.report;
  if (!report) {
    throw new Error(`No report found for code "${code}". Check the URL and that this API client can access it.`);
  }

  const allFightIds = report.fights.map((f) => f.id);

  // Two different characters can share a display name (seen across
  // different realms in this guild's logs), so we resolve each report-local
  // actor id to its realm and key every player by (name, server) instead of
  // name alone - that's what keeps same-named-but-different characters
  // separate while still merging a single character's disconnect/reconnect
  // fragments (which share both name and server) back together.
  const actorServerById = new Map<number, string>();
  for (const actor of report.masterData?.actors ?? []) {
    actorServerById.set(actor.id, actor.server ?? "Unknown");
  }

  const [castsResult, damageResult, damageTakenResult] = await Promise.all([
    graphqlRequest<CastsQueryResult>(CASTS_QUERY, { code, fightIDs: allFightIds }),
    graphqlRequest<DamageQueryResult>(DAMAGE_QUERY, { code, fightIDs: allFightIds }),
    graphqlRequest<DamageTakenQueryResult>(DAMAGE_TAKEN_QUERY, { code, fightIDs: allFightIds }),
  ]);

  const castAbilityEntries = castsResult.reportData.report?.casts?.data?.entries ?? [];
  const damageEntries = damageResult.reportData.report?.damage?.data?.entries ?? [];
  const damageTakenEntries = damageTakenResult.reportData.report?.damageTaken?.data?.entries ?? [];

  const reportRow: ReportRow = {
    code,
    title: report.title,
    zone: report.zone?.name ?? null,
    start_time: report.startTime,
    end_time: report.endTime,
    fetched_at: Date.now(),
  };

  const fights: FightRow[] = report.fights.map((f) => ({
    report_code: code,
    fight_id: f.id,
    encounter_id: f.encounterID,
    encounter_name: f.name,
    kill: f.kill ? 1 : 0,
  }));

  const castsByKey = new Map<string, CastRow>();
  for (const abilityEntry of castAbilityEntries) {
    const abilityName = trackedAbilityNames.get(abilityEntry.guid) ?? abilityEntry.name;
    for (const sub of abilityEntry.subentries ?? []) {
      if (sub.actorType && sub.actorType !== "Warrior") continue;
      const server = actorServerById.get(sub.actor) ?? "Unknown";
      const key = `${sub.actorName}::${server}::${abilityEntry.guid}`;
      const existing = castsByKey.get(key);
      if (existing) {
        existing.cast_count += sub.total;
      } else {
        castsByKey.set(key, {
          report_code: code,
          player_name: sub.actorName,
          server,
          class: "Warrior",
          ability_id: abilityEntry.guid,
          ability_name: abilityName,
          cast_count: sub.total,
        });
      }
    }
  }
  const casts: CastRow[] = Array.from(castsByKey.values());

  const damage: DamageRow[] = Array.from(aggregateActorTotals(damageEntries, actorServerById).values()).map((a) => ({
    report_code: code,
    player_name: a.name,
    server: a.server,
    class: a.class,
    total_damage: a.total,
    active_time: a.activeTime,
  }));

  const damageTaken: DamageTakenRow[] = Array.from(
    aggregateActorTotals(damageTakenEntries, actorServerById).values()
  ).map((a) => ({
    report_code: code,
    player_name: a.name,
    server: a.server,
    class: a.class,
    total_taken: a.total,
    active_time: a.activeTime,
  }));

  upsertReport({ report: reportRow, fights, casts, damage, damageTaken });

  return { code, title: report.title, zone: reportRow.zone };
}
