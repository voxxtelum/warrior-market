import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";
import {
  getAdminAuditLog,
  getAdminNotificationAuditLog,
  type AdminNotificationAuditEntry,
  type AdminWalletAdjustment,
} from "../api";
import { fmtCoin, fmtDateTime } from "../format";

const PAGE_SIZE = 50;

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${fmtCoin(delta)}`;
}

const NOTIFICATION_ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Edited",
  activate: "Activated",
  deactivate: "Deactivated",
  delete: "Deleted",
};

export function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AdminWalletAdjustment[] | null>(null);
  const [page, setPage] = useState(0);
  const [reasonEntry, setReasonEntry] = useState<AdminWalletAdjustment | null>(null);
  const [notificationEntries, setNotificationEntries] = useState<AdminNotificationAuditEntry[] | null>(null);
  const [notificationPage, setNotificationPage] = useState(0);

  useEffect(() => {
    // A non-admin briefly hits this before RequireAdmin's redirect commits
    // (same client-side-only-guard tradeoff as the other admin pages) - swallow
    // the 401 rather than crashing on it, since the redirect is already coming.
    getAdminAuditLog()
      .then(setEntries)
      .catch(() => {});
    getAdminNotificationAuditLog()
      .then(setNotificationEntries)
      .catch(() => {});
  }, []);

  const notificationPageCount = notificationEntries ? Math.ceil(notificationEntries.length / PAGE_SIZE) : 0;
  const notificationPageEntries = notificationEntries?.slice(
    notificationPage * PAGE_SIZE,
    notificationPage * PAGE_SIZE + PAGE_SIZE,
  );

  const pageCount = entries ? Math.ceil(entries.length / PAGE_SIZE) : 0;
  const pageEntries = entries?.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <AdminLayout>
      <section className="admin-section">
        <h2 style={{ marginTop: 0 }}>Audit log</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Every manual coin adjustment made from Manage Market, newest first.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Target user</th>
                <th>Amount</th>
                <th>Balance after</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries?.length === 0 && (
                <tr>
                  <td colSpan={6} className="no-data">
                    No adjustments yet.
                  </td>
                </tr>
              )}
              {pageEntries?.map((entry) => (
                <tr key={entry.id}>
                  <td>{fmtDateTime(entry.createdAt)}</td>
                  <td>{entry.adminUsername}</td>
                  <td>{entry.targetUsername}</td>
                  <td>{fmtDelta(entry.delta)}</td>
                  <td>{fmtCoin(entry.balanceAfter)}</td>
                  <td>
                    {entry.reason ? (
                      <a
                        href="#"
                        className="text-link text-link-accent"
                        onClick={(e) => {
                          e.preventDefault();
                          setReasonEntry(entry);
                        }}
                      >
                        View
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </section>

      <section className="admin-section">
        <h2 style={{ marginTop: 0 }}>Notification actions</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Every create/edit/activate/deactivate/delete on the Notifications tab, newest first.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Notification</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {notificationEntries?.length === 0 && (
                <tr>
                  <td colSpan={4} className="no-data">
                    No notification actions yet.
                  </td>
                </tr>
              )}
              {notificationPageEntries?.map((entry) => (
                <tr key={entry.id}>
                  <td>{fmtDateTime(entry.createdAt)}</td>
                  <td>{entry.adminUsername}</td>
                  <td>{entry.notificationName ?? "—"}</td>
                  <td>{NOTIFICATION_ACTION_LABELS[entry.action] ?? entry.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={notificationPage} pageCount={notificationPageCount} onPageChange={setNotificationPage} />
      </section>

      {reasonEntry && (
        <Modal title="Reason" onClose={() => setReasonEntry(null)}>
          <p style={{ margin: 0 }}>{reasonEntry.reason}</p>
        </Modal>
      )}
    </AdminLayout>
  );
}
