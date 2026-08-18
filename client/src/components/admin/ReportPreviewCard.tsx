import { useEffect, useState } from "react";
import { commitReport, deleteReport, getReportPreview, type ReportPricePreview, type ReportRow } from "../../api";
import { fmtCoin, priceDelta } from "../../format";
import { ConfirmModal } from "../ConfirmModal";
import { RefreshIcon } from "../icons/RefreshIcon";

// Shown below the "Add a report" card whenever a report is held for review
// (status: "pending") - nothing here has touched the live market yet. The
// preview is fetched fresh on mount and whenever "Refresh" is clicked, so
// retuning stock_config on the separate Stock Config tab and coming back
// here always reflects the current numbers.
export function ReportPreviewCard({
  pendingReport,
  onDiscarded,
  onCommitted,
}: {
  pendingReport: ReportRow;
  onDiscarded: () => void;
  onCommitted: () => void;
}) {
  const [preview, setPreview] = useState<ReportPricePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    getReportPreview(pendingReport.code)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [pendingReport.code]);

  async function handleDiscard() {
    await deleteReport(pendingReport.code);
    onDiscarded();
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      await commitReport(pendingReport.code);
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommitting(false);
    }
  }

  return (
    <section className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <h2 style={{ marginTop: 0 }}>Pending report: {pendingReport.title}</h2>
        <button
          type="button"
          className="btn-icon-plain"
          onClick={load}
          disabled={loading || committing}
          aria-label="Refresh preview"
          title="Refresh preview"
        >
          <RefreshIcon className="icon-btn-icon" />
        </button>
      </div>
      <p className="subtitle" style={{ marginBottom: "1rem" }}>
        {pendingReport.zone ?? "unknown zone"} — held for review. Nothing below has affected the live market yet.
      </p>
      {error && <div className="status error">{error}</div>}
      {loading ? (
        <p>Loading preview…</p>
      ) : preview && preview.participants.length === 0 ? (
        <p className="subtitle">No visible participants in this report (new/hidden raiders don't appear here).</p>
      ) : preview ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th>Current anchor</th>
                <th>Report score</th>
                <th>After anchor</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {preview.participants.map((p) => {
                const scoreCls = p.reportScore > 0 ? "delta-pos" : p.reportScore < 0 ? "delta-neg" : "delta-neutral";
                const delta = p.currentAnchor !== null ? priceDelta(p.currentAnchor, p.afterAnchor) : null;
                return (
                  <tr key={`${p.playerName}::${p.server}`}>
                    <td>{p.playerName}</td>
                    <td>{p.currentAnchor === null ? "New" : fmtCoin(p.currentAnchor)}</td>
                    <td className={scoreCls}>
                      {p.reportScore >= 0 ? "+" : ""}
                      {p.reportScore.toFixed(2)}
                    </td>
                    <td>{fmtCoin(p.afterAnchor)}</td>
                    <td className={delta ? delta.cls : "delta-neutral"}>{delta ? delta.text : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
        <button type="button" className="btn-danger" onClick={() => setConfirmDiscard(true)} disabled={committing}>
          Discard
        </button>
        <button type="button" onClick={handleCommit} disabled={committing || loading || !preview}>
          Save &amp; push to live market
        </button>
      </div>
      {confirmDiscard && (
        <ConfirmModal
          title="Discard this pending report?"
          body={
            <p>
              Nothing has been applied to the live market yet — this just removes the held raw data. This cannot be
              undone.
            </p>
          }
          confirmLabel="Discard report"
          onConfirm={handleDiscard}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </section>
  );
}
