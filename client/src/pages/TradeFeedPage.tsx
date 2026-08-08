import { useEffect, useState } from 'react';
import { MarketLayout } from '../components/MarketLayout';
import { Pagination } from '../components/Pagination';
import { getTradeFeed, type TransactionView } from '../api';
import { fmtDateTime } from '../format';

const PAGE_SIZE = 25;

export function TradeFeedPage() {
  const [feed, setFeed] = useState<TransactionView[] | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    getTradeFeed().then(setFeed);
  }, []);

  const pageCount = feed ? Math.ceil(feed.length / PAGE_SIZE) : 0;
  const pageFeed = feed?.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <MarketLayout>
      <div className="card">
        <div className="table-scroll">
          <table id="trade-feed-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Trader</th>
                <th>Warrior</th>
                <th>Side</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {feed?.length === 0 && (
                <tr>
                  <td colSpan={7} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {pageFeed?.map((tx) => (
                <tr
                  key={tx.id}
                  className={tx.isMine ? 'selected-row' : undefined}
                >
                  <td>{fmtDateTime(tx.createdAt)}</td>
                  <td>
                    {tx.username ?? (
                      <span className="anon-name">anonymous</span>
                    )}
                  </td>
                  <td className="warrior-name">{tx.playerName}</td>
                  <td>{tx.side}</td>
                  <td>{tx.shares.toFixed(3)}</td>
                  <td>{tx.price.toFixed(2)}</td>
                  <td>{tx.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </div>
    </MarketLayout>
  );
}
