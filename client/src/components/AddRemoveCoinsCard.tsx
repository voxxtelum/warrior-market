import { useState } from 'react';
import { adjustWalletBalance } from '../api';
import { fmtCoin } from '../format';

interface AddRemoveCoinsCardProps {
  userId: string;
  onAdjusted: () => void;
}

// Compact single-row version of the add/remove-coins flow (replaces the old
// AdjustCoinsModal). The amount field is deliberately NOT autofocused,
// unlike the deleted modal - this card sits inline on the page rather than
// popping up to grab focus. No title/balance line here - the balance
// already lives in the heading of the card above this one.
export function AddRemoveCoinsCard({ userId, onAdjusted }: AddRemoveCoinsCardProps) {
  const [side, setSide] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);

  const numeric = Number(amount);
  const validAmount =
    amount.trim() !== '' && Number.isFinite(numeric) && numeric > 0;

  async function submit() {
    if (!validAmount) {
      setStatus({ text: 'Enter a positive coin amount', kind: 'error' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await adjustWalletBalance(
        userId,
        side === 'add' ? numeric : -numeric,
        reason.trim() || undefined,
      );
      setStatus({
        text: `${side === 'add' ? 'Added' : 'Removed'} ${fmtCoin(numeric)} coins`,
        kind: 'success',
      });
      setAmount('');
      setReason('');
      onAdjusted();
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="addcoins-row">
        <div className="addcoins-field addcoins-field-amount">
          <input
            type="number"
            className="addcoins-input"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="1"
          />
          <label className="addcoins-field-label">Amount</label>
        </div>

        <div className="addcoins-field addcoins-field-reason">
          <input
            type="text"
            className="addcoins-input"
            placeholder="Optional"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="addcoins-field-label">Reason</label>
        </div>

        <div className="addcoins-toggle">
          <button
            type="button"
            aria-label="Add"
            className={side === 'add' ? 'active' : undefined}
            onClick={() => setSide('add')}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Remove"
            className={side === 'remove' ? 'sell active' : 'sell'}
            onClick={() => setSide('remove')}
          >
            −
          </button>
        </div>

        <button
          type="button"
          className={side === 'remove' ? 'addcoins-cta sell' : 'addcoins-cta'}
          onClick={submit}
          disabled={busy}
        >
          Apply
        </button>
      </div>

      <div className="trade-status-area">
        {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      </div>
    </section>
  );
}
