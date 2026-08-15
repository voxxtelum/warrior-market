import { useState } from 'react';
import { Modal } from '../Modal';
import { linkUserWarrior, linkUserWarriorManual, type AdminWarriorRow } from '../../api';
import { CLASSES, REALMS } from '../../warriorClasses';

interface LinkCharacterModalProps {
  userId: string;
  unlinkedWarriors: AdminWarriorRow[];
  onClose: () => void;
  onLinked: () => void;
}

export function LinkCharacterModal({
  userId,
  unlinkedWarriors,
  onClose,
  onLinked,
}: LinkCharacterModalProps) {
  const [existingSelection, setExistingSelection] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualServer, setManualServer] = useState<(typeof REALMS)[number]>(REALMS[0]);
  const [manualClass, setManualClass] = useState<(typeof CLASSES)[number]>(CLASSES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLinkExisting() {
    if (existingSelection === '') return;
    setSaving(true);
    setError(null);
    try {
      await linkUserWarrior(userId, Number(existingSelection));
      onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAndLink() {
    if (!manualName.trim()) {
      setError('Character name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await linkUserWarriorManual(userId, manualName.trim(), manualServer, manualClass);
      onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Link Character" onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Existing character</h3>
      <div className="link-character-row">
        <select
          value={existingSelection}
          onChange={(e) => setExistingSelection(e.target.value)}
        >
          <option value="" disabled>
            Select a character
          </option>
          {unlinkedWarriors.map((w) => (
            <option key={w.id} value={w.id}>
              {w.playerName}-{w.server}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-affirm"
          onClick={handleLinkExisting}
          disabled={saving || existingSelection === ''}
        >
          Link
        </button>
      </div>

      <hr />

      <h3>New character</h3>
      <div className="config-grid">
        <label>
          <span className="field-label">Character name</span>
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Realm</span>
          <select
            value={manualServer}
            onChange={(e) => setManualServer(e.target.value as (typeof REALMS)[number])}
          >
            {REALMS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Class</span>
          <select
            value={manualClass}
            onChange={(e) => setManualClass(e.target.value as (typeof CLASSES)[number])}
          >
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="btn-affirm"
        style={{ marginTop: '0.75rem' }}
        onClick={handleCreateAndLink}
        disabled={saving}
      >
        Create &amp; Link
      </button>

      {error && <p className="status error">{error}</p>}
    </Modal>
  );
}
