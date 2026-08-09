export interface HoldingLike {
  playerName: string;
  server: string;
  marketValue: number | null;
}

export interface PortfolioConcentration {
  count: number;
  holdingsValue: number;
  largest: { playerName: string; marketValue: number } | null;
  largestPct: number;
}

// Shared by the Wallet page and admin user-detail balance card - both show
// holding count and largest-holding % as top-line stats, derived the same
// way PortfolioBreakdownCard filters/sorts holdings for its chart.
export function computePortfolioConcentration(
  holdings: HoldingLike[],
): PortfolioConcentration {
  const filtered = holdings.filter(
    (h): h is HoldingLike & { marketValue: number } =>
      h.marketValue !== null && h.marketValue > 0,
  );
  const holdingsValue = filtered.reduce((sum, h) => sum + h.marketValue, 0);
  const largest = filtered.reduce<(typeof filtered)[number] | null>(
    (best, h) => (!best || h.marketValue > best.marketValue ? h : best),
    null,
  );
  const largestPct =
    largest && holdingsValue > 0 ? (largest.marketValue / holdingsValue) * 100 : 0;
  return { count: filtered.length, holdingsValue, largest, largestPct };
}
