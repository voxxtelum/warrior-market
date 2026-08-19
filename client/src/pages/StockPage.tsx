import { useEffect, useMemo, useState } from 'react';
import type { ChartDataset } from 'chart.js/auto';
import { MarketLayout } from '../components/MarketLayout';
import { LineChart } from '../components/LineChart';
import { NetWorthDeltaBadge } from '../components/NetWorthDeltaBadge';
import { Sparkline } from '../components/Sparkline';
import { TradeModal } from '../components/TradeModal';
import { RocketTrailIcon } from '../components/icons/RocketTrailIcon';
import { IconButton } from '../components/IconButton';
import { useAuth } from '../authContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { NEGATIVE_COLOR, POSITIVE_COLOR, lerpColor, paletteColor } from '../chartColors';
import { fmtCoin, fmtDate, fmtDateTime, priceDelta } from '../format';
import {
  getChartColorPins,
  getMarketSummary,
  getStock,
  getStockHistory,
  getWallet,
  type MarketSummary,
  type PlayerPriceHistory,
  type PlayerStock,
  type RaidLedgerPoint,
  type WalletData,
} from '../api';

const HEAT_POS_LIGHT = '#bfe3fa';
const HEAT_POS_DARK = POSITIVE_COLOR;
const HEAT_NEG_LIGHT = '#ffd0d0';
const HEAT_NEG_DARK = NEGATIVE_COLOR;

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
  // Baseline for the "since last raid" figure shown against currentPrice -
  // the warrior's raid_anchor_price, unlike `price` below (computeStock()'s
  // live-recomputed value, which can drift far from the ledger once scoring
  // config has changed since). A raid only ever moves the anchor now (not
  // currentPrice directly, except a warrior's very first raid), so this and
  // currentPrice naturally diverge as soon as drift/trading moves the live
  // price afterward - no special-casing needed for a "just landed" raid.
  sinceRaidBasePrice: number | null;
  // The most recent price_snapshots row's own stored `delta` - how much the
  // single last event (drift, swing, trade, or raid) actually moved the
  // price, independent of where that leaves currentPrice relative to
  // anything else. Distinct from sinceRaidBasePrice above: that one measures
  // distance from a fixed reference point (the raid anchor), which can read
  // as a small positive number even right after a large negative move, if
  // the price was far enough above that reference beforehand.
  lastTickDelta: number | null;
  price: number;
  raidCount: number;
  prevPrice: number | null;
  series: RaidLedgerPoint[];
  avatar: string | null;
}

function buildLeaderboard(
  priceHistory: PlayerPriceHistory[],
  currentPriceByPlayer: Map<string, number>,
  sinceRaidBasePriceByPlayer: Map<string, number>,
  lastTickDeltaByPlayer: Map<string, number | null>,
  avatarByPlayer: Map<string, string | null>,
): LeaderboardRow[] {
  return priceHistory
    .filter((p) => p.raidSeries.length > 0)
    .map((p) => {
      const last = p.raidSeries[p.raidSeries.length - 1];
      const key = `${p.player_name}::${p.server}`;
      return {
        player_name: p.player_name,
        server: p.server,
        currentPrice: currentPriceByPlayer.get(key) ?? last.price,
        sinceRaidBasePrice: sinceRaidBasePriceByPlayer.get(key) ?? null,
        lastTickDelta: lastTickDeltaByPlayer.get(key) ?? null,
        price: last.price,
        raidCount: p.raidSeries.length,
        // Synthesized from the last raid's own recorded delta rather than
        // the prior raid row's price - avoids conflating raid quality with
        // any trade-driven anchor_price nudges that happened in between (see
        // avgGainPerRaid below for why the ledger's delta, not a price diff,
        // is the source of truth). null only for a warrior's first-ever raid.
        prevPrice: last.delta !== null ? last.price - last.delta : null,
        series: p.raidSeries,
        avatar: avatarByPlayer.get(key) ?? null,
      };
    });
}

function changeValue(row: LeaderboardRow): number | null {
  return row.prevPrice !== null ? row.price - row.prevPrice : null;
}

