import { useEffect, useMemo, useState } from "react";
import { WarriorsLayout } from "../components/WarriorsLayout";
import { StackCell } from "../components/StackCell";
import { getCompareData, getZones, type CompareData, type CompareReport } from "../api";

const NUM_ABILITY_COLUMNS = 4;
const NUM_REPORTS = 3;

function fmtDamage(n: number): string {
  return (n / 1_000_000).toFixed(2) + "M";
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function percentDelta(prev: number, curr: number) {
  if (prev === 0) {
    if (curr === 0) return { text: "(+0%)", cls: "delta-neutral" };
    return { text: "(new)", cls: "delta-pos" };
  }
  const pct = ((curr - prev) / prev) * 100;
  const cls = pct > 0 ? "delta-pos" : pct < 0 ? "delta-neg" : "delta-neutral";
  const text = `(${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
  return { text, cls };
}

function absoluteDelta(prev: number, curr: number) {
  const diff = curr - prev;
  const cls = diff > 0 ? "delta-pos" : diff < 0 ? "delta-neg" : "delta-neutral";
  const text = `(${diff >= 0 ? "+" : ""}${diff})`;
  return { text, cls };
}

function participatedReports(reports: CompareReport[], damageRow: { values: Record<string, number> }): CompareReport[] {
  return reports.filter((r) => damageRow.values[r.code] !== undefined).slice(-NUM_REPORTS);
}

export function TrendsPage() {
  const [zones, setZones] = useState<string[] | null>(null);
  const [zone, setZone] = useState<string>("");
  const [data, setData] = useState<CompareData | null>(null);
  const [abilitySelections, setAbilitySelections] = useState<string[]>([]);

  useEffect(() => {
    getZones().then((z) => {
      setZones(z);
      if (z.length > 0) setZone(z[0]);
    });
  }, []);

  useEffect(() => {
    if (!zone) return;
    getCompareData(zone).then((d) => {
      setData(d);
      setAbilitySelections(d.trackedAbilities.slice(0, NUM_ABILITY_COLUMNS).map((a) => String(a.id)));
    });
  }, [zone]);

  const { trackedOptions, otherOptions } = useMemo(() => {
    if (!data) return { trackedOptions: [], otherOptions: [] as { value: string; label: string }[] };
    const trackedIds = new Set(data.trackedAbilities.map((a) => String(a.id)));
    const seen = new Map<string, string>();
    for (const c of data.casts) {
      if (!seen.has(String(c.ability_id))) seen.set(String(c.ability_id), c.ability_name);
    }

    const tracked = data.trackedAbilities
      .filter((ab) => seen.has(String(ab.id)))
      .map((ab) => ({ value: String(ab.id), label: ab.name }));

    const other = [...seen.entries()]
      .filter(([id]) => !trackedIds.has(id))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name }));

    return { trackedOptions: tracked, otherOptions: other };
  }, [data]);

  const selectedAbilities = abilitySelections.map((id) => {
    const opt = [...trackedOptions, ...otherOptions].find((o) => o.value === id);
    return { id, name: opt?.label ?? id };
  });

  const players = useMemo(
    () => (data ? [...data.damage].sort((a, b) => a.player_name.localeCompare(b.player_name)) : []),
    [data]
  );

  return (
    <WarriorsLayout>
      <div className="card">
        <form onSubmit={(e) => e.preventDefault()}>
          <select value={zone} onChange={(e) => setZone(e.target.value)} disabled={!zones || zones.length === 0}>
            {zones && zones.length === 0 && <option>No reports added yet</option>}
            {zones?.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </form>
        <div className="trends-ability-pickers">
          {abilitySelections.map((selectedId, i) => (
            <label key={i}>
              {`Column ${i + 1}`}
              <select
                value={selectedId}
                onChange={(e) =>
                  setAbilitySelections((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                }
              >
                {trackedOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {otherOptions.length > 0 && (
                  <optgroup label="All other abilities">
                    {otherOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-scroll table-compact">
          <table id="trends-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Damage</th>
                {selectedAbilities.map((a, i) => (
                  <th key={i} className="mobile-hide">{a.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data &&
                players.map((damageRow) => {
                  const reports = participatedReports(data.reports, damageRow);
                  if (reports.length === 0) return null;

                  const damageValues = reports.map((r) => damageRow.values[r.code]);

                  return (
                    <tr key={damageRow.player_name}>
                      <td className="warrior-name">{damageRow.player_name}</td>
                      <td className="stack-cell">
                        <StackCell values={damageValues} formatValue={fmtDamage} formatDelta={percentDelta} />
                      </td>
                      {selectedAbilities.map((ability, i) => {
                        const castsRow = data.casts.find(
                          (c) => c.player_name === damageRow.player_name && String(c.ability_id) === ability.id
                        );
                        const values = reports.map((r) => (castsRow ? castsRow.values[r.code] ?? 0 : 0));
                        return (
                          <td key={i} className="stack-cell mobile-hide">
                            <StackCell values={values} formatValue={fmtCount} formatDelta={absoluteDelta} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </WarriorsLayout>
  );
}
