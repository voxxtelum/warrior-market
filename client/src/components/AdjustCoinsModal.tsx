import { useState } from "react";
import { Modal } from "./Modal";
import { adjustWalletBalance, type AdminWalletRow } from "../api";

interface AdjustCoinsModalProps {
  target: AdminWalletRow;
  onClose: () => void;
  onAdjusted: () => void;
}

export function AdjustCoinsModal({ target, onClose, onAdjusted }: AdjustCoinsModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numeric = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(numeric) && numeric > 0;

  async function submit(side: "add" | "remove") {
    if (!validAmount) {
      setError("Enter a positive coin amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adjustWalletBalance(target.userId, side === "add" ? numeric : -numeric, reason.trim() || undefined);
      onAdjusted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add/remove coins - ${target.username}`} onClose={onClose}>
      <p className="subtitle adjust-coins-balance">Current balance: {target.balance.toFixed(2)} coins</p>
      <div className="adjust-coins-form">
        <input
          type="number"
          className="adjust-coins-amount"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          step="1"
          autoFocus
        />
        <input
          type="text"
          className="adjust-coins-reason"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && <p className="status error">{error}</p>}
      <div className="confirm-modal-actions">
        <button type="button" className="btn-danger" onClick={() => submit("remove")} disabled={busy}>
          Remove
        </button>
        <button type="button" className="btn-add-coins" onClick={() => submit("add")} disabled={busy}>
          Add
        </button>
      </div>
    </Modal>
  );
}
