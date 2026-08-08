import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { ConfirmModal } from "../components/ConfirmModal";
import { addReport, deleteReport, getReports, type ReportRow } from "../api";

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function wclUrl(code: string): string {
  return `https://vanilla.warcraftlogs.com/reports/${code}`;
}

export function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportRow | null>(null);

  function loadReports() {
    getReports().then(setReports);
  }

  useEffect(loadReports, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteReport(deleteTarget.code);
    setDeleteTarget(null);
    setStatus({ text: `Deleted "${deleteTarget.title}"`, kind: "success" });
    loadReports();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setStatus(null);

    try {
      const body = await addReport(trimmed);
      setStatus({ text: `Added "${body.title}" (${body.zone ?? "unknown zone"})`, kind: "success" });
      setUrl("");
      loadReports();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a report</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="https://vanilla.warcraftlogs.com/reports/XXXXXXXXXXXXXXXX"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" disabled={submitting}>
            Add
          </button>
        </form>
        {status && <div className={`status ${status.kind}`}>{status.text}</div>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reports in local data</h2>
        <div className="table-scroll">
          <table id="report-table">
            {reports?.length === 0 ? (
              <tbody>
                <tr>
                  <td>No reports added yet.</td>
                </tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Instance</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports
                    ?.slice()
                    .reverse()
                    .map((r) => (
                      <tr key={r.code}>
                        <td>
                          <a href={wclUrl(r.code)} target="_blank" rel="noopener">
                            {r.title}
                          </a>
                        </td>
                        <td>{r.zone ?? "unknown zone"}</td>
                        <td>{fmtDate(r.start_time)}</td>
                        <td>
                          <button type="button" className="btn-danger" onClick={() => setDeleteTarget(r)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Delete this report?"
          body={
            <p>
              This permanently removes "{deleteTarget.title}"'s raw data and rebuilds every player's price history
              from the remaining reports — prices for other players may shift. Anyone left holding shares in a
              warrior with no raid history after this will be automatically cashed out. This cannot be undone.
            </p>
          }
          confirmLabel="Delete report"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </AdminLayout>
  );
}
