import { useEffect, useMemo, useState } from 'react';
import { Pagination } from '../Pagination';
import { SidePill } from '../SidePill';
import { AnchorPriceLine } from '../AnchorPriceLine';
import {
  getWarriorHolders,
  getWarriorTrades,
  getWarriorVolumeOverview,
  type WarriorHoldersResponse,
  type WarriorTradeRow,
  type WarriorVolumeRow,
} from '../../api';
import { fmtCoin, fmtDateTime, fmtRelativeTime } from '../../format';

const TRADES_PAGE_SIZE = 10;

type SortKey =
  | 'price'
  | 'character'
  | 'invested'
  | 'volume'
  | 'trades'
  | 'shares'
  | 'holders';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'character', label: 'Character' },
  { key: 'price', label: 'Price / Anchor / Raid Anchor' },
  { key: 'invested', label: 'Total Invested' },
  { key: 'volume', label: 'Volume' },
  { key: 'trades', label: 'Trades' },
];

function sortValue(row: WarriorVolumeRow, key: SortKey): string | number {
  switch (key) {
    case 'price':
      return row.price ?? 0;
    case 'character':
      return `${row.playerName}-${row.server}`.toLowerCase();
    case 'invested':
      return row.totalInvested;
    case 'volume':
      return row.volume;
    case 'trades':
      return row.tradeCount;
    case 'shares':
      return row.totalShares;
    case 'holders':
      return row.holderCount;
  }
}

type Detail = { warriorId: number; mode: 'trades' | 'shares' } | null;

