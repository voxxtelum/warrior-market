import { useEffect, useState } from 'react';
import { MarketLayout } from '../components/MarketLayout';
import { Pagination } from '../components/Pagination';
import { TradeModal } from '../components/TradeModal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { useAuth } from '../authContext';
import {
  getMyTransactions,
  getWallet,
  type TransactionView,
  type WalletData,
} from '../api';
import { fmtCoin, fmtDateTime } from '../format';

const PAGE_SIZE = 50;

export function WalletPage() {
  const { user, loading } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<TransactionView[] | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const [tradeModalTarget, setTradeModalTarget] = useState<{
    playerName: string;
    server: string;
  } | null>(null);

  const load = () => {
    if (!user) return;
    Promise.all([getWallet(), getMyTransactions()]).then(([w, tx]) => {
      setWallet(w);
      setTransactions(tx);
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

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Holdings</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Warrior</th>
                <th>Shares</th>
                <th>Cost basis</th>
                <th>Price</th>
                <th>Value</th>
                <th>P&amp;L</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wallet?.holdings.length === 0 && (
                <tr>
                  <td colSpan={7} className="no-data">
                    No holdings yet - trade a warrior from the Stocks page.
                  </td>
                </tr>
              )}
              {wallet?.holdings.map((h) => {
                const pnl =
                  h.marketValue !== null
                    ? h.marketValue - h.costBasisTotal
                    : null;
                return (
                  <tr key={`${h.playerName}::${h.server}`}>
                    <td className="warrior-name">{h.playerName}</td>
                    <td>{h.shares.toFixed(3)}</td>
                    <td>{fmtCoin(h.costBasisTotal)}</td>
                    <td>
                      {h.latestPrice !== null ? (
                        fmtCoin(h.latestPrice)
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td>
                      {h.marketValue !== null ? (
                        fmtCoin(h.marketValue)
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td>
                      {pnl !== null ? (
                        <span
                          className={
                            pnl > 0
                              ? 'delta-pos'
                              : pnl < 0
                                ? 'delta-neg'
                                : 'delta-neutral'
                          }
                        >
                          {pnl >= 0 ? '+' : ''}
                          {fmtCoin(pnl)}
                        </span>
                      ) : (
                        <span className="no-data">–</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() =>
                          setTradeModalTarget({
                            playerName: h.playerName,
                            server: h.server,
                          })
                        }
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
        <h2 style={{ marginTop: 0 }}>My trade history</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Warrior</th>
                <th>Side</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {transactions?.length === 0 && (
                <tr>
                  <td colSpan={6} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {pageTransactions?.map((tx) => (
                <tr key={tx.id}>
                  <td>{fmtDateTime(tx.createdAt)}</td>
                  <td className="warrior-name">{tx.playerName}</td>
                  <td>{tx.side}</td>
                  <td>{tx.shares.toFixed(3)}</td>
                  <td>{fmtCoin(tx.price)}</td>
                  <td>{fmtCoin(tx.total)}</td>
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
