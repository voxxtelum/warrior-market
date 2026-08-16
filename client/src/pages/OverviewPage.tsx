import { useEffect, useState } from 'react';
import { WarriorsLayout } from '../components/WarriorsLayout';
import { ZonePicker } from '../components/ZonePicker';
import { fmtDate } from '../format';
import {
  getOverviewData,
  getZones,
  type OverviewAbilityValue,
  type OverviewData,
  type OverviewMetricPoint,
} from '../api';

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtDecimal1(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// Absolute-diff formatter for damage-scale numbers (millions), matching the
// Trends page's convention for this magnitude of value.
function fmtDamageDiff(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n / 1_000_000).toFixed(2)}M`;
}

function fmtPlainDiff(n: number, decimals: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

function percentText(pct: number): string {
  return `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
}

function deltaParts(
  prev: number,
  curr: number,
  formatDiff: (n: number) => string,
) {
  const diff = curr - prev;
  if (prev === 0) {
    if (curr === 0) return { text: '(+0%)', cls: 'delta-neutral' };
    return { text: '(new)', cls: 'delta-pos' };
  }
  const pct = (diff / prev) * 100;
  const cls = pct > 0 ? 'delta-pos' : pct < 0 ? 'delta-neg' : 'delta-neutral';
  return { text: `${formatDiff(diff)} ${percentText(pct)}`, cls };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function TotalAvgCell({
  total,
  average,
  prevTotal,
  formatValue,
  formatDiff,
}: {
  total: number;
  average: number;
  prevTotal: number | null;
  formatValue: (n: number) => string;
  formatDiff: (n: number) => string;
}) {
  const delta =
    prevTotal !== null ? deltaParts(prevTotal, total, formatDiff) : null;
  return (
    <>
      <div>{formatValue(total)}</div>
      <div className="muted-line">A: {formatValue(average)}</div>
      {delta && <div className={`delta-line ${delta.cls}`}>{delta.text}</div>}
    </>
  );
}

function AvgOnlyCell({
  average,
  prevAverage,
  formatValue,
  formatDiff,
}: {
  average: number;
  prevAverage: number | null;
  formatValue: (n: number) => string;
  formatDiff: (n: number) => string;
}) {
  const delta =
    prevAverage !== null ? deltaParts(prevAverage, average, formatDiff) : null;
  return (
    <>
      <div>{formatValue(average)}</div>
      {delta && <div className={`delta-line ${delta.cls}`}>{delta.text}</div>}
    </>
  );
}

function TotalAvgRow({
  label,
  rows,
  formatValue,
  formatDiff,
}: {
  label: string;
  rows: OverviewMetricPoint[];
  formatValue: (n: number) => string;
  formatDiff: (n: number) => string;
}) {
  const avgTotal = mean(rows.map((r) => r.total));
  const avgAverage = mean(rows.map((r) => r.average));
  const lastTotal = rows[rows.length - 1].total;
  const avgVsLast = deltaParts(avgTotal, lastTotal, formatDiff);
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row, i) => (
        <td key={i} className="stack-cell mobile-hide">
          <TotalAvgCell
            total={row.total}
            average={row.average}
            prevTotal={i === 0 ? null : rows[i - 1].total}
            formatValue={formatValue}
            formatDiff={formatDiff}
          />
        </td>
      ))}
      <td className="stack-cell">
        <TotalAvgCell
          total={avgTotal}
          average={avgAverage}
          prevTotal={null}
          formatValue={formatValue}
          formatDiff={formatDiff}
        />
        <div className={`delta-line ${avgVsLast.cls}`}>{avgVsLast.text}</div>
      </td>
    </tr>
  );
}

function AvgOnlyRow({
  label,
  values,
  formatValue,
  formatDiff,
}: {
  label: string;
  values: OverviewAbilityValue[];
  formatValue: (n: number) => string;
  formatDiff: (n: number) => string;
}) {
  const avgOfAverages = mean(values.map((v) => v.average));
  const lastAverage = values[values.length - 1].average;
  const avgVsLast = deltaParts(avgOfAverages, lastAverage, formatDiff);
  return (
    <tr>
      <td>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="stack-cell mobile-hide">
          <AvgOnlyCell
            average={v.average}
            prevAverage={i === 0 ? null : values[i - 1].average}
            formatValue={formatValue}
            formatDiff={formatDiff}
          />
        </td>
      ))}
      <td className="stack-cell">
        <AvgOnlyCell
          average={avgOfAverages}
          prevAverage={null}
          formatValue={formatValue}
          formatDiff={formatDiff}
        />
        <div className={`delta-line ${avgVsLast.cls}`}>{avgVsLast.text}</div>
      </td>
    </tr>
  );
}

export function OverviewPage() {
  const [zones, setZones] = useState<string[] | null>(null);
  const [zone, setZone] = useState<string>('');
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    getZones().then((z) => {
      setZones(z);
      if (z.length > 0) setZone(z[0]);
    });
  }, []);

  useEffect(() => {
    if (!zone) return;
    getOverviewData(zone).then(setData);
  }, [zone]);

  return (
    <WarriorsLayout>
      <div className="card">
        <ZonePicker zones={zones} value={zone} onChange={setZone} />
      </div>

      <div className="card">
        <div className="table-scroll table-compact">
          <table id="overview-table">
            {data && data.reports.length === 0 ? (
              <tbody>
                <tr>
                  <td>No reports for this zone yet.</td>
                </tr>
              </tbody>
            ) : (
              data && (
                <>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      {data.reports.map((r) => (
                        <th key={r.code} className="mobile-hide">{fmtDate(r.start_time)}</th>
                      ))}
                      <th>{data.reports.length}-Week Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TotalAvgRow
                      label="DPS"
                      rows={data.dps}
                      formatValue={fmtInt}
                      formatDiff={(n) => fmtPlainDiff(n, 1)}
                    />
                    <TotalAvgRow
                      label="Damage"
                      rows={data.damage}
                      formatValue={fmtInt}
                      formatDiff={fmtDamageDiff}
                    />
                    {data.abilities.map((ability) => (
                      <AvgOnlyRow
                        key={ability.id}
                        label={ability.name}
                        values={ability.values}
                        formatValue={fmtDecimal1}
                        formatDiff={(n) => fmtPlainDiff(n, 1)}
                      />
                    ))}
                  </tbody>
                </>
              )
            )}
          </table>
        </div>
      </div>
    </WarriorsLayout>
  );
}
