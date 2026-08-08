import { useEffect, useMemo, useState } from 'react';
import type { ChartDataset } from 'chart.js/auto';
import { MarketLayout } from '../components/MarketLayout';
import { LineChart } from '../components/LineChart';
import { Sparkline } from '../components/Sparkline';
import { TradeModal } from '../components/TradeModal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { useAuth } from '../authContext';
import { paletteColor, withAlpha } from '../chartColors';
import { fmtCoin, fmtDate, fmtDateTime, priceDelta } from '../format';
import {
  getMarketSummary,
  getStock,
  getStockHistory,
  getWallet,
  type MarketSummary,
  type PlayerPriceHistory,
  type PlayerStock,
  type WalletData,
} from '../api';

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

function heatRange(values: number[]): { maxPos: number; minNeg: number } {
  return {
    maxPos: Math.max(0, ...values.filter((v) => v > 0)),
    minNeg: Math.min(0, ...values.filter((v) => v < 0)),
  };
}

interface LeaderboardRow {
  player_name: string;
  server: string;
  // The actual current tradable price (from price_snapshots - raid + drift +
  // demand), shown in the Price column and used to sort by it. Distinct from
  // `price` below, which is purely raid-performance-derived and only moves
  // on raid ingest - kept separate for the "since last raid" metrics.
  currentPrice: number;
  price: number;
  raidCount: number;
  prevPrice: number | null;
  series: PlayerStock['series'];
  avatar: string | null;
}

function buildLeaderboard(
  playersStock: PlayerStock[],
  currentPriceByPlayer: Map<string, number>,
): LeaderboardRow[] {
  return playersStock
    .filter((p) => p.series.length > 0)
    .map((p) => {
      const last = p.series[p.series.length - 1];
      const prev = p.series.length > 1 ? p.series[p.series.length - 2] : null;
      return {
        player_name: p.player_name,
        server: p.server,
        currentPrice: currentPriceByPlayer.get(`${p.player_name}::${p.server}`) ?? last.price,
        price: last.price,
        raidCount: p.series.length,
        prevPrice: prev ? prev.price : null,
        series: p.series,
        avatar: p.avatar,
      };
    });
}

function changeValue(row: LeaderboardRow): number | null {
  return row.prevPrice !== null ? row.price - row.prevPrice : null;
}

// Geometric-mean per-raid price growth, derived purely from the player's own
// consecutive price points (no dependency on priceSensitivity/startingPrice
// config) - a tenure-independent view of "quality per raid" alongside the
// tenure-compounded price. Needs at least 2 raids to have one price ratio.
function avgGrowthPerRaid(series: PlayerStock['series']): number | null {
  if (series.length < 2) return null;
  let sumLogReturn = 0;
  for (let i = 1; i < series.length; i++) {
    sumLogReturn += Math.log(series[i].price / series[i - 1].price);
  }
  const avgLogReturn = sumLogReturn / (series.length - 1);
  return (Math.exp(avgLogReturn) - 1) * 100;
}

function rowKey(row: LeaderboardRow): string {
  return `${row.player_name}::${row.server}`;
}

// Positions gained (positive) or lost (negative) vs. each player's own
// previous-raid price rank - null when there's no previous raid to rank
// against yet (e.g. a player's first appearance on the board).
function buildRankDeltas(
  leaderboard: LeaderboardRow[],
): Map<string, number | null> {
  const currentRank = new Map<string, number>();
  [...leaderboard]
    .sort((a, b) => b.price - a.price)
    .forEach((row, i) => currentRank.set(rowKey(row), i + 1));

  const previousRank = new Map<string, number>();
  leaderboard
    .filter((row) => row.prevPrice !== null)
    .sort((a, b) => (b.prevPrice as number) - (a.prevPrice as number))
    .forEach((row, i) => previousRank.set(rowKey(row), i + 1));

  const deltas = new Map<string, number | null>();
  for (const row of leaderboard) {
    const key = rowKey(row);
    const prev = previousRank.get(key);
    const curr = currentRank.get(key);
    deltas.set(
      key,
      prev !== undefined && curr !== undefined ? prev - curr : null,
    );
  }
  return deltas;
}

function RankDeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="no-data">–</span>;
  if (delta === 0) return null;
  return (
    <span className={delta > 0 ? 'delta-pos' : 'delta-neg'}>
      {delta > 0 ? '▲ ' : '▼ '}
      {Math.abs(delta)}
    </span>
  );
}

