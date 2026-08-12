import { getPriceHistory } from "./db";

export interface FundStatsConstituentInput {
  warriorId: number;
  stockCount: number;
}

export interface FundStats {
  volatility: number;
  yield7d: number;
  yield30d: number;
  sampleDays: number;
}

const LOOKBACK_DAYS = 30;
const MIN_SAMPLE_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

// One synthetic "basket value" per calendar day over the trailing window -
// Σ stock_count_i * price_i(day) - built by walking each day ascending and
// forward-filling each warrior's last known price (raid/drift snapshots are
// irregular, not daily, so most days have no snapshot for most warriors). A
// day is only included once at least one constituent has a known price.
export function buildDailyBasketSeries(
  constituents: FundStatsConstituentInput[],
  lookbackDays: number = LOOKBACK_DAYS,
): { day: number; basketValue: number }[] {
  if (constituents.length === 0) return [];

  const today = dayBucket(Date.now());
  const startDay = today - lookbackDays;

  const dailyPricesByWarrior = new Map<number, Map<number, number>>();
  for (const c of constituents) {
    const lastPriceByDay = new Map<number, number>();
    for (const snap of getPriceHistory(c.warriorId)) {
      const day = dayBucket(snap.created_at);
      if (day < startDay) continue;
      // getPriceHistory is ascending by created_at, so a later snapshot on
      // the same day naturally overwrites an earlier one here.
      lastPriceByDay.set(day, snap.price);
    }
    dailyPricesByWarrior.set(c.warriorId, lastPriceByDay);
  }

  const lastKnown = new Map<number, number>();
  const series: { day: number; basketValue: number }[] = [];
  for (let day = startDay; day <= today; day++) {
    let basketValue = 0;
    let anyKnown = false;
    for (const c of constituents) {
      const priceToday = dailyPricesByWarrior.get(c.warriorId)?.get(day);
      if (priceToday !== undefined) lastKnown.set(c.warriorId, priceToday);
      const price = lastKnown.get(c.warriorId);
      if (price !== undefined) {
        basketValue += price * c.stockCount;
        anyKnown = true;
      }
    }
    if (anyKnown) series.push({ day, basketValue });
  }
  return series;
}

// Estimated volatility/yield, driven entirely by existing constituent price
// history rather than the fund's own (possibly nonexistent) trade history -
// works identically for a saved fund or a draft still being built in
// FundForm. Each day's basket return is scaled by whichever multiplier
// applies to its sign *before* averaging, so a fund with an aggressive
// gainMultiplier/conservative lossMultiplier correctly shows a rosier
// estimate than the raw underlying basket would (per funds.md's "based on
// the gain and loss multipliers" ask). Returns null below MIN_SAMPLE_DAYS
// rather than a misleading number - a brand-new warrior/fund legitimately
// doesn't have enough history yet.
export function computeFundStats(
  constituents: FundStatsConstituentInput[],
  gainMultiplier: number,
  lossMultiplier: number,
  lookbackDays: number = LOOKBACK_DAYS,
): FundStats | null {
  const series = buildDailyBasketSeries(constituents, lookbackDays);
  if (series.length < MIN_SAMPLE_DAYS) return null;

  const dailyReturns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].basketValue;
    if (prev <= 0) continue;
    const pctReturn = (series[i].basketValue - prev) / prev;
    dailyReturns.push(pctReturn >= 0 ? pctReturn * gainMultiplier : pctReturn * lossMultiplier);
  }
  if (dailyReturns.length < MIN_SAMPLE_DAYS) return null;

  const meanDailyReturn = mean(dailyReturns);
  return {
    volatility: stddev(dailyReturns),
    yield7d: Math.pow(1 + meanDailyReturn, 7) - 1,
    yield30d: Math.pow(1 + meanDailyReturn, 30) - 1,
    sampleDays: dailyReturns.length,
  };
}
