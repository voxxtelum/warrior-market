import { useMemo, useState } from 'react';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { IconButton } from './IconButton';
import { fmtCoin, priceDelta } from '../format';
import { useIsMobile } from '../hooks/useIsMobile';

export interface HoldingsTableRow {
  playerName: string;
  server: string;
  shares: number;
  costBasisTotal: number;
  latestPrice: number | null;
  lastRaidPrice: number | null;
  lastTickDelta?: number | null;
  marketValue: number | null;
}

export interface HoldingsTableProps {
  holdings: HoldingsTableRow[];
  holdingsValue: number;
  emptyMessage: string;
  showPriceDelta?: boolean;
  onTrade?: (target: { playerName: string; server: string }) => void;
  tableId?: string;
}

type SortKey = 'character' | 'percent' | 'price' | 'shares' | 'costBasis' | 'value' | 'pnl';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'character', label: 'Character' },
  { key: 'percent', label: '% of portfolio' },
  { key: 'price', label: 'Price' },
];

function pnlOf(h: HoldingsTableRow): number | null {
  return h.marketValue !== null ? h.marketValue - h.costBasisTotal : null;
}

function percentOf(h: HoldingsTableRow, holdingsValue: number): number | null {
  return h.marketValue !== null && holdingsValue > 0 ? (h.marketValue / holdingsValue) * 100 : null;
}

function sortValue(h: HoldingsTableRow, key: SortKey, holdingsValue: number): string | number {
  switch (key) {
    case 'character':
      return `${h.playerName}-${h.server}`.toLowerCase();
    case 'percent':
      return percentOf(h, holdingsValue) ?? -Infinity;
    case 'price':
      return h.latestPrice ?? -Infinity;
    case 'shares':
      return h.shares;
    case 'costBasis':
      return h.costBasisTotal;
    case 'value':
      return h.marketValue ?? -Infinity;
    case 'pnl':
      return pnlOf(h) ?? -Infinity;
  }
}

export function HoldingsTable({
  holdings,
  holdingsValue,
  emptyMessage,
  showPriceDelta,
  onTrade,
  tableId,
}: HoldingsTableProps) {
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<SortKey>('percent');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

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

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      const av = sortValue(a, sortKey, holdingsValue);
      const bv = sortValue(b, sortKey, holdingsValue);
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * (av - bv);
    });
  }, [holdings, sortKey, sortDir, holdingsValue]);

  const colCount = 7 + (onTrade ? 1 : 0);

  return (
    <div className="table-scroll table-compact">
      <table id={tableId}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.key === 'percent' ? 'sortable text-right' : 'sortable'}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {arrowFor(col.key)}
              </th>
            ))}
            <th className="mobile-hide sortable" onClick={() => handleSort('shares')}>
              Shares{arrowFor('shares')}
            </th>
            <th className="mobile-hide sortable" onClick={() => handleSort('costBasis')}>
              Cost basis{arrowFor('costBasis')}
            </th>
            <th className="mobile-hide sortable" onClick={() => handleSort('value')}>
              Value{arrowFor('value')}
            </th>
            <th className="sortable" onClick={() => handleSort('pnl')}>
              P&amp;L{arrowFor('pnl')}
            </th>
            {onTrade && <th className="mobile-hide"></th>}
          </tr>
        </thead>
        <tbody>
          {holdings.length === 0 && (
            <tr>
              <td colSpan={colCount} className="no-data">
                {emptyMessage}
              </td>
            </tr>
          )}
          {sortedHoldings.map((h) => {
            const pnl = pnlOf(h);
            const percent = percentOf(h, holdingsValue);
            // Matches the Stock page's price-cell delta: how much just the
            // most recent price_snapshots event moved the price, not
            // distance from the raid anchor.
            const change =
              showPriceDelta && h.latestPrice !== null && h.lastTickDelta != null
                ? priceDelta(h.latestPrice - h.lastTickDelta, h.latestPrice)
                : null;
            return (
              <tr
                key={`${h.playerName}::${h.server}`}
                style={isMobile && onTrade ? { cursor: 'pointer' } : undefined}
                onClick={
                  isMobile && onTrade
                    ? () => onTrade({ playerName: h.playerName, server: h.server })
                    : undefined
                }
              >
                <td className="warrior-name">{h.playerName}</td>
                <td className="text-right">{percent !== null ? `${percent.toFixed(1)}%` : <span className="no-data">–</span>}</td>
                <td>
                  {h.latestPrice !== null ? (
                    showPriceDelta ? (
                      <div className="price-cell">
                        <span>{fmtCoin(h.latestPrice)}</span>
                        <span className={`price-cell-change ${change ? change.cls : 'no-data'}`}>
                          {change ? change.text : '–'}
                        </span>
                      </div>
                    ) : (
                      fmtCoin(h.latestPrice)
                    )
                  ) : (
                    <span className="no-data">–</span>
                  )}
                </td>
                <td className="mobile-hide">{h.shares.toFixed(3)}</td>
                <td className="mobile-hide">{fmtCoin(h.costBasisTotal)}</td>
                <td className="mobile-hide">
                  {h.marketValue !== null ? fmtCoin(h.marketValue) : <span className="no-data">–</span>}
                </td>
                <td>
                  {pnl !== null ? (
                    <span className={pnl > 0 ? 'delta-pos' : pnl < 0 ? 'delta-neg' : 'delta-neutral'}>
                      {pnl >= 0 ? '+' : ''}
                      {fmtCoin(pnl)}
                    </span>
                  ) : (
                    <span className="no-data">–</span>
                  )}
                </td>
                {onTrade && (
                  <td className="mobile-hide">
                    <IconButton
                      className="btn-affirm"
                      icon={<ArrowTrendingUpIcon className="icon-btn-icon" />}
                      label="Trade"
                      onClick={() => onTrade({ playerName: h.playerName, server: h.server })}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
