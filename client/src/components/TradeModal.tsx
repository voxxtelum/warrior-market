import { useCallback, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../authContext';
import { getWallet, getWarriorPrice, postTrade, type WalletData } from '../api';

interface TradeModalProps {
  playerName: string;
  server: string;
  onClose: () => void;
  onTraded?: () => void;
}

function fmtCoin(n: number): string {
  return n.toFixed(2);
}

// Both directions take a coin amount ("buy $X worth" / "sell $X worth") -
// selling more than is held just clamps server-side to the full position, so
// this stays a single input regardless of side. Balance/holding are fetched
// fresh on open (and again after every trade) so the numbers shown here are
// never stale relative to what the server will actually enforce.
export function TradeModal({
  playerName,
  server,
  onClose,
  onTraded,
}: TradeModalProps) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    Promise.all([getWallet(), getWarriorPrice(playerName, server)]).then(
      ([w, p]) => {
        setWallet(w);
        setPrice(p);
      },
    );
  }, [user, playerName, server]);

  useEffect(load, [load]);

  const holding =
    wallet?.holdings.find(
      (h) => h.playerName === playerName && h.server === server,
    ) ?? null;
  const numeric = Number(amount);
  const validAmount =
    amount.trim() !== '' && Number.isFinite(numeric) && numeric > 0;
  const overBalance =
    validAmount && wallet !== null && numeric > wallet.balance;

  async function trade(side: 'buy' | 'sell') {
    if (!validAmount) {
      setStatus({ text: 'Enter a positive coin amount', kind: 'error' });
      return;
    }
    if (side === 'buy' && overBalance) {
      setStatus({
        text: `Insufficient balance - you only have ${fmtCoin(wallet!.balance)} coin`,
        kind: 'error',
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await postTrade(playerName, server, side, numeric);
      setStatus({
        text: `${side === 'buy' ? 'Bought' : 'Sold'} ${result.shares.toFixed(3)} shares at ${fmtCoin(result.price)} coin (${fmtCoin(result.total)} coin total)`,
        kind: 'success',
      });
      setAmount('');
      load();
      onTraded?.();
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
    <Modal title={`Trade ${playerName}`} onClose={onClose}>
      {!user ? (
        <p className="subtitle">
          <a href="/api/auth/discord">Log in with Discord</a> to trade.
        </p>
      ) : (
        <>
          <div className="trade-modal-info">
            <div className="wallet-summary-item">
              <span className="value">
                {wallet ? fmtCoin(wallet.balance) : '–'}
              </span>
              <span className="label">Balance</span>
            </div>
            <div className="wallet-summary-item">
              <span className="value">
                {holding ? `${holding.shares.toFixed(3)} shares` : '0 shares'}
              </span>
              <span className="label">Owned</span>
            </div>
            <div className="wallet-summary-item">
              <span className="value">
                {price !== null ? fmtCoin(price) : '–'}
              </span>
              <span className="label">Current price</span>
            </div>
          </div>

          <div className="trade-status-area">
            {overBalance && !status && (
              <p className="trade-modal-hint">
                Amount exceeds your balance of {fmtCoin(wallet!.balance)} coins.
              </p>
            )}
            {status && <p className={`status ${status.kind}`}>{status.text}</p>}
          </div>
          <div className="trade-panel">
            <input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="1"
              autoFocus
            />
            <button
              type="button"
              onClick={() => trade('buy')}
              disabled={busy || (validAmount && overBalance)}
            >
              Buy
            </button>
            <button
              type="button"
              className="sell-btn"
              onClick={() => trade('sell')}
              disabled={busy}
            >
              Sell
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
