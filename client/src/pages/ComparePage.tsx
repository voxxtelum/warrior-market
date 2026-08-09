import { useEffect, useMemo, useState } from "react";
import type { ChartDataset } from "chart.js/auto";
import { WarriorsLayout } from "../components/WarriorsLayout";
import { SortableTable } from "../components/SortableTable";
import { LineChart } from "../components/LineChart";
import { paletteColor, withAlpha } from "../chartColors";
import { fmtDate } from "../format";
import { getCompareData, getZones, type CastCompareRow, type CompareData, type CompareReport } from "../api";

interface HasPlayerAndValues {
  player_name: string;
  values: Record<string, number>;
}

function buildLineChartDatasets<T extends HasPlayerAndValues>(
  rows: T[],
  reports: CompareReport[],
  selectedPlayer: string | null
): ChartDataset<"line", (number | null)[]>[] {
  const hasSelection = selectedPlayer !== null && rows.some((r) => r.player_name === selectedPlayer);

  const datasets = rows.map((row, i) => {
    const isSelected = row.player_name === selectedPlayer;
    const alpha = !hasSelection || isSelected ? 1 : 0.12;
    const color = withAlpha(paletteColor(i), alpha);
    return {
      label: row.player_name,
      data: reports.map((r) => row.values[r.code] ?? null),
      tension: 0.25,
      borderColor: color,
      backgroundColor: color,
      borderWidth: hasSelection && isSelected ? 3 : 1.5,
      pointRadius: !hasSelection || isSelected ? 3 : 2,
      order: isSelected ? 0 : 1,
      // Bridge missing weeks instead of leaving a gap, but mark the bridged
      // segment as dashed so it reads as "no data here" rather than a real
      // measured trend between the two points.
      spanGaps: true,
      segment: {
        borderDash: (ctx: { p0: { skip?: boolean }; p1: { skip?: boolean } }) =>
          ctx.p0.skip || ctx.p1.skip ? [6, 6] : undefined,
      },
    };
  });

  return datasets.sort((a, b) => a.order - b.order);
}

export function ComparePage() {
  const [zones, setZones] = useState<string[] | null>(null);
  const [zone, setZone] = useState<string>("");
  const [data, setData] = useState<CompareData | null>(null);
  const [abilityId, setAbilityId] = useState<string>("");
  const [selectedCastsPlayer, setSelectedCastsPlayer] = useState<string | null>(null);
  const [selectedDamagePlayer, setSelectedDamagePlayer] = useState<string | null>(null);

  useEffect(() => {
    getZones().then((z) => {
      setZones(z);
      if (z.length > 0) setZone(z[0]);
    });
  }, []);

  useEffect(() => {
    if (!zone) return;
    getCompareData(zone).then(setData);
    setSelectedCastsPlayer(null);
    setSelectedDamagePlayer(null);
  }, [zone]);

  const { trackedOptions, otherOptions } = useMemo(() => {
    if (!data) return { trackedOptions: [], otherOptions: [] as { value: string; label: string }[] };
    const abilityIds = new Set(data.casts.map((c) => String(c.ability_id)));
    const trackedIds = new Set(data.trackedAbilities.map((a) => String(a.id)));

    const tracked = data.trackedAbilities
      .filter((ab) => abilityIds.has(String(ab.id)))
      .map((ab) => ({ value: String(ab.id), label: ab.name }));

    const other = [...abilityIds]
      .filter((id) => !trackedIds.has(id))
      .map((id) => {
        const sample = data.casts.find((c) => String(c.ability_id) === id);
        return { value: id, label: sample ? sample.ability_name : id };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return { trackedOptions: tracked, otherOptions: other };
  }, [data]);

  useEffect(() => {
    const firstId = trackedOptions[0]?.value ?? otherOptions[0]?.value ?? "";
    setAbilityId(firstId);
    setSelectedCastsPlayer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const abilityName = [...trackedOptions, ...otherOptions].find((o) => o.value === abilityId)?.label ?? "";

  const recentReports = useMemo(() => data?.reports.slice(-10) ?? [], [data]);

  const castRows: CastCompareRow[] = useMemo(
    () => data?.casts.filter((c) => String(c.ability_id) === abilityId) ?? [],
    [data, abilityId]
  );

  const castsChartData = useMemo(
    () => (data ? buildLineChartDatasets(castRows, data.reports, selectedCastsPlayer) : []),
    [castRows, data, selectedCastsPlayer]
  );
  const damageChartData = useMemo(
    () => (data ? buildLineChartDatasets(data.damage, data.reports, selectedDamagePlayer) : []),
    [data, selectedDamagePlayer]
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Abilities</h2>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ color: "var(--muted)", fontSize: "0.9rem", marginRight: "0.5rem" }}>Show:</label>
          <select value={abilityId} onChange={(e) => setAbilityId(e.target.value)}>
            {trackedOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {otherOptions.length > 0 && (
              <optgroup label="All other abilities cast">
                {otherOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {data && trackedOptions.length + otherOptions.length > 0 && (
          <>
            <div className="table-scroll table-compact">
              <SortableTable
                id="casts-table"
                reports={recentReports}
                rows={castRows}
                rowKey={(r) => r.player_name}
                getLabel={(r) => r.player_name}
                getValue={(r, code) => r.values[code]}
                onRowClick={(r) => setSelectedCastsPlayer((p) => (p === r.player_name ? null : r.player_name))}
                isSelected={(r) => r.player_name === selectedCastsPlayer}
              />
            </div>
            <LineChart labels={data.reports.map((r) => fmtDate(r.start_time))} datasets={castsChartData} title={`${abilityName} - ${data.zone}`} />
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Damage</h2>
        {data && (
          <>
            <div className="table-scroll table-compact">
              <SortableTable
                id="damage-table"
                reports={recentReports}
                rows={data.damage}
                rowKey={(r) => r.player_name}
                getLabel={(r) => r.player_name}
                getValue={(r, code) => r.values[code]}
                onRowClick={(r) => setSelectedDamagePlayer((p) => (p === r.player_name ? null : r.player_name))}
                isSelected={(r) => r.player_name === selectedDamagePlayer}
              />
            </div>
            <LineChart labels={data.reports.map((r) => fmtDate(r.start_time))} datasets={damageChartData} title={`Overall Damage - ${data.zone}`} />
          </>
        )}
      </div>
    </WarriorsLayout>
  );
}
