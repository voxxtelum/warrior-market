import { useState } from "react";
import { adjustAllWalletBalances } from "../../api";
import { fmtCoin } from "../../format";

// Visually identical to AddRemoveCoinsCard (same layout, same field names)
// but has no userId - applies to every registered user at once. Placed at
// the top of Danger Zone, above the Players list, per funds.md.
export function GlobalAddRemoveCoinsCard({ onAdjusted }: { onAdjusted?: () => void }) {
  const [side, setSide] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  const numeric = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(numeric) && numeric > 0;

  async function submit() {
    if (!validAmount) {
      setStatus({ text: "Enter a positive coin amount", kind: "error" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await adjustAllWalletBalances(side === "add" ? numeric : -numeric, reason.trim() || undefined);
      setStatus({
        text: `${side === "add" ? "Added" : "Removed"} ${fmtCoin(numeric)} coins ${side === "add" ? "to" : "from"} every user`,
        kind: "success",
      });
      setAmount("");
      setReason("");
      onAdjusted?.();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Global add/remove coins</h2>
      <p className="subtitle" style={{ marginBottom: "1rem" }}>
        Adds or removes coins from every user's wallet at once. A removal that would take a user below 0 clamps
        that user to 0 instead of skipping them.
      </p>
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
          <button type="button" aria-label="Add" className={side === "add" ? "active" : undefined} onClick={() => setSide("add")}>
            +
          </button>
          <button
            type="button"
            aria-label="Remove"
            className={side === "remove" ? "sell active" : "sell"}
            onClick={() => setSide("remove")}
          >
            −
          </button>
        </div>

        <button
          type="button"
          className={side === "remove" ? "addcoins-cta sell" : "addcoins-cta"}
          onClick={submit}
          disabled={busy}
        >
          Apply to everyone
        </button>
      </div>

      <div className="trade-status-area">{status && <p className={`status ${status.kind}`}>{status.text}</p>}</div>
    </div>
  );
}
