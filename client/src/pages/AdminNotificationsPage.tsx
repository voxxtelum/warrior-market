import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { ConfirmModal } from "../components/ConfirmModal";
import { NotificationForm } from "../components/admin/NotificationForm";
import { NotificationPopup } from "../components/NotificationPopup";
import {
  activateAdminNotification,
  createAdminNotification,
  deactivateAdminNotification,
  deleteAdminNotification,
  getAdminNotifications,
  uploadNotificationImage,
  type AdminNotificationInput,
  type AdminNotificationView,
} from "../api";
import { fmtDateTime } from "../format";

interface NotificationExportEntry {
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
}

// "YY-MM-DD-HHMMSS", local time - same convention as the Funds/StockConfig exports.
function fmtExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Disk-stored image paths (/uploads/notifications/...) are server-local and
// won't exist on a different environment (see funds.md's dev->prod migration
// ask, which this mirrors) - inline each one as a base64 data URI so the
// export JSON is fully self-contained. A src that fails to fetch is left as
// its original path rather than aborting the whole export.
async function inlineImagesForExport(html: string): Promise<string> {
  const srcs = new Set<string>();
  for (const match of html.matchAll(/<img[^>]+src="(\/uploads\/notifications\/[^"]+)"/g)) {
    srcs.add(match[1]);
  }
  let result = html;
  for (const src of srcs) {
    try {
      const blob = await (await fetch(src)).blob();
      const dataUri = await blobToDataUri(blob);
      result = result.split(`src="${src}"`).join(`src="${dataUri}"`);
    } catch {
      // leave the original path - the image just won't render on import.
    }
  }
  return result;
}

// Reverse of the above: re-materializes any base64 data URIs in imported
// content back into real uploaded files, so the DB's `content` column always
// stays a lightweight path reference, never a base64 blob.
async function materializeImagesForImport(html: string): Promise<string> {
  const dataUris = new Set<string>();
  for (const match of html.matchAll(/src="(data:image\/[^"]+)"/g)) {
    dataUris.add(match[1]);
  }
  let result = html;
  for (const dataUri of dataUris) {
    try {
      const blob = await (await fetch(dataUri)).blob();
      const ext = blob.type.split("/")[1] || "png";
      const file = new File([blob], `import.${ext}`, { type: blob.type });
      const { url } = await uploadNotificationImage(file);
      result = result.split(`src="${dataUri}"`).join(`src="${url}"`);
    } catch {
      // leave the data URI - sanitize-html strips non-http(s) img srcs
      // server-side, so worst case the image is silently dropped, not a
      // hard import failure.
    }
  }
  return result;
}

export function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<AdminNotificationView[] | null>(null);
  const [editing, setEditing] = useState<AdminNotificationView | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminNotificationView | null>(null);
  const [previewing, setPreviewing] = useState<AdminNotificationView | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [ioStatus, setIoStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getAdminNotifications()
      .then(setNotifications)
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleActivate(n: AdminNotificationView) {
    setBusyId(n.id);
    try {
      await activateAdminNotification(n.id);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(n: AdminNotificationView) {
    setBusyId(n.id);
    try {
      await deactivateAdminNotification(n.id);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteAdminNotification(deleting.id);
    setDeleting(null);
    load();
  }

  async function handleExport() {
    if (!notifications) return;
    setIoBusy(true);
    setIoStatus(null);
    try {
      const entries: NotificationExportEntry[] = await Promise.all(
        notifications.map(async (n) => ({
          name: n.name,
          content: await inlineImagesForExport(n.content),
          buttonText: n.buttonText,
          buttonLink: n.buttonLink,
        })),
      );
      const json = JSON.stringify({ exportedAt: new Date().toISOString(), notifications: entries }, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notifications-${fmtExportTimestamp(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setIoStatus({ text: `Exported ${entries.length} notification(s).`, kind: "success" });
    } catch (err) {
      setIoStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setIoBusy(false);
    }
  }

  // Imported notifications always land inactive (createAdminNotification
  // never touches `active`), same as a manually-created one - an import can
  // never silently take over the single active slot.
  async function handleImportFile(file: File) {
    setIoBusy(true);
    setIoStatus(null);
    try {
      const parsed = JSON.parse(await file.text()) as { notifications?: NotificationExportEntry[] };
      if (!parsed || !Array.isArray(parsed.notifications)) {
        throw new Error("File doesn't contain a notifications export");
      }

      const created: string[] = [];
      const failed: string[] = [];
      for (const entry of parsed.notifications) {
        try {
          const content = await materializeImagesForImport(entry.content);
          const input: AdminNotificationInput = {
            name: entry.name,
            content,
            buttonText: entry.buttonText,
            buttonLink: entry.buttonLink,
          };
          const result = await createAdminNotification(input);
          created.push(result.name);
        } catch (err) {
          failed.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const parts = [`Imported ${created.length} of ${parsed.notifications.length} notification(s).`];
      if (failed.length > 0) parts.push(`Failed - ${failed.join("; ")}`);
      setIoStatus({ text: parts.join(" "), kind: failed.length > 0 ? "error" : "success" });
      load();
    } catch (err) {
      setIoStatus({ text: `Import failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error" });
    } finally {
      setIoBusy(false);
    }
  }

  return (
    <AdminLayout>
      <div className="card">
        <div className="card-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Notifications</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            <button type="button" onClick={() => importInputRef.current?.click()} disabled={ioBusy}>
              Import
            </button>
            <button type="button" onClick={handleExport} disabled={ioBusy || !notifications || notifications.length === 0}>
              Export
            </button>
            <button type="button" className="btn-affirm" onClick={() => setCreating(true)}>
              New Notification
            </button>
          </div>
        </div>
        {ioStatus && <p className={`status ${ioStatus.kind}`}>{ioStatus.text}</p>}
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Only one notification can be active at a time - activating one automatically deactivates whichever was
          active before it. Each user only ever sees the active notification once.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Button</th>
                <th>Links to</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notifications?.map((n) => (
                <tr key={n.id}>
                  <td>{n.name}</td>
                  <td>{n.buttonText}</td>
                  <td>{n.buttonLink}</td>
                  <td>{n.active ? "Active" : "Inactive"}</td>
                  <td>{fmtDateTime(n.updatedAt)}</td>
                  <td>
                    <button type="button" onClick={() => setPreviewing(n)}>
                      Preview
                    </button>
                    <button type="button" onClick={() => setEditing(n)}>
                      Edit
                    </button>
                    {n.active ? (
                      <button type="button" onClick={() => handleDeactivate(n)} disabled={busyId === n.id}>
                        Deactivate
                      </button>
                    ) : (
                      <button type="button" className="btn-affirm" onClick={() => handleActivate(n)} disabled={busyId === n.id}>
                        Activate
                      </button>
                    )}
                    <button type="button" className="btn-danger" onClick={() => setDeleting(n)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {notifications?.length === 0 && (
                <tr>
                  <td colSpan={6} className="subtitle">
                    No notifications yet - create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <NotificationForm
          notification={null}
          onSaved={load}
          onClose={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {editing && (
        <NotificationForm
          notification={editing}
          onSaved={load}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          body={<p>This cannot be undone. Users who already saw it won't be affected either way.</p>}
          confirmLabel="Delete notification"
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
        />
      )}

      {previewing && (
        <NotificationPopup
          previewNotification={{
            id: previewing.id,
            name: previewing.name,
            content: previewing.content,
            buttonText: previewing.buttonText,
            buttonLink: previewing.buttonLink,
          }}
          onClose={() => setPreviewing(null)}
        />
      )}
    </AdminLayout>
  );
}
