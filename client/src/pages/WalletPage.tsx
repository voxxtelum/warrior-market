import { useEffect, useState } from 'react';
import { HoldingsTable } from '../components/HoldingsTable';
import { MarketLayout } from '../components/MarketLayout';
import { NetWorthDeltaBadge } from '../components/NetWorthDeltaBadge';
import { Pagination } from '../components/Pagination';
import { PortfolioBreakdownCard } from '../components/PortfolioBreakdownCard';
import { RiskBar } from '../components/RiskBar';
import { SidePill } from '../components/SidePill';
import { TradeModal } from '../components/TradeModal';
import { useAuth } from '../authContext';
import {
  getFundPositions,
  getMyTransactions,
  getWallet,
  type FundPositionView,
  type PersonalTransactionView,
  type WalletData,
} from '../api';
import { fmtCoin, fmtDateTime, fmtRelativeTime } from '../format';
import { computePortfolioConcentration } from '../portfolio';

const PAGE_SIZE = 25;

export function WalletPage() {
  const { user, loading } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<PersonalTransactionView[] | null>(
    null,
  );
  const [fundPositions, setFundPositions] = useState<FundPositionView[] | null>(null);
  const [page, setPage] = useState(0);
  const [tradeModalTarget, setTradeModalTarget] = useState<{
    playerName: string;
    server: string;
  } | null>(null);

  const load = () => {
    if (!user) return;
    Promise.all([getWallet(), getMyTransactions(), getFundPositions()]).then(([w, tx, positions]) => {
      setWallet(w);
      setTransactions(tx);
      setFundPositions(positions);
    });
  };

  useEffect(load, [user]);

  const pageCount = transactions
    ? Math.ceil(transactions.length / PAGE_SIZE)
    : 0;
  const pageTransactions = transactions?.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  if (loading) return null;

  if (!user) {
    return (
      <MarketLayout>
        <div className="card">
          <a href="/api/auth/discord">Log in with Discord</a> to see your
          wallet.
        </div>
      </MarketLayout>
    );
  }

  const concentration = computePortfolioConcentration(wallet?.holdings ?? []);

  return (
    <MarketLayout>
      <div className="card">
        <div className="wallet-summary">
          <div className="wallet-summary-item">
            <span className="value">
              {wallet ? fmtCoin(wallet.balance) : '–'}
            </span>
            <span className="label">Balance</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{wallet ? wallet.tradeCount : '–'}</span>
            <span className="label">Trades</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{wallet ? concentration.count : '–'}</span>
            <span className="label">Holdings</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">
              {wallet ? fmtCoin(wallet.netWorth - wallet.balance) : '–'}
            </span>
            <span className="label">Holdings Value</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">
              {wallet && concentration.largest
                ? `${concentration.largestPct.toFixed(0)}%`
                : '–'}
            </span>
            <span className="label">
              {concentration.largest
                ? `Largest: ${concentration.largest.playerName}`
                : 'Largest'}
            </span>
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

      <PortfolioBreakdownCard
        holdings={wallet?.holdings ?? []}
        recentTransactions={transactions ?? []}
      />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Holdings</h2>
        <HoldingsTable
          holdings={wallet?.holdings ?? []}
          holdingsValue={concentration.holdingsValue}
          showPriceDelta
          onTrade={setTradeModalTarget}
          tableId="holdings-table"
          emptyMessage="No holdings yet - trade a warrior from the Stocks page."
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Funds</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Risk</th>
                <th className="mobile-hide">Shares</th>
                <th>NAV</th>
                <th>Value</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {fundPositions?.length === 0 && (
                <tr>
                  <td colSpan={6} className="no-data">
                    No fund holdings yet - visit the Funds tab to invest.
                  </td>
                </tr>
              )}
              {fundPositions?.map((p) => {
                const pnl = p.marketValue - p.costBasisTotal;
                return (
                  <tr key={p.fundId}>
                    <td>{p.name}</td>
                    <td>
                      <RiskBar risk={p.risk} showLabel={false} />
                    </td>
                    <td className="mobile-hide">{p.shares.toFixed(3)}</td>
                    <td>{fmtCoin(p.nav)}</td>
                    <td>{fmtCoin(p.marketValue)}</td>
                    <td>
                      <span className={pnl > 0 ? 'delta-pos' : pnl < 0 ? 'delta-neg' : 'delta-neutral'}>
                        {pnl >= 0 ? '+' : ''}
                        {fmtCoin(pnl)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>My trade history</h2>
        <div className="table-scroll table-compact">
          <table>
            <thead>
              <tr>
                <th className="mobile-hide">When</th>
                <th>Target</th>
                <th className="side-pill-cell">Side</th>
                <th className="mobile-hide">Shares</th>
                <th className="mobile-hide">Price</th>
                <th>Total</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {transactions?.length === 0 && (
                <tr>
                  <td colSpan={7} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {pageTransactions?.map((tx) => (
                <tr key={`${tx.targetType}-${tx.id}`}>
                  <td className="mobile-hide">
                    {fmtDateTime(tx.createdAt)}
                    <span className="time-ago">{fmtRelativeTime(tx.createdAt)}</span>
                  </td>
                  <td className="warrior-name">{tx.targetName}</td>
                  <td className="side-pill-cell">
                    <SidePill side={tx.side} />
                  </td>
                  <td className="mobile-hide">{tx.shares.toFixed(3)}</td>
                  <td className="mobile-hide">{fmtCoin(tx.price)}</td>
                  <td>{fmtCoin(tx.total)}</td>
                  <td>
                    {tx.realizedPnl !== null ? (
                      <span
                        className={
                          tx.realizedPnl > 0
                            ? 'delta-pos'
                            : tx.realizedPnl < 0
                              ? 'delta-neg'
                              : 'delta-neutral'
                        }
                      >
                        {tx.realizedPnl >= 0 ? '+' : ''}
                        {fmtCoin(tx.realizedPnl)}
                      </span>
                    ) : (
                      <span className="no-data">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </div>

      {tradeModalTarget && (
        <TradeModal
          playerName={tradeModalTarget.playerName}
          server={tradeModalTarget.server}
          onClose={() => setTradeModalTarget(null)}
          onTraded={load}
        />
      )}
    </MarketLayout>
  );
}
