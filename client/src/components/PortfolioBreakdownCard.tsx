import { SidePill } from './SidePill';
import { fmtCoin, fmtRelativeTime } from '../format';

export interface PortfolioBreakdownCardProps {
  holdings: {
    playerName: string;
    server: string;
    marketValue: number | null;
    costBasisTotal: number;
  }[];
  recentTransactions: {
    id: number;
    targetType: 'character' | 'fund';
    targetName: string;
    side: 'buy' | 'sell' | 'liquidation';
    total: number;
    createdAt: number;
  }[];
}

// The Gain/Loss strip (reuses the same math as the Holdings table below,
// just per-holding instead of per-transaction) and the recent-activity
// teaser share a row - 60/40 split. Holding count and largest-holding % live
// on the balance card above this one instead (see computePortfolioConcentration).
export function PortfolioBreakdownCard({
  holdings,
  recentTransactions,
}: PortfolioBreakdownCardProps) {
  const filtered = holdings
    .filter(
      (h): h is typeof h & { marketValue: number } =>
        h.marketValue !== null && h.marketValue > 0,
    )
    .sort((a, b) => b.marketValue - a.marketValue);

  const pnlByHolding = filtered.map((h) => {
    const pnl = h.marketValue - h.costBasisTotal;
    const pct = h.costBasisTotal > 0 ? (pnl / h.costBasisTotal) * 100 : 0;
    return { ...h, pnl, pct };
  });
  const maxAbsPct = Math.max(1, ...pnlByHolding.map((h) => Math.abs(h.pct)));

  const recent = recentTransactions.slice(0, 3);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Portfolio breakdown</h2>

      <div className="portfolio-lower-grid">
        <div className="portfolio-pnl-col">
          <span className="portfolio-side-heading">Gain / Loss</span>
          {pnlByHolding.length === 0 ? (
            <p className="no-data">No holdings yet.</p>
          ) : (
            <div className="pnl-strip">
              {pnlByHolding.map((h) => (
                <div key={`${h.playerName}::${h.server}`} className="pnl-strip-item">
                  <span className="pnl-strip-name warrior-name">{h.playerName}</span>
                  <div className="pnl-strip-bar-track">
                    <div
                      className={`pnl-strip-bar ${h.pnl >= 0 ? 'positive' : 'negative'}`}
                      style={{ width: `${(Math.abs(h.pct) / maxAbsPct) * 100}%` }}
                    />
                  </div>
                  <span className={h.pnl > 0 ? 'delta-pos' : h.pnl < 0 ? 'delta-neg' : 'delta-neutral'}>
                    {h.pct >= 0 ? '+' : ''}
                    {h.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="portfolio-activity-col">
          <span className="portfolio-side-heading">Recent activity</span>
          {recent.length === 0 ? (
            <p className="no-data">No trades yet.</p>
          ) : (
            <ul className="activity-teaser">
              {recent.map((tx) => (
                <li key={`${tx.targetType}-${tx.id}`} className="activity-teaser-item">
                  <SidePill side={tx.side} />
                  <span className="activity-teaser-name warrior-name">
                    {tx.targetName}
                  </span>
                  <span className="activity-teaser-amount">
                    {fmtCoin(tx.total)}
                  </span>
                  <span className="activity-teaser-time">
                    {fmtRelativeTime(tx.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
