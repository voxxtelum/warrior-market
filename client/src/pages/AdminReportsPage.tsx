import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { ConfirmModal } from "../components/ConfirmModal";
import { Pagination } from "../components/Pagination";
import { ReportPreviewCard } from "../components/admin/ReportPreviewCard";
import { TrashIcon } from "../components/icons/TrashIcon";
import { addReport, deleteReport, getReports, type ReportRow } from "../api";

const REPORTS_PAGE_SIZE = 10;

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
  const [instanceFilter, setInstanceFilter] = useState("");
  const [reportsPage, setReportsPage] = useState(0);

  const pendingReport = useMemo(() => reports?.find((r) => r.status === "pending") ?? null, [reports]);
  const committedReports = useMemo(() => (reports ?? []).filter((r) => r.status === "committed"), [reports]);

  const instances = useMemo(() => {
    const zones = new Set<string>();
    for (const r of committedReports) zones.add(r.zone ?? "unknown zone");
    return [...zones].sort();
  }, [committedReports]);

  const filteredReports = useMemo(
    () =>
      committedReports
        .filter((r) => !instanceFilter || (r.zone ?? "unknown zone") === instanceFilter)
        .slice()
        .reverse(),
    [committedReports, instanceFilter]
  );

  const reportsPageCount = Math.ceil(filteredReports.length / REPORTS_PAGE_SIZE);
  // Clamped rather than reset via an effect - keeps page valid whenever the
  // list shrinks (a filter change, a delete) without an extra render pass.
  const clampedReportsPage = Math.min(reportsPage, Math.max(0, reportsPageCount - 1));
  const pageReports = filteredReports.slice(
    clampedReportsPage * REPORTS_PAGE_SIZE,
    clampedReportsPage * REPORTS_PAGE_SIZE + REPORTS_PAGE_SIZE
  );

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
      setStatus({ text: `"${body.title}" (${body.zone ?? "unknown zone"}) is pending review below`, kind: "success" });
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
            disabled={!!pendingReport}
          />
          <button type="submit" disabled={submitting || !!pendingReport}>
            Add
          </button>
        </form>
        {pendingReport && (
          <div className="status">A report is pending review below — commit or discard it before adding another.</div>
        )}
        {status && <div className={`status ${status.kind}`}>{status.text}</div>}
      </div>

      {pendingReport && (
        <ReportPreviewCard pendingReport={pendingReport} onDiscarded={loadReports} onCommitted={loadReports} />
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reports in local data</h2>
        {committedReports.length !== 0 && (
          <form onSubmit={(e) => e.preventDefault()}>
            <select
              value={instanceFilter}
              onChange={(e) => {
                setInstanceFilter(e.target.value);
                setReportsPage(0);
              }}
            >
              <option value="">All instances</option>
              {instances.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </form>
        )}
        <div className="table-scroll">
          <table id="report-table">
            {committedReports.length === 0 ? (
              <tbody>
                <tr>
                  <td>No reports added yet.</td>
                </tr>
              </tbody>
            ) : filteredReports.length === 0 ? (
              <tbody>
                <tr>
                  <td>No reports match this instance.</td>
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
                  {pageReports.map((r) => (
                    <tr key={r.code}>
                      <td>
                        <a href={wclUrl(r.code)} target="_blank" rel="noopener">
                          {r.title}
                        </a>
                      </td>
                      <td>{r.zone ?? "unknown zone"}</td>
                      <td>{fmtDate(r.start_time)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-danger btn-icon-only"
                          aria-label={`Delete "${r.title}"`}
                          title="Delete report"
                          onClick={() => setDeleteTarget(r)}
                        >
                          <TrashIcon className="icon-btn-icon" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
        <Pagination page={clampedReportsPage} pageCount={reportsPageCount} onPageChange={setReportsPage} />
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
