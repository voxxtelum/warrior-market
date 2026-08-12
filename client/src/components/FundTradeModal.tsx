import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useAuth } from "../authContext";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  getFundPositions,
  getWallet,
  postFundTrade,
  type FundPositionView,
  type PublicFundView,
  type WalletData,
} from "../api";
import { fmtCoin } from "../format";

interface FundTradeModalProps {
  fund: PublicFundView;
  onClose: () => void;
  onTraded?: () => void;
}

// Near-literal clone of TradeModal.tsx, adapted for funds: a fee only on
// the buy side, a tax (gain-only) only on the sell side - the opposite of
// stocks' single symmetric tradeFeePct - and trading against a fund's NAV
// instead of a warrior's price.
export function FundTradeModal({ fund, onClose, onTraded }: FundTradeModalProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [position, setPosition] = useState<FundPositionView | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    Promise.all([getWallet(), getFundPositions()]).then(([w, positions]) => {
      setWallet(w);
      setPosition(positions.find((p) => p.fundId === fund.id) ?? null);
    });
  }, [user, fund.id]);

  useEffect(load, [load]);

  const numeric = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(numeric) && numeric > 0;
  const estimatedShares = validAmount && fund.nav > 0 ? numeric / fund.nav : null;

  const feeAmount = side === "buy" && validAmount ? numeric * fund.feePct : null;

  // Mirrors executeFundTrade's exact avg-cost math (src/db.ts) so the
  // preview matches what actually executes - zero tax on a loss.
  let taxAmount: number | null = null;
  if (side === "sell" && validAmount && position && position.shares > 0) {
    const avgCost = position.costBasisTotal / position.shares;
    const sellShares = Math.min(estimatedShares ?? 0, position.shares);
    const sellTotal = sellShares * fund.nav;
    const gain = sellTotal - avgCost * sellShares;
    taxAmount = Math.max(0, gain) * fund.taxPct;
  }

  const totalAmount = validAmount
    ? side === "buy"
      ? numeric + (feeAmount ?? 0)
      : numeric - (taxAmount ?? 0)
    : null;

  const overBalance =
    validAmount &&
    wallet !== null &&
    side === "buy" &&
    Math.round((numeric + (feeAmount ?? 0)) * 100) > Math.round(wallet.balance * 100);

  const maxForSide =
    side === "buy" ? (wallet?.balance ?? 0) / (1 + fund.feePct) : (position?.marketValue ?? 0);
  const sliderPct =
    maxForSide > 0 ? Math.max(0, Math.min(100, Math.round(((numeric || 0) / maxForSide) * 100))) : 0;

  function handleSliderChange(pct: number) {
    if (maxForSide <= 0) return;
    const next = (pct / 100) * maxForSide;
    setAmount(next > 0 ? next.toFixed(2) : "");
  }

  async function trade() {
    if (!validAmount) {
      setStatus({ text: "Enter a positive coin amount", kind: "error" });
      return;
    }
    if (side === "buy" && overBalance) {
      setStatus({
        text: `Insufficient balance - you only have ${fmtCoin(wallet!.balance)} coins`,
        kind: "error",
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await postFundTrade(fund.id, side, numeric);
      setStatus({
        text: `${side === "buy" ? "Bought" : "Sold"} ${result.shares.toFixed(3)} shares at ${fmtCoin(result.nav)} coins (${fmtCoin(result.total)} coins total)`,
        kind: "success",
      });
      setAmount("");
      load();
      onTraded?.();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        <>
          Trade <span className="warrior-name">{fund.name}</span>
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
            <button type="button" className={side === "buy" ? "active" : undefined} onClick={() => setSide("buy")}>
              Buy
            </button>
            <button
              type="button"
              className={side === "sell" ? "sell active" : "sell"}
              onClick={() => setSide("sell")}
            >
              Sell
            </button>
          </div>

          <div className="trade-info-list">
            <div className="trade-info-row">
              <span className="trade-info-label">Available balance</span>
              <span className="trade-info-value">{wallet ? fmtCoin(wallet.balance) : "–"}</span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Shares owned</span>
              <span className="trade-info-value">
                {position ? `${position.shares.toFixed(3)} shares` : "0 shares"}
              </span>
            </div>
            <div className="trade-info-row">
              <span className="trade-info-label">Current NAV</span>
              <span className="trade-info-value">{fmtCoin(fund.nav)}</span>
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
                {estimatedShares !== null ? `≈ ${estimatedShares.toFixed(3)} shares` : ""}
              </span>
            </div>
          </div>

          <div className="trade-slider-row">
            <input
              type="range"
              className={side === "sell" ? "sell" : undefined}
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
            {side === "buy" ? (
              <div className="trade-info-row">
                <span className="trade-info-label">Fee ({(fund.feePct * 100).toFixed(2)}%)</span>
                <span className="trade-info-value">{feeAmount !== null ? fmtCoin(feeAmount) : "–"}</span>
              </div>
            ) : (
              <div className="trade-info-row">
                <span className="trade-info-label">Tax on gain ({(fund.taxPct * 100).toFixed(2)}%)</span>
                <span className="trade-info-value">{taxAmount !== null ? fmtCoin(taxAmount) : "–"}</span>
              </div>
            )}
            <div className="trade-info-row">
              <span className="trade-info-label">Total</span>
              <span className="trade-info-value">{totalAmount !== null ? fmtCoin(totalAmount) : "–"}</span>
            </div>
          </div>

          <button
            type="button"
            className="trade-cta"
            onClick={trade}
            disabled={busy || (side === "buy" && validAmount && overBalance)}
          >
            Place order
          </button>

          <div className="trade-status-area">
            {side === "buy" && overBalance && !status && (
              <p className="trade-modal-hint">
                Total (including fee) exceeds your balance of {fmtCoin(wallet!.balance)} coins.
              </p>
            )}
            {status && <p className={`status ${status.kind}`}>{status.text}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
