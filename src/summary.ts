import {
  getActiveFunds,
  getAllOpenHoldings,
  getFundNavAt,
  getPriceAtOrBefore,
  getPriceHistory,
  getPriceSnapshotsInRange,
  getTransactionsInRange,
  getUserById,
  listTransactionsForHolding,
} from "./db";
import { computeRealizedPnlByUser } from "./pnl";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_VOLATILITY_RETURNS = 3;

interface CharacterRef {
  warriorId: number;
  playerName: string;
  server: string;
  class: string | null;
}

interface UserRef {
  userId: string;
  username: string;
}

export interface WeeklySummaryData {
  weekStart: number;
  weekEnd: number;
  mostActiveTrader: (UserRef & { tradeCount: number }) | null;
  mostTradedCharacter: (CharacterRef & { tradeCount: number }) | null;
  guildVolume: { buyVolume: number; sellVolume: number; netSentiment: number; totalVolume: number };
  biggestTrade:
    | (UserRef &
        CharacterRef & { side: "buy" | "sell"; shares: number; price: number; total: number; createdAt: number })
    | null;
  biggestGainer: (CharacterRef & { pctChange: number; fromPrice: number; toPrice: number }) | null;
  biggestLoser: (CharacterRef & { pctChange: number; fromPrice: number; toPrice: number }) | null;
  mostVolatile: (CharacterRef & { volatility: number }) | null;
  topRealizedGainer: (UserRef & { realizedPnl: number }) | null;
  topRealizedLoser: (UserRef & { realizedPnl: number }) | null;
  topFund: { fundId: number; name: string; pctChange: number } | null;
  bottomFund: { fundId: number; name: string; pctChange: number } | null;
  diamondHands: (UserRef & CharacterRef & { heldSinceMs: number }) | null;
  paperHands: (UserRef & { sellCount: number }) | null;
}

function dayBucket(ts: number): number {
  return Math.floor(ts / MS_PER_DAY);
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

// Forward-filled daily price series for one warrior over [startMs, endMs] -
// same technique as fundStats.ts's buildDailyBasketSeries, but anchored to
// an arbitrary caller-supplied window instead of "N days trailing now", so
// it works for any past week the admin navigates to, not just the current
// one.
function buildWarriorDailySeries(warriorId: number, startMs: number, endMs: number): number[] {
  const startDay = dayBucket(startMs);
  const endDay = dayBucket(endMs);

  const priceByDay = new Map<number, number>();
  for (const snap of getPriceHistory(warriorId)) {
    const day = dayBucket(snap.created_at);
    if (day > endDay) break;
    priceByDay.set(day, snap.price);
  }

  let lastKnown: number | undefined;
  for (const [day, price] of priceByDay) {
    if (day < startDay) lastKnown = price;
    else break;
  }

  const series: number[] = [];
  for (let day = startDay; day <= endDay; day++) {
    const priceToday = priceByDay.get(day);
    if (priceToday !== undefined) lastKnown = priceToday;
    if (lastKnown !== undefined) series.push(lastKnown);
  }
  return series;
}

function computeVolatility(warriorId: number, startMs: number, endMs: number): number | null {
  const series = buildWarriorDailySeries(warriorId, startMs, endMs);
  if (series.length < MIN_VOLATILITY_RETURNS + 1) return null;
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev <= 0) continue;
    returns.push((series[i] - prev) / prev);
  }
  if (returns.length < MIN_VOLATILITY_RETURNS) return null;
  return stddev(returns);
}

// Timestamp the current unbroken "no sell" streak began for a (user,
// warrior) holding - the first buy immediately after the most recent sell/
// liquidation, or the very first buy ever if there has never been one. Null
// if the holding has no buy at all (shouldn't happen for a row with
// shares > 0, but guards against it anyway).
function findStreakStart(userId: string, warriorId: number): number | null {
  let openedAt: number | null = null;
  for (const tx of listTransactionsForHolding(userId, warriorId)) {
    if (tx.side === "buy") {
      if (openedAt === null) openedAt = tx.created_at;
    } else {
      openedAt = null;
    }
  }
  return openedAt;
}

