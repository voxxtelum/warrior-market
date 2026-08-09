import { listAllTransactionsForUser, type TransactionRow } from "./db";

// Realized P&L on 'sell'/'liquidation' rows only, via average-cost replay -
// mirrors exactly how holdings.cost_basis_total is maintained in
// executeTrade()/liquidateWarriorHoldings() (db.ts), where transactions.total
// is always price*shares (fees are applied to the wallet balance, never
// folded into total). 'buy' rows have no realized gain yet, so they're
// simply absent from the returned map.
function replayRealizedPnl(rows: TransactionRow[]): Map<number, number> {
  const state = new Map<number, { shares: number; costBasis: number }>();
  const pnlByTxId = new Map<number, number>();

  for (const tx of rows) {
    let s = state.get(tx.warrior_id);
    if (!s) {
      s = { shares: 0, costBasis: 0 };
      state.set(tx.warrior_id, s);
    }
    if (tx.side === "buy") {
      s.shares += tx.shares;
      s.costBasis += tx.total;
    } else {
      const avgCost = s.shares > 0 ? s.costBasis / s.shares : 0;
      pnlByTxId.set(tx.id, tx.total - avgCost * tx.shares);
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
// list they actually display, keyed by transaction id.
export function computeRealizedPnlByUser(userId: string): Map<number, number> {
  return replayRealizedPnl(listAllTransactionsForUser(userId));
}
