import { useEffect, useMemo, useState } from 'react';
import type { ChartDataset } from 'chart.js/auto';
import { Layout } from '../components/Layout';
import { LineChart } from '../components/LineChart';
import { Sparkline } from '../components/Sparkline';
import { paletteColor, withAlpha } from '../chartColors';
import { fmtDate } from '../format';
import { getReports, getStock, type PlayerStock, type ReportRow } from '../api';

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const HEAT_POS_LIGHT = '#bfe3fa';
const HEAT_POS_DARK = '#0ea5e9';
const HEAT_NEG_LIGHT = '#ffd0d0';
const HEAT_NEG_DARK = '#ff3b3b';

// Colors a change value on a gradient scaled by how big it is relative to
// the biggest change of the same sign currently on the board - light blue
// near zero up to full blue at the largest gain, light red up to full red
// at the largest loss.
function heatColor(pct: number, maxPos: number, minNeg: number): string | null {
  if (pct > 0) {
    const t = maxPos > 0 ? Math.min(1, pct / maxPos) : 1;
    return lerpColor(HEAT_POS_LIGHT, HEAT_POS_DARK, t);
  }
  if (pct < 0) {
    const t = minNeg < 0 ? Math.min(1, pct / minNeg) : 1;
    return lerpColor(HEAT_NEG_LIGHT, HEAT_NEG_DARK, t);
  }
  return null;
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

function priceDelta(prev: number, curr: number) {
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const cls = diff > 0 ? 'delta-pos' : diff < 0 ? 'delta-neg' : 'delta-neutral';
  const text = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  return { text, cls };
}

interface LeaderboardRow {
  player_name: string;
  server: string;
  price: number;
  raidCount: number;
  prevPrice: number | null;
  series: PlayerStock['series'];
}

function buildLeaderboard(playersStock: PlayerStock[]): LeaderboardRow[] {
  return playersStock
    .filter((p) => p.series.length > 0)
    .map((p) => {
      const last = p.series[p.series.length - 1];
      const prev = p.series.length > 1 ? p.series[p.series.length - 2] : null;
      return {
        player_name: p.player_name,
        server: p.server,
        price: last.price,
        raidCount: p.series.length,
        prevPrice: prev ? prev.price : null,
        series: p.series,
      };
    });
}

function changeValue(row: LeaderboardRow): number | null {
  return row.prevPrice !== null ? row.price - row.prevPrice : null;
}

type SortKey = 'player' | 'price' | 'change' | 'raids';

function sortValue(row: LeaderboardRow, key: SortKey): string | number | null {
  if (key === 'player') return row.player_name;
  if (key === 'price') return row.price;
  if (key === 'change') return changeValue(row);
  if (key === 'raids') return row.raidCount;
  return null;
}

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'player', label: 'Player' },
  { key: 'price', label: 'Price' },
  { key: null, label: 'Trend' },
  { key: 'change', label: 'Change since last raid' },
  { key: 'raids', label: 'Raids' },
];

export function StockPage() {
  const [playersStock, setPlayersStock] = useState<PlayerStock[] | null>(null);
  const [allReports, setAllReports] = useState<ReportRow[] | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [censored, setCensored] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  useEffect(() => {
    Promise.all([getStock(), getReports()]).then(([stock, reports]) => {
      setPlayersStock(stock);
      setAllReports(reports);
    });
  }, []);

  const leaderboard = useMemo(
    () => (playersStock ? buildLeaderboard(playersStock) : []),
    [playersStock],
  );

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * (av - bv);
    });
  }, [leaderboard, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'player' ? 1 : -1);
    }
  }

  function arrowFor(key: SortKey | null): string {
    if (key === null || sortKey !== key) return '';
    return sortDir === 1 ? ' ▲' : ' ▼';
  }

  const { maxPos, minNeg } = useMemo(() => {
    const pctChanges = leaderboard
      .filter((row) => row.prevPrice !== null)
      .map(
        (row) =>
          ((row.price - (row.prevPrice as number)) /
            (row.prevPrice as number)) *
          100,
      );
    return {
      maxPos: Math.max(0, ...pctChanges.filter((v) => v > 0)),
      minNeg: Math.min(0, ...pctChanges.filter((v) => v < 0)),
    };
  }, [leaderboard]);

  const chartDatasets: ChartDataset<'line', (number | null)[]>[] =
    useMemo(() => {
      if (!allReports) return [];
      const hasSelection =
        selectedPlayer !== null &&
        leaderboard.some((p) => p.player_name === selectedPlayer);

      const datasets = leaderboard.map((row, i) => {
        const isSelected = row.player_name === selectedPlayer;
        const alpha = !hasSelection || isSelected ? 1 : 0.12;
        const color = withAlpha(paletteColor(i), alpha);
        const priceByReport = new Map(
          row.series.map((s) => [s.report_code, s.price]),
        );
        return {
          label: censored ? '████████' : row.player_name,
          data: allReports.map((r) => priceByReport.get(r.code) ?? null),
          spanGaps: true,
          tension: 0.2,
          borderColor: color,
          backgroundColor: color,
          borderWidth: hasSelection && isSelected ? 3 : 1.5,
          pointRadius: !hasSelection || isSelected ? 2.5 : 1.5,
          order: isSelected ? 0 : 1,
        };
      });

      return datasets.sort((a, b) => a.order - b.order);
    }, [allReports, leaderboard, selectedPlayer, censored]);

  return (
    <Layout
      title="Warrior Stocks"
      subtitle={
        <>
          Stocks for <s>Morons</s> &lt;Dawnfire&gt; Warriors
        </>
      }
    >
      <div className="card">
        <div className="table-scroll">
          <table id="stock-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    className={col.key !== null ? 'sortable' : undefined}
                    onClick={
                      col.key !== null
                        ? () => handleSort(col.key as SortKey)
                        : undefined
                    }
                  >
                    {col.label}
                    {arrowFor(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedLeaderboard.map((row) => {
                const delta =
                  row.prevPrice !== null
                    ? priceDelta(row.prevPrice, row.price)
                    : null;
                const pct =
                  row.prevPrice !== null
                    ? ((row.price - row.prevPrice) / row.prevPrice) * 100
                    : 0;
                const color = delta ? heatColor(pct, maxPos, minNeg) : null;

                return (
                  <tr
                    key={`${row.player_name}::${row.server}`}
                    style={{ cursor: 'pointer' }}
                    className={
                      row.player_name === selectedPlayer
                        ? 'selected-row'
                        : undefined
                    }
                    onClick={() =>
                      setSelectedPlayer((p) =>
                        p === row.player_name ? null : row.player_name,
                      )
                    }
                  >
                    <td>
                      {censored ? (
                        <span className="censor-box"></span>
                      ) : (
                        row.player_name
                      )}
                    </td>
                    <td>{fmtPrice(row.price)}</td>
                    <td>
                      <Sparkline prices={row.series.map((s) => s.price)} />
                    </td>
                    <td>
                      {delta ? (
                        <span
                          className={color ? '' : delta.cls}
                          style={color ? { color } : undefined}
                        >
                          {delta.text}
                        </span>
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td>{row.raidCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <LineChart
          labels={allReports?.map((r) => fmtDate(r.start_time)) ?? []}
          datasets={chartDatasets}
          title="Warrior Stock Prices"
          height={480}
          yScaleOptions={{ title: { display: true, text: 'Price' } }}
        />
      </div>

      <div className="card">
        <label className="censor-toggle">
          <input
            type="checkbox"
            checked={censored}
            onChange={(e) => setCensored(e.target.checked)}
          />
          Censor player names
        </label>
      </div>
    </Layout>
  );
}
