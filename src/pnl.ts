import { listAllFundTransactionsForUser, listAllTransactionsForUser, type FundTransactionRow, type TransactionRow } from "./db";

// Realized P&L on 'sell'/'liquidation' rows only, via average-cost replay -
// mirrors exactly how holdings.cost_basis_total is maintained in
// executeTrade()/liquidateWarriorHoldings() (db.ts), where transactions.total
// is always price*shares (fees are applied to the wallet balance, never
// folded into total). 'buy' rows have no realized gain yet, so they're
// simply absent from the returned map. Grouped by groupKey (warrior_id or
// fund_id) so the same replay logic works for both trade types.
export interface RealizedWindow {
  since: number;
  until: number;
}

function replayRealizedPnl<
  T extends { id: number; side: "buy" | "sell" | "liquidation"; shares: number; total: number; created_at: number },
>(rows: T[], groupKey: (row: T) => number, window?: RealizedWindow): Map<number, number> {
  const state = new Map<number, { shares: number; costBasis: number }>();
  const pnlByTxId = new Map<number, number>();

  for (const tx of rows) {
    const key = groupKey(tx);
    let s = state.get(key);
    if (!s) {
      s = { shares: 0, costBasis: 0 };
      state.set(key, s);
    }
    if (tx.side === "buy") {
      s.shares += tx.shares;
      s.costBasis += tx.total;
    } else {
      const avgCost = s.shares > 0 ? s.costBasis / s.shares : 0;
      // Cost basis is always replayed off the FULL history (below), but a
      // caller-supplied window only wants sells that happened *within* it -
      // e.g. the weekly summary's "who realized the most this week", where
      // an early sell's average cost still depends on buys from months ago.
      if (!window || (tx.created_at >= window.since && tx.created_at <= window.until)) {
        pnlByTxId.set(tx.id, tx.total - avgCost * tx.shares);
      }
      s.costBasis -= avgCost * tx.shares;
      s.shares -= tx.shares;
      if (s.shares <= 1e-9) {
        s.shares = 0;
        s.costBasis = 0;
      }
    }
  }

  return pnlByTxId;
}

// Always replays a user's FULL transaction history, never a paginated or
// limited slice - average cost at any sell depends on every earlier buy for
// that (user, warrior) pair. Callers join this map onto whatever transaction
// list they actually display, keyed by transaction id. An optional `window`
// restricts which sells are *included in the returned map*, without ever
// truncating the history the cost-basis replay itself walks.
export function computeRealizedPnlByUser(userId: string, window?: RealizedWindow): Map<number, number> {
  return replayRealizedPnl(listAllTransactionsForUser(userId), (tx: TransactionRow) => tx.warrior_id, window);
}

// Same as computeRealizedPnlByUser but for fund trades - grouped by fund_id
// instead of warrior_id.
export function computeRealizedFundPnlByUser(userId: string): Map<number, number> {
  return replayRealizedPnl(listAllFundTransactionsForUser(userId), (tx: FundTransactionRow) => tx.fund_id);
}