export function buildWeeklySummary(weekStart: number, weekEnd: number): WeeklySummaryData {
  const transactions = getTransactionsInRange(weekStart, weekEnd).filter((t) => t.side !== "liquidation");

  const tradesByUser = new Map<string, { username: string; count: number }>();
  const tradesByWarrior = new Map<number, CharacterRef & { count: number }>();
  let buyVolume = 0;
  let sellVolume = 0;
  let biggestTrade: WeeklySummaryData["biggestTrade"] = null;
  const sellCountByUser = new Map<string, { username: string; count: number }>();

  for (const t of transactions) {
    const userEntry = tradesByUser.get(t.user_id) ?? { username: t.username, count: 0 };
    userEntry.count += 1;
    tradesByUser.set(t.user_id, userEntry);

    const warriorEntry = tradesByWarrior.get(t.warrior_id) ?? {
      warriorId: t.warrior_id,
      playerName: t.player_name,
      server: t.server,
      class: t.class,
      count: 0,
    };
    warriorEntry.count += 1;
    tradesByWarrior.set(t.warrior_id, warriorEntry);

    if (t.side === "buy") buyVolume += t.total;
    else sellVolume += t.total;

    if (t.side === "sell") {
      const sellEntry = sellCountByUser.get(t.user_id) ?? { username: t.username, count: 0 };
      sellEntry.count += 1;
      sellCountByUser.set(t.user_id, sellEntry);
    }

    if (!biggestTrade || t.total > biggestTrade.total) {
      biggestTrade = {
        userId: t.user_id,
        username: t.username,
        warriorId: t.warrior_id,
        playerName: t.player_name,
        server: t.server,
        class: t.class,
        side: t.side as "buy" | "sell",
        shares: t.shares,
        price: t.price,
        total: t.total,
        createdAt: t.created_at,
      };
    }
  }

  const mostActiveTrader = [...tradesByUser.entries()]
    .map(([userId, v]) => ({ userId, username: v.username, tradeCount: v.count }))
    .sort((a, b) => b.tradeCount - a.tradeCount)[0] ?? null;

  const mostTradedCharacter = [...tradesByWarrior.values()]
    .map((w) => ({ warriorId: w.warriorId, playerName: w.playerName, server: w.server, class: w.class, tradeCount: w.count }))
    .sort((a, b) => b.tradeCount - a.tradeCount)[0] ?? null;

  const paperHands = [...sellCountByUser.entries()]
    .map(([userId, v]) => ({ userId, username: v.username, sellCount: v.count }))
    .sort((a, b) => b.sellCount - a.sellCount)[0] ?? null;

  // Biggest mover + most volatile: scan every warrior with a price snapshot
  // in-window, comparing the price as-of-window-start to as-of-window-end
  // (not just the in-window snapshots, so a week with only drift ticks and
  // no raid still shows a meaningful move).
  const warriorIds = new Set<number>();
  const warriorRefs = new Map<number, CharacterRef>();
  for (const snap of getPriceSnapshotsInRange(weekStart, weekEnd)) {
    warriorIds.add(snap.warrior_id);
    warriorRefs.set(snap.warrior_id, {
      warriorId: snap.warrior_id,
      playerName: snap.player_name,
      server: snap.server,
      class: snap.class,
    });
  }

  let biggestGainer: WeeklySummaryData["biggestGainer"] = null;
  let biggestLoser: WeeklySummaryData["biggestLoser"] = null;
  let mostVolatile: WeeklySummaryData["mostVolatile"] = null;
  let mostVolatileScore = -Infinity;

  for (const warriorId of warriorIds) {
    const ref = warriorRefs.get(warriorId)!;
    const fromPrice = getPriceAtOrBefore(warriorId, weekStart);
    const toPrice = getPriceAtOrBefore(warriorId, weekEnd);
    if (fromPrice !== null && toPrice !== null && fromPrice > 0) {
      const pctChange = (toPrice - fromPrice) / fromPrice;
      if (!biggestGainer || pctChange > biggestGainer.pctChange) {
        biggestGainer = { ...ref, pctChange, fromPrice, toPrice };
      }
      if (!biggestLoser || pctChange < biggestLoser.pctChange) {
        biggestLoser = { ...ref, pctChange, fromPrice, toPrice };
      }
    }

    const volatility = computeVolatility(warriorId, weekStart, weekEnd);
    if (volatility !== null && volatility > mostVolatileScore) {
      mostVolatileScore = volatility;
      mostVolatile = { ...ref, volatility };
    }
  }
  // A flat/unchanged week is not an interesting "gainer"/"loser" callout.
  if (biggestGainer && biggestGainer.pctChange <= 0) biggestGainer = null;
  if (biggestLoser && biggestLoser.pctChange >= 0) biggestLoser = null;

  // Realized P&L leaderboard: only users who actually sold/liquidated
  // something this week have anything to report, so scope to that set
  // rather than replaying every user in the guild.
  const sellerIds = new Set(
    getTransactionsInRange(weekStart, weekEnd)
      .filter((t) => t.side === "sell" || t.side === "liquidation")
      .map((t) => t.user_id),
  );
  let topRealizedGainer: WeeklySummaryData["topRealizedGainer"] = null;
  let topRealizedLoser: WeeklySummaryData["topRealizedLoser"] = null;
  for (const userId of sellerIds) {
    const pnlByTx = computeRealizedPnlByUser(userId, { since: weekStart, until: weekEnd });
    if (pnlByTx.size === 0) continue;
    const total = [...pnlByTx.values()].reduce((sum, v) => sum + v, 0);
    const user = getUserById(userId);
    if (!user) continue;
    if (!topRealizedGainer || total > topRealizedGainer.realizedPnl) {
      topRealizedGainer = { userId, username: user.username, realizedPnl: total };
    }
    if (!topRealizedLoser || total < topRealizedLoser.realizedPnl) {
      topRealizedLoser = { userId, username: user.username, realizedPnl: total };
    }
  }
  if (topRealizedGainer && topRealizedGainer.realizedPnl <= 0) topRealizedGainer = null;
  if (topRealizedLoser && topRealizedLoser.realizedPnl >= 0) topRealizedLoser = null;

  // Fund leaderboard: NAV at-or-before window start vs. at-or-before window
  // end, same "at or before" idiom as the public funds list's 7-day delta.
  // A fund created mid-week (no snapshot before weekStart) uses its seed NAV
  // as the baseline, so it can still show up as a mover in its first week.
  let topFund: WeeklySummaryData["topFund"] = null;
  let bottomFund: WeeklySummaryData["bottomFund"] = null;
  for (const fund of getActiveFunds()) {
    const toNav = getFundNavAt(fund.id, weekEnd);
    if (toNav === null) continue;
    const fromNav = getFundNavAt(fund.id, weekStart) ?? fund.seed_nav;
    if (fromNav <= 0) continue;
    const pctChange = (toNav - fromNav) / fromNav;
    if (!topFund || pctChange > topFund.pctChange) topFund = { fundId: fund.id, name: fund.name, pctChange };
    if (!bottomFund || pctChange < bottomFund.pctChange) bottomFund = { fundId: fund.id, name: fund.name, pctChange };
  }
  if (topFund && bottomFund && topFund.fundId === bottomFund.fundId) bottomFund = null;

  // Diamond Hands: longest-held open position with no sell since it was
  // last opened from zero - a current-state fact, not scoped to this week.
  let diamondHands: WeeklySummaryData["diamondHands"] = null;
  let diamondHandsSince = Infinity;
  for (const holding of getAllOpenHoldings()) {
    const streakStart = findStreakStart(holding.user_id, holding.warrior_id);
    if (streakStart !== null && streakStart < diamondHandsSince) {
      diamondHandsSince = streakStart;
      diamondHands = {
        userId: holding.user_id,
        username: holding.username,
        warriorId: holding.warrior_id,
        playerName: holding.player_name,
        server: holding.server,
        class: holding.class,
        heldSinceMs: streakStart,
      };
    }
  }

  return {
    weekStart,
    weekEnd,
    mostActiveTrader,
    mostTradedCharacter,
    guildVolume: {
      buyVolume,
      sellVolume,
      netSentiment: buyVolume - sellVolume,
      totalVolume: buyVolume + sellVolume,
    },
    biggestTrade,
    biggestGainer,
    biggestLoser,
    mostVolatile,
    topRealizedGainer,
    topRealizedLoser,
    topFund,
    bottomFund,
    diamondHands,
    paperHands,
  };
}
