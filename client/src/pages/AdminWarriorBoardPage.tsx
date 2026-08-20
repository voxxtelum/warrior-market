import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import {
  addWarriorBoardEntry,
  adjustWarriorBoardScore,
  getWarriorBoard,
  markWarriorBoardPosted,
  removeWarriorBoardEntry,
  type WarriorBoardEntry,
} from "../api";
import { ConfirmModal } from "../components/ConfirmModal";

function fmtScore(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function arrowFor(entry: WarriorBoardEntry): string {
  if (entry.score > entry.baselineScore) return "🔺";
  if (entry.score < entry.baselineScore) return "🔻";
  return "▪️";
}

// Matches the exact spacing of the hand-maintained Discord post this page
// replaces - dividers keep their original stray/doubled spaces so pasting
// this straight into Discord looks identical to before.
function buildBoardText(entries: WarriorBoardEntry[]): string {
  const lines: string[] = [];
  lines.push("⚔️  **WARRIOR BOARD**  ⚔️ ");
  lines.push("");
  lines.push(" ------ 😎  ------");
  lines.push("");
  for (const entry of entries) {
    lines.push(`${arrowFor(entry)}[${fmtScore(entry.score)}] ${entry.name}`);
  }
  lines.push("");
  lines.push("------ 😡 ------");
  return lines.join("\n");
}

export function AdminWarriorBoardPage() {
  const [entries, setEntries] = useState<WarriorBoardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [confirmMarkPosted, setConfirmMarkPosted] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WarriorBoardEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    getWarriorBoard()
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const preview = useMemo(() => (entries ? buildBoardText(entries) : ""), [entries]);

  async function handleAdjust(id: number, delta: 1 | -1) {
    setPendingIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const updated = await adjustWarriorBoardScore(id, delta);
      setEntries(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingIds((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
    }
  }

  async function handleAddWarrior(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      const updated = await addWarriorBoardEntry(name);
      setEntries(updated);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    const updated = await removeWarriorBoardEntry(removeTarget.id);
    setEntries(updated);
    setRemoveTarget(null);
  }

  async function handleMarkPosted() {
    const updated = await markWarriorBoardPosted();
    setEntries(updated);
    setStatusMessage("Marked as posted — arrows reset.");
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(preview);
    setStatusMessage("Copied to clipboard.");
  }

  return (
    <AdminLayout>
      <section className="admin-section">
        <h2 style={{ marginTop: 0 }}>Warrior Board</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Adjust each warrior's score with +/-1, then copy the formatted board into Discord. This roster is its own
          list, separate from the site's tracked warriors.
        </p>

        {error && <div className="status error">{error}</div>}
        {loading && <p className="no-data">Loading…</p>}

        {!loading && entries && (
          <div className="summary-editor-grid">
            <div>
              <div className="summary-editor-toolbar">
                <span className="subtitle">Scores</span>
              </div>
              <div className="table-scroll warrior-board-list">
                <table>
                  <colgroup>
                    <col className="table-min-width" />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Character</th>
                      <th>Score</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <button
                            type="button"
                            className="btn-icon-plain warrior-board-icon-btn"
                            onClick={() => setRemoveTarget(entry)}
                            aria-label={`Remove ${entry.name} from the board`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </td>
                        <td>
                          <span className="player-name-cell">
                            <span className="warrior-name">{entry.name}</span>
                          </span>
                        </td>
                        <td>
                          {arrowFor(entry)} {fmtScore(entry.score)}
                        </td>
                        <td>
                          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.35rem" }}>
                            <button
                              type="button"
                              className="btn-icon-plain warrior-board-icon-btn"
                              onClick={() => handleAdjust(entry.id, -1)}
                              disabled={pendingIds.has(entry.id)}
                              aria-label={`Decrease ${entry.name}'s score by 1`}
                              title="-1"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              className="btn-icon-plain warrior-board-icon-btn"
                              onClick={() => handleAdjust(entry.id, 1)}
                              disabled={pendingIds.has(entry.id)}
                              aria-label={`Increase ${entry.name}'s score by 1`}
                              title="+1"
                            >
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form onSubmit={handleAddWarrior} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <input
                  type="text"
                  placeholder="Add a warrior…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={adding}
                  style={{ flex: 1 }}
                />
                <button type="submit" disabled={adding || !newName.trim()}>
                  Add
                </button>
              </form>
            </div>
            <div>
              <div className="summary-editor-toolbar">
                <span className="subtitle">Preview</span>
              </div>
              <div className="warrior-board-preview">{preview}</div>
              <div className="warrior-board-actions">
                <button type="button" onClick={handleCopy} disabled={loading || !entries}>
                  Copy
                </button>
                <button type="button" onClick={() => setConfirmMarkPosted(true)} disabled={loading || !entries}>
                  Mark as posted
                </button>
                {statusMessage && <span className="subtitle">{statusMessage}</span>}
              </div>
            </div>
          </div>
        )}
      </section>

      {confirmMarkPosted && (
        <ConfirmModal
          title="Mark the board as posted?"
          body={
            <p>
              This resets every warrior's arrow to ▪️ (no change) — the next round of +/-1 adjustments will be what
              shows as changed. Scores themselves aren't affected.
            </p>
          }
          confirmLabel="Mark as posted"
          onConfirm={handleMarkPosted}
          onClose={() => setConfirmMarkPosted(false)}
        />
      )}

      {removeTarget && (
        <ConfirmModal
          title={`Remove ${removeTarget.name} from the board?`}
          body={<p>This deletes their score and history from the Warrior Board. This cannot be undone.</p>}
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </AdminLayout>
  );
}