// Flat dollar-average per-raid price change, read straight off the
// immutable ledger's own recorded deltas - the exact amount each raid moved
// the anchor when it was live-applied, forever immune to a later
// stock_config edit (unlike diffing consecutive recomputed prices, which
// silently changes any time scoring config is tuned). Excludes each
// warrior's first-ever raid, which has no recorded delta (nothing to diff
// against). Needs at least one.
function avgGainPerRaid(series: RaidLedgerPoint[]): number | null {
  const deltas = series.map((p) => p.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
}

function rowKey(row: LeaderboardRow): string {
  return `${row.player_name}::${row.server}`;
}

// Positions gained (positive) or lost (negative) vs. each player's own
// pre-raid board rank - null when there's no baseline to rank against yet
// (e.g. a player's first appearance on the board). Ranked on currentPrice /
// sinceRaidBasePrice (the same frozen-ledger family the Price column itself
// sorts by, not the live-recomputed `price`/`prevPrice` pair used for the
// raid-only "Change" and "Gain/raid" columns) so this always agrees with
// a player's actual neighbors in the default Price-sorted view - otherwise
// two players can show opposite-signed deltas of the same magnitude while
// sitting right next to each other, because trading/drift moved currentPrice
// independently of pure raid performance since their last raid.
function buildRankDeltas(
  leaderboard: LeaderboardRow[],
): Map<string, number | null> {
  const currentRank = new Map<string, number>();
  [...leaderboard]
    .sort((a, b) => b.currentPrice - a.currentPrice)
    .forEach((row, i) => currentRank.set(rowKey(row), i + 1));

  const previousRank = new Map<string, number>();
  leaderboard
    .filter((row) => row.sinceRaidBasePrice !== null)
    .sort((a, b) => (b.sinceRaidBasePrice as number) - (a.sinceRaidBasePrice as number))
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

type SortKey = 'player' | 'price' | 'change' | 'avgGain' | 'raids';

function sortValue(row: LeaderboardRow, key: SortKey): string | number | null {
  if (key === 'player') return row.player_name;
  if (key === 'price') return row.currentPrice;
  if (key === 'change') return changeValue(row);
  if (key === 'avgGain') return avgGainPerRaid(row.series);
  if (key === 'raids') return row.raidCount;
  return null;
}

const COLUMNS: { key: SortKey | null; label: string; mobileHide?: boolean }[] = [
  { key: null, label: 'Δ', mobileHide: true },
  { key: 'player', label: 'Player' },
  { key: 'price', label: 'Price' },
  { key: null, label: 'Trend (24 hours)' },
  { key: 'change', label: 'Change (last raid)', mobileHide: true },
  { key: 'avgGain', label: 'Gain/raid', mobileHide: true },
  { key: 'raids', label: 'Raids', mobileHide: true },
  { key: null, label: '', mobileHide: true },
];

function refreshHistory(setPriceHistory: (h: PlayerPriceHistory[]) => void) {
  getStockHistory().then(setPriceHistory);
}

const SPARKLINE_WINDOW = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
type RangeKey = '1D' | '1W' | '1M' | '6M' | 'All';
const RANGES: { key: RangeKey; label: string; ms: number | null }[] = [
  { key: '1D', label: '1D', ms: DAY_MS },
  { key: '1W', label: '1W', ms: 7 * DAY_MS },
  { key: '1M', label: '1M', ms: 30 * DAY_MS },
  { key: '6M', label: '6M', ms: 182 * DAY_MS },
  { key: 'All', label: 'All', ms: null },
];

export function StockPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [playersStock, setPlayersStock] = useState<PlayerStock[] | null>(null);
  const [priceHistory, setPriceHistory] = useState<PlayerPriceHistory[] | null>(
    null,
  );
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(
    null,
  );
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangeKey>('1W');
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

  // Admin-pinned "always this color" overrides, keyed by "player::server" -
  // see chartDatasets below, which checks this before falling back to
  // paletteColor()'s rank-based assignment.
  const [chartColorPins, setChartColorPins] = useState<Record<string, string>>({});
  useEffect(() => {
    getChartColorPins().then(setChartColorPins).catch(() => {});
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

  // Baseline for the "since last raid" figure per player - the server's
  // raid_anchor_price, read directly rather than scanning the ledger for a
  // 'raid'-sourced row. A raid (after a warrior's first) no longer writes a
  // live-price row at all, so there's nothing to scan for beyond the very
  // first raid - raid_anchor_price is continuously "what the most recent
  // raid set", with no reconstruction needed (see stockRouter's /history
  // handler).
  const sinceRaidBasePriceByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    if (priceHistory) {
      for (const p of priceHistory) {
        const key = `${p.player_name}::${p.server}`;
        if (p.lastRaidPrice !== null) map.set(key, p.lastRaidPrice);
      }
    }
    return map;
  }, [priceHistory]);

  // The most recent price_snapshots row's own stored delta per player - how
  // much just the last event (whatever it was) moved the price, read
  // straight off the ledger rather than computed against any baseline.
  const lastTickDeltaByPlayer = useMemo(() => {
    const map = new Map<string, number | null>();
    if (priceHistory) {
      for (const p of priceHistory) {
        const last = p.series[p.series.length - 1];
        if (last) map.set(`${p.player_name}::${p.server}`, last.delta);
      }
    }
    return map;
  }, [priceHistory]);

  // Discord avatar per player - still sourced from computeStock()'s output
  // (the only place it's attached server-side), unlike everything else the
  // leaderboard needs, which now comes straight from the immutable ledger.
  const avatarByPlayer = useMemo(() => {
    const map = new Map<string, string | null>();
    if (playersStock) {
      for (const p of playersStock) map.set(`${p.player_name}::${p.server}`, p.avatar);
    }
    return map;
  }, [playersStock]);

  const leaderboard = useMemo(
    () =>
      priceHistory
        ? buildLeaderboard(priceHistory, currentPriceByPlayer, sinceRaidBasePriceByPlayer, lastTickDeltaByPlayer, avatarByPlayer)
        : [],
    [priceHistory, currentPriceByPlayer, sinceRaidBasePriceByPlayer, lastTickDeltaByPlayer, avatarByPlayer],
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

  const { maxPos: maxPosGain, minNeg: minNegGain } = useMemo(() => {
    const gainValues = leaderboard
      .map((row) => avgGainPerRaid(row.series))
      .filter((v): v is number => v !== null);
    return heatRange(gainValues);
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
      // When a player is selected, only their line is drawn - rather than
      // fading the rest out - so the y axis autoscales to that player's own
      // price range instead of staying stretched to fit the whole board.
      const rows = hasSelection
        ? leaderboard.filter((row) => row.player_name === selectedPlayer)
        : leaderboard;
      const historyByPlayer = new Map(
        priceHistory.map((p) => [`${p.player_name}::${p.server}`, p]),
      );
      const rangeMs = RANGES.find((r) => r.key === selectedRange)?.ms ?? null;
      const cutoff = rangeMs !== null ? Date.now() - rangeMs : null;

      return rows.flatMap((row) => {
        const history = historyByPlayer.get(rowKey(row));
        if (!history) return [];
        const series =
          cutoff !== null
            ? history.series.filter((s) => s.created_at >= cutoff)
            : history.series;
        if (series.length === 0) return [];
        // Colored by the player's position in the full (unfiltered) board so
        // a given player keeps the same line color whether or not they're
        // the only one selected - unless an admin has pinned this player to
        // a fixed color (chart-colors admin tab), which always wins.
        const colorIndex = leaderboard.findIndex(
          (r) => rowKey(r) === rowKey(row),
        );
        const color = chartColorPins[rowKey(row)] ?? paletteColor(colorIndex);
        return [
          {
            label: row.player_name,
            data: series.map((s) => ({ x: s.created_at, y: s.price })),
            // Drift ticks make points ~6x denser than the old one-per-raid
            // series - Chart.js's default curve interpolation would overshoot
            // between real values at that density, so this chart specifically
            // uses straight lines (ComparePage's chart is unrelated and keeps
            // its own tension).
            tension: 0,
            borderColor: color,
            backgroundColor: color,
            borderWidth: hasSelection ? 3 : 1.5,
            pointRadius: 0,
          },
        ];
      });
    }, [priceHistory, leaderboard, selectedPlayer, selectedRange, chartColorPins]);

  // Every row's sparkline shows the same number of points (rather than one
  // point per raid, which leaves veterans with a long line and newcomers
  // with almost none) by reading the last SPARKLINE_WINDOW entries of the
  // full price_snapshots ledger - raid, drift, swing, and trade ticks alike
  // - instead of the raid-only series used elsewhere on this page. Falls
  // back to the raid-only series when priceHistory hasn't loaded yet (or
  // has no entry for a row) so the column never goes blank.
  const sparklinePrices = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!priceHistory) return map;
    for (const h of priceHistory) {
      map.set(
        `${h.player_name}::${h.server}`,
        h.series.slice(-SPARKLINE_WINDOW).map((s) => s.price),
      );
    }
    return map;
  }, [priceHistory]);

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
                <span className="value-row">
                  <span className="value">
                    {wallet ? fmtCoin(wallet.netWorth) : '–'}
                  </span>
                  {wallet && <NetWorthDeltaBadge delta={wallet.netWorthDelta} />}
                </span>
                <span className="label">Portfolio</span>
              </div>
            </div>
          </div>
        )}

        <div className="card global-stats-card mobile-hide">
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
            <div className="wallet-summary-item">
              <span className="value">1</span>
              <span className="label">Deep Prot Warriors</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll table-compact">
          <table id="stock-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    className={[
                      col.key !== null ? 'sortable' : null,
                      col.mobileHide ? 'mobile-hide' : null,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
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
                // What the single most recent price_snapshots event (drift,
                // swing, trade, or raid) actually did to the price - a real
                // move reads as that move, not as distance from some fixed
                // reference point that can hide or invert the sign of what
                // just happened. Opposed to `delta` above, which compares
                // the last two *raid* snapshots only.
                const liveDelta =
                  row.lastTickDelta !== null
                    ? priceDelta(row.currentPrice - row.lastTickDelta, row.currentPrice)
                    : null;
                const pct =
                  row.prevPrice !== null
                    ? ((row.price - row.prevPrice) / row.prevPrice) * 100
                    : 0;
                const color = delta ? heatColor(pct, maxPos, minNeg) : null;
                const gain = avgGainPerRaid(row.series);
                const gainColor =
                  gain !== null
                    ? heatColor(gain, maxPosGain, minNegGain)
                    : null;
                const gainCls =
                  gain === null
                    ? null
                    : gain > 0
                      ? 'delta-pos'
                      : gain < 0
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
                      isMobile
                        ? setTradeModalTarget({
                            playerName: row.player_name,
                            server: row.server,
                          })
                        : setSelectedPlayer((p) =>
                            p === row.player_name ? null : row.player_name,
                          )
                    }
                  >
                    <td className="mobile-hide">
                      <RankDeltaCell
                        delta={rankDeltas.get(rowKey(row)) ?? null}
                      />
                    </td>
                    <td>
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
                    </td>
                    <td>
                      <div className="price-cell">
                        <span>{fmtPrice(row.currentPrice)}</span>
                        {liveDelta && (
                          <span className={`price-cell-change ${liveDelta.cls}`}>{liveDelta.text}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Sparkline
                        prices={
                          sparklinePrices.get(rowKey(row)) ??
                          row.series.map((s) => s.price)
                        }
                        width={isMobile ? 46 : 140}
                        height={isMobile ? 20 : 34}
                      />
                    </td>
                    <td className="mobile-hide">
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
                    <td className="mobile-hide">
                      {gain !== null ? (
                        <span
                          className={
                            gainColor ? '' : (gainCls ?? undefined)
                          }
                          style={
                            gainColor ? { color: gainColor } : undefined
                          }
                        >
                          {gain >= 0 ? '+' : ''}
                          {gain.toFixed(2)}
                        </span>
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td className="mobile-hide">{row.raidCount}</td>
                    <td className="mobile-hide">
                      <IconButton
                        className="btn-affirm"
                        icon={<RocketTrailIcon className="icon-btn-icon" />}
                        label="Trade"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTradeModalTarget({
                            playerName: row.player_name,
                            server: row.server,
                          });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mobile-hide">
        <div className="section-header-row">
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>
            Warrior Stock Prices
          </h2>
          <div className="range-toggle">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={r.key === selectedRange ? 'active' : undefined}
                onClick={() => setSelectedRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <LineChart
          datasets={chartDatasets}
          height={480}
          yScaleOptions={{ title: { display: true, text: 'Price' } }}
          xScaleOptions={{ type: 'linear', ticks: { display: true } }}
          xTickFormatter={fmtDate}
          xTooltipFormatter={fmtDateTime}
        />
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