export function CharactersTab() {
  const [rows, setRows] = useState<WarriorVolumeRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('character');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const [detail, setDetail] = useState<Detail>(null);
  const [holders, setHolders] = useState<WarriorHoldersResponse | null>(null);
  const [trades, setTrades] = useState<WarriorTradeRow[] | null>(null);
  const [tradesPage, setTradesPage] = useState(0);

  useEffect(() => {
    getWarriorVolumeOverview()
      .then(setRows)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!detail) {
      setHolders(null);
      setTrades(null);
      return;
    }
    setTradesPage(0);
    if (detail.mode === 'shares') {
      getWarriorHolders(detail.warriorId)
        .then(setHolders)
        .catch(() => {});
    } else {
      getWarriorTrades(detail.warriorId)
        .then(setTrades)
        .catch(() => {});
    }
  }, [detail]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'character' ? 1 : -1);
    }
  }

  function arrowFor(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 1 ? ' ▲' : ' ▼';
  }

  const sortedRows = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => !r.hidden && (r.class === null || r.class === 'Warrior'))
      .sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        if (typeof av === 'string' || typeof bv === 'string') {
          return sortDir * String(av).localeCompare(String(bv));
        }
        return sortDir * (av - bv);
      });
  }, [rows, sortKey, sortDir]);

  function toggleDetail(warriorId: number, mode: 'trades' | 'shares') {
    setDetail((prev) =>
      prev && prev.warriorId === warriorId && prev.mode === mode ? null : { warriorId, mode },
    );
  }

  const activeRow = rows?.find((r) => r.warriorId === detail?.warriorId) ?? null;
  const tradesPageCount = trades ? Math.ceil(trades.length / TRADES_PAGE_SIZE) : 0;
  const pageTrades = trades?.slice(
    tradesPage * TRADES_PAGE_SIZE,
    tradesPage * TRADES_PAGE_SIZE + TRADES_PAGE_SIZE,
  );

  return (
    <>
      <section className="admin-section">
        <h2 style={{ marginTop: 0 }}>Characters</h2>
        <div className="table-scroll table-compact">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={
                      col.key === 'volume' || col.key === 'invested' ? 'sortable text-right' : 'sortable'
                    }
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {arrowFor(col.key)}
                  </th>
                ))}
                <th className="sortable" onClick={() => handleSort('shares')}>
                  Shares{arrowFor('shares')}
                </th>
                <th className="sortable" onClick={() => handleSort('holders')}>
                  Holders{arrowFor('holders')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={7} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {sortedRows.map((row) => (
                <tr
                  key={row.warriorId}
                  className={detail?.warriorId === row.warriorId ? 'selected-row' : undefined}
                >
                  <td className="warrior-name">
                    {row.playerName}-{row.server}
                  </td>
                  <td>
                    <AnchorPriceLine
                      price={row.price}
                      anchorPrice={row.anchorPrice}
                      raidAnchorPrice={row.raidAnchorPrice}
                    />
                  </td>
                  <td className="text-right">{fmtCoin(row.totalInvested)}</td>
                  <td className="text-right">{fmtCoin(row.volume)}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link text-link-accent"
                      onClick={() => toggleDetail(row.warriorId, 'trades')}
                    >
                      {row.tradeCount}
                    </button>
                  </td>
                  <td>{row.totalShares.toFixed(3)}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link text-link-accent"
                      onClick={() => toggleDetail(row.warriorId, 'shares')}
                    >
                      {row.holderCount}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {detail?.mode === 'shares' && (
        <section className="admin-section detail-card-enter">
          <h2 style={{ marginTop: 0 }}>
            {holders ? `${holders.playerName}-${holders.server} holders` : activeRow ? `${activeRow.playerName}-${activeRow.server} holders` : 'Holders'}
          </h2>
          {holders && (
            <>
              <div className="wallet-summary">
                <div className="wallet-summary-item">
                  <span className="value">
                    {holders.latestPrice !== null ? fmtCoin(holders.latestPrice) : '–'}
                  </span>
                  <span className="label">Price</span>
                </div>
                <div className="wallet-summary-item">
                  <span className="value">{fmtCoin(holders.totalInvested)}</span>
                  <span className="label">Total invested</span>
                </div>
                <div className="wallet-summary-item">
                  <span className="value">{holders.holders.length}</span>
                  <span className="label">Holders</span>
                </div>
              </div>

              <div className="table-scroll table-compact" style={{ marginTop: '1.25rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th className="mobile-hide">Shares</th>
                      <th>Market value</th>
                      <th>% of character</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.holders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="no-data">
                          No current holders.
                        </td>
                      </tr>
                    )}
                    {holders.holders.map((h) => (
                      <tr key={h.userId}>
                        <td>
                          <span className="player-name-cell">
                            {h.avatar ? (
                              <img
                                className="user-avatar player-name-avatar"
                                src={h.avatar}
                                alt=""
                                width={20}
                                height={20}
                              />
                            ) : (
                              <span className="user-avatar user-avatar-placeholder player-name-avatar" />
                            )}
                            {h.username}
                          </span>
                        </td>
                        <td className="mobile-hide">{h.shares.toFixed(3)}</td>
                        <td>
                          {h.marketValue !== null ? (
                            fmtCoin(h.marketValue)
                          ) : (
                            <span className="no-data">–</span>
                          )}
                        </td>
                        <td>{(h.percentOfWarrior * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {detail?.mode === 'trades' && (
        <section className="admin-section detail-card-enter">
          <h2 style={{ marginTop: 0 }}>
            {activeRow ? `${activeRow.playerName}-${activeRow.server} trades` : 'Trades'}
          </h2>
          <div className="table-scroll table-compact">
            <table>
              <thead>
                <tr>
                  <th className="mobile-hide">When</th>
                  <th>Trader</th>
                  <th className="side-pill-cell">Side</th>
                  <th className="mobile-hide">Shares</th>
                  <th className="mobile-hide">Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {trades?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="no-data">
                      No trades yet.
                    </td>
                  </tr>
                )}
                {pageTrades?.map((tx) => (
                  <tr key={tx.id}>
                    <td className="mobile-hide">
                      {fmtDateTime(tx.createdAt)}
                      <span className="time-ago">{fmtRelativeTime(tx.createdAt)}</span>
                    </td>
                    <td>
                      <span className="player-name-cell">
                        {tx.avatar ? (
                          <img
                            className="user-avatar player-name-avatar"
                            src={tx.avatar}
                            alt=""
                            width={20}
                            height={20}
                          />
                        ) : (
                          <span className="user-avatar user-avatar-placeholder player-name-avatar" />
                        )}
                        {tx.username}
                      </span>
                    </td>
                    <td className="side-pill-cell">
                      <SidePill side={tx.side} />
                    </td>
                    <td className="mobile-hide">{tx.shares.toFixed(3)}</td>
                    <td className="mobile-hide">{fmtCoin(tx.price)}</td>
                    <td>{fmtCoin(tx.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={tradesPage} pageCount={tradesPageCount} onPageChange={setTradesPage} />
        </section>
      )}
    </>
  );
}