type SortKey = 'player' | 'price' | 'change' | 'avgGrowth' | 'raids';

function sortValue(row: LeaderboardRow, key: SortKey): string | number | null {
  if (key === 'player') return row.player_name;
  if (key === 'price') return row.currentPrice;
  if (key === 'change') return changeValue(row);
  if (key === 'avgGrowth') return avgGrowthPerRaid(row.series);
  if (key === 'raids') return row.raidCount;
  return null;
}

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: null, label: 'Δ' },
  { key: 'player', label: 'Player' },
  { key: 'price', label: 'Price' },
  { key: null, label: 'Trend' },
  { key: 'change', label: 'Change since last raid' },
  { key: 'avgGrowth', label: 'Avg growth/raid' },
  { key: 'raids', label: 'Raids' },
  { key: null, label: '' },
];

function refreshHistory(setPriceHistory: (h: PlayerPriceHistory[]) => void) {
  getStockHistory().then(setPriceHistory);
}

export function StockPage() {
  const { user } = useAuth();
  const [playersStock, setPlayersStock] = useState<PlayerStock[] | null>(null);
  const [priceHistory, setPriceHistory] = useState<PlayerPriceHistory[] | null>(
    null,
  );
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [censored, setCensored] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [tradeModalTarget, setTradeModalTarget] = useState<{
    playerName: string;
    server: string;
  } | null>(null);

  useEffect(() => {
    Promise.all([getStock(), getStockHistory()]).then(([stock, history]) => {
      setPlayersStock(stock);
      setPriceHistory(history);
    });
  }, []);

  // Public, market-wide - fetched regardless of login state (unlike the
  // wallet-summary card below it, which needs a logged-in user).
  useEffect(() => {
    getMarketSummary().then(setMarketSummary);
  }, []);

  const refreshWallet = () => {
    if (user) getWallet().then(setWallet);
  };
  useEffect(refreshWallet, [user]);

  function handleTraded() {
    refreshHistory(setPriceHistory);
    refreshWallet();
    getMarketSummary().then(setMarketSummary);
  }

  // The most recent price_snapshots point per player (raid + drift + demand
  // together) - the actual price a trade would fill at right now, as opposed
  // to `playersStock`'s purely raid-derived series.
  const currentPriceByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    if (priceHistory) {
      for (const p of priceHistory) {
        const last = p.series[p.series.length - 1];
        if (last) map.set(`${p.player_name}::${p.server}`, last.price);
      }
    }
    return map;
  }, [priceHistory]);

  const leaderboard = useMemo(
    () => (playersStock ? buildLeaderboard(playersStock, currentPriceByPlayer) : []),
    [playersStock, currentPriceByPlayer],
  );

  const rankDeltas = useMemo(() => buildRankDeltas(leaderboard), [leaderboard]);

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
    return heatRange(pctChanges);
  }, [leaderboard]);

  const { maxPos: maxPosGrowth, minNeg: minNegGrowth } = useMemo(() => {
    const growthValues = leaderboard
      .map((row) => avgGrowthPerRaid(row.series))
      .filter((v): v is number => v !== null);
    return heatRange(growthValues);
  }, [leaderboard]);

  // Each dataset supplies its own real {x, y} points (x = epoch ms) on a
  // linear x-axis, rather than being aligned to a shared category grid - so
  // axis spacing matches real elapsed time instead of stretching dense,
  // hourly-drift-heavy stretches between raids to match a handful of raid
  // points. Reading from the immutable price_snapshots ledger (raid jumps
  // and drift ticks together) rather than the live computeStock() series
  // (see stock.ts) so this can't retroactively change if stock_config is
  // edited later, and so drift shows up at all.
  const chartDatasets: ChartDataset<'line', { x: number; y: number }[]>[] =
    useMemo(() => {
      if (!priceHistory) return [];
      const hasSelection =
        selectedPlayer !== null &&
        leaderboard.some((p) => p.player_name === selectedPlayer);
      const historyByPlayer = new Map(
        priceHistory.map((p) => [`${p.player_name}::${p.server}`, p]),
      );

      const datasets = leaderboard.flatMap((row, i) => {
        const history = historyByPlayer.get(rowKey(row));
        if (!history) return [];
        const isSelected = row.player_name === selectedPlayer;
        const alpha = !hasSelection || isSelected ? 1 : 0.12;
        const color = withAlpha(paletteColor(i), alpha);
        return [
          {
            label: censored ? '████████' : row.player_name,
            data: history.series.map((s) => ({ x: s.created_at, y: s.price })),
            // Drift ticks make points ~6x denser than the old one-per-raid
            // series - Chart.js's default curve interpolation would overshoot
            // between real values at that density, so this chart specifically
            // uses straight lines (ComparePage's chart is unrelated and keeps
            // its own tension).
            tension: 0,
            borderColor: color,
            backgroundColor: color,
            borderWidth: hasSelection && isSelected ? 3 : 1.5,
            pointRadius: 0,
            order: isSelected ? 0 : 1,
          },
        ];
      });

      return datasets.sort((a, b) => a.order - b.order);
    }, [priceHistory, leaderboard, selectedPlayer, censored]);

  return (
    <MarketLayout>
      <div className="stats-row">
        {user && (
          <div className="card personal-stats-card">
            <div className="wallet-summary">
              <div className="wallet-summary-item">
                <span className="value">
                  {wallet ? fmtCoin(wallet.balance) : '–'}
                </span>
                <span className="label">Balance</span>
              </div>
              <div className="wallet-summary-item">
                <span className="value">
                  {wallet ? fmtCoin(wallet.netWorth - wallet.balance) : '–'}
                </span>
                <span className="label">Holdings</span>
              </div>
              <div className="wallet-summary-item">
                <span className="value">
                  {wallet ? fmtCoin(wallet.netWorth) : '–'}
                </span>
                <span className="label">Portfolio</span>
              </div>
            </div>
          </div>
        )}

        <div className="card global-stats-card">
          <div className="wallet-summary">
            <div className="wallet-summary-item">
              <span className="value">
                {marketSummary ? fmtCoin(marketSummary.totalMarketSize) : '–'}
              </span>
              <span className="label">Market size</span>
            </div>
            <div className="wallet-summary-item">
              <span className="value">
                {marketSummary ? fmtCoin(marketSummary.totalTradeVolume) : '–'}
              </span>
              <span className="label">Total trade volume</span>
            </div>
          </div>
        </div>
      </div>

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
                const growth = avgGrowthPerRaid(row.series);
                const growthColor =
                  growth !== null
                    ? heatColor(growth, maxPosGrowth, minNegGrowth)
                    : null;
                const growthCls =
                  growth === null
                    ? null
                    : growth > 0
                      ? 'delta-pos'
                      : growth < 0
                        ? 'delta-neg'
                        : 'delta-neutral';

                return (
                  <tr
                    key={rowKey(row)}
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
                      <RankDeltaCell
                        delta={rankDeltas.get(rowKey(row)) ?? null}
                      />
                    </td>
                    <td>
                      {censored ? (
                        <span className="censor-box"></span>
                      ) : (
                        <span className="player-name-cell">
                          {row.avatar && (
                            <img
                              className="user-avatar player-name-avatar"
                              src={row.avatar}
                              alt=""
                              width={20}
                              height={20}
                            />
                          )}
                          <span className="warrior-name">
                            {row.player_name}
                          </span>
                        </span>
                      )}
                    </td>
                    <td>{fmtPrice(row.currentPrice)}</td>
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
                    <td>
                      {growth !== null ? (
                        <span
                          className={
                            growthColor ? '' : (growthCls ?? undefined)
                          }
                          style={
                            growthColor ? { color: growthColor } : undefined
                          }
                        >
                          {growth >= 0 ? '+' : ''}
                          {growth.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td>{row.raidCount}</td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTradeModalTarget({
                            playerName: row.player_name,
                            server: row.server,
                          });
                        }}
                      >
                        <ArrowsRightLeftIcon className="icon-btn-icon" />
                        Trade
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <LineChart
          datasets={chartDatasets}
          title="Warrior Stock Prices"
          height={480}
          yScaleOptions={{ title: { display: true, text: 'Price' } }}
          xScaleOptions={{ type: 'linear', ticks: { display: true } }}
          xTickFormatter={fmtDate}
          xTooltipFormatter={fmtDateTime}
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

      {tradeModalTarget && (
        <TradeModal
          playerName={tradeModalTarget.playerName}
          server={tradeModalTarget.server}
          onClose={() => setTradeModalTarget(null)}
          onTraded={handleTraded}
        />
      )}
    </MarketLayout>
  );
}
