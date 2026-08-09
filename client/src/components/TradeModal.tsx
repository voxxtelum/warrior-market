import { useCallback, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../authContext';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getWallet,
  getWarriorPrice,
  postTrade,
  type WalletData,
} from '../api';
import { fmtCoin, priceDelta } from '../format';

interface TradeModalProps {
  playerName: string;
  server: string;
  onClose: () => void;
  onTraded?: () => void;
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
  const isMobile = useIsMobile();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    // Both price and prevPrice come from the same tradable-price endpoint -
    // price is the live tradable price (raid + drift + demand), prevPrice is
    // the frozen last-raid snapshot. Deliberately not getStock()'s
    // live-recomputed series, which reapplies the *current* scoring config
    // across all history and can drift far from what's actually in the
    // ledger/chart - comparing that against the live price here would mix a
    // frozen number with a hypothetical one.
    Promise.all([getWallet(), getWarriorPrice(playerName, server)]).then(
      ([w, warriorPrice]) => {
        setWallet(w);
        setPrice(warriorPrice.price);
        setPrevPrice(warriorPrice.lastRaidPrice);
      },
    );
  }, [user, playerName, server]);

  useEffect(load, [load]);

  const holding =
    wallet?.holdings.find(
      (h) => h.playerName === playerName && h.server === server,
    ) ?? null;
  const change =
    price !== null && prevPrice !== null ? priceDelta(prevPrice, price) : null;
  const numeric = Number(amount);
  const validAmount =
    amount.trim() !== '' && Number.isFinite(numeric) && numeric > 0;
  const tradeFeePct = wallet?.tradeFeePct ?? 0;
  // Fee is added on top of the order for buys (extra cost) and subtracted
  // from proceeds for sells (less credited) - never changes the share count.
  const feeAmount = validAmount ? numeric * tradeFeePct : null;
  const totalAmount =
    validAmount && feeAmount !== null
      ? side === 'buy'
        ? numeric + feeAmount
        : numeric - feeAmount
      : null;
  // Comparing raw floats here would occasionally flag an exact "use 100% of
  // balance" amount as over balance, since the slider's derived amount and
  // the wallet balance can differ by a sub-cent float rounding error even
  // though both display as the same cent value - so compare at cent
  // precision instead. Buy-side balance requirement includes the fee.
  const overBalance =
    validAmount &&
    wallet !== null &&
    Math.round((side === 'buy' ? numeric * (1 + tradeFeePct) : numeric) * 100) >
      Math.round(wallet.balance * 100);
  const estimatedShares =
    validAmount && price !== null && price > 0 ? numeric / price : null;

  // The slider sizes the order as a % of what's available for the current
  // side (balance to buy with, position value to sell) - it drives `amount`
  // directly rather than tracking its own state, so typing in the field and
  // dragging the slider can never disagree about what the order size is.
  // Buy-side max is reduced so that amount + fee never exceeds balance.
  const maxForSide =
    side === 'buy'
      ? (wallet?.balance ?? 0) / (1 + tradeFeePct)
      : (holding?.marketValue ?? 0);
  const sliderPct =
    maxForSide > 0
      ? Math.max(
          0,
          Math.min(100, Math.round(((numeric || 0) / maxForSide) * 100)),
        )
      : 0;

  function handleSliderChange(pct: number) {
    if (maxForSide <= 0) return;
    const next = (pct / 100) * maxForSide;
    setAmount(next > 0 ? next.toFixed(2) : '');
  }

  async function trade() {
    if (!validAmount) {
      setStatus({ text: 'Enter a positive coin amount', kind: 'error' });
      return;
    }
    if (side === 'buy' && overBalance) {
      setStatus({
        text: `Insufficient balance - you only have ${fmtCoin(wallet!.balance)} coins`,
        kind: 'error',
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await postTrade(playerName, server, side, numeric);
      setStatus({
        text: `${side === 'buy' ? 'Bought' : 'Sold'} ${result.shares.toFixed(3)} shares at ${fmtCoin(result.price)} coins (${fmtCoin(result.total)} coins total)`,
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
    <Modal
      title={
        <>
          Trade <span className="warrior-name">{playerName}</span>
        </>
      }
      onClose={onClose}
      contentClassName="trade-modal-content"
    >
      {!user ? (
        <p className="subtitle">
          <a href="/api/auth/discord">Log in with Discord</a> to trade.
        </p>
      ) : (
        <>
          <div className="trade-side-toggle">
            <button
              type="button"
              className={side === 'buy' ? 'active' : undefined}
              onClick={() => setSide('buy')}
            >
              Buy
            </button>
            <button
              type="button"
              className={side === 'sell' ? 'sell active' : 'sell'}
              onClick={() => setSide('sell')}
            >
              Sell
            </button>
          </div>

          <div className="trade-info-list">
            <div className="trade-info-row">
              <span className="trade-info-label">Available balance</span>
              <span className="trade-info-value">
                {wallet ? fmtCoin(wallet.balance) : '–'}
              </span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Shares owned</span>
              <span className="trade-info-value">
                {holding ? `${holding.shares.toFixed(3)} shares` : '0 shares'}
              </span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Current price</span>
              <span className="trade-info-value">
                {price !== null ? fmtCoin(price) : '–'}
              </span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Change</span>
              <span
                className={
                  change ? `trade-info-value ${change.cls}` : 'trade-info-value'
                }
              >
                {change ? change.text : <span className="no-data">–</span>}
              </span>
            </div>
          </div>

          <div className="trade-amount-field">
            <span className="trade-amount-label">Amount</span>
            <div className="trade-amount-value-row">
              <input
                type="number"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="1"
                autoFocus={!isMobile}
              />
              <span className="trade-amount-preview">
                {estimatedShares !== null
                  ? `≈ ${estimatedShares.toFixed(3)} shares`
                  : ''}
              </span>
            </div>
          </div>

          <div className="trade-slider-row">
            <input
              type="range"
              className={side === 'sell' ? 'sell' : undefined}
              min={0}
              max={100}
              step={1}
              value={sliderPct}
              disabled={maxForSide <= 0}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
            />
            <span className="trade-slider-pct">{sliderPct}%</span>
          </div>

          <div className="trade-info-list">
            <div className="trade-info-row">
              <span className="trade-info-label">
                Fee ({(tradeFeePct * 100).toFixed(2)}%)
              </span>
              <span className="trade-info-value">
                {feeAmount !== null ? fmtCoin(feeAmount) : '–'}
              </span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Total</span>
              <span className="trade-info-value">
                {totalAmount !== null ? fmtCoin(totalAmount) : '–'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="trade-cta"
            onClick={trade}
            disabled={busy || (side === 'buy' && validAmount && overBalance)}
          >
            Place order
          </button>

          <div className="trade-status-area">
            {side === 'buy' && overBalance && !status && (
              <p className="trade-modal-hint">
                Total (including fee) exceeds your balance of{' '}
                {fmtCoin(wallet!.balance)} coins.
              </p>
            )}
            {status && <p className={`status ${status.kind}`}>{status.text}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
