import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  requireTypedPhrase?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({ title, body, confirmLabel, requireTypedPhrase, onConfirm, onClose }: ConfirmModalProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phraseOk = !requireTypedPhrase || typed === requireTypedPhrase;

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-modal-body">{body}</div>
      {requireTypedPhrase && (
        <label className="confirm-modal-phrase">
          Type <code>{requireTypedPhrase}</code> to confirm
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      )}
      {error && <p className="status error">{error}</p>}
      <div className="confirm-modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-danger" onClick={handleConfirm} disabled={busy || !phraseOk}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
