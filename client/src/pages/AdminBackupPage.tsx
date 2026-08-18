import { useEffect, useState } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  createManualBackup,
  deleteBackup,
  getBackupSettings,
  getBackups,
  restoreBackup,
  saveBackupSettings,
  type BackupKind,
  type BackupRecord,
  type BackupSettings,
} from '../api';
import { fmtDateTime } from '../format';

const KIND_LABELS: Record<BackupKind, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  manual: 'Manual',
  pre_report: 'Pre-Report',
  pre_restore: 'Pre-Restore',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = n;
  let i = -1;
  do {
    val /= 1024;
    i++;
  } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
}

export function AdminBackupPage() {
  const [backups, setBackups] = useState<BackupRecord[] | null>(null);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [retainHourlyInput, setRetainHourlyInput] = useState(12);
  const [retainDailyInput, setRetainDailyInput] = useState(3);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BackupRecord | null>(null);
  const [restoring, setRestoring] = useState<BackupRecord | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  function load() {
    getBackups()
      .then(setBackups)
      .catch(() => {});
    getBackupSettings()
      .then((s) => {
        setSettings(s);
        setRetainHourlyInput(s.retainHourly);
        setRetainDailyInput(s.retainDaily);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleSaveSettings() {
    setSavingSettings(true);
    setSettingsStatus(null);
    try {
      const saved = await saveBackupSettings({
        retainHourly: retainHourlyInput,
        retainDaily: retainDailyInput,
      });
      setSettings(saved);
      setSettingsStatus({ text: 'Saved.', kind: 'success' });
      load();
    } catch (err) {
      setSettingsStatus({
        text: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleManualBackup() {
    setCreatingBackup(true);
    setCreateError(null);
    try {
      await createManualBackup();
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteBackup(deleting.id);
    setDeleting(null);
    load();
  }

  async function handleRestore() {
    if (!restoring) return;
    await restoreBackup(restoring.id, 'RESTORE BACKUP');
    setRestoring(null);
    setRestoreMessage(
      'Restoring - the server is restarting and will be unavailable for a few seconds. Refresh the page shortly.',
    );
  }

  const dirty =
    settings !== null &&
    (retainHourlyInput !== settings.retainHourly ||
      retainDailyInput !== settings.retainDaily);

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Backup Settings</h2>
        <div className="config-grid">
          <label>
            <span
              className="field-label"
              title="Number of hourly backups to keep before older ones are deleted"
            >
              Retain hourly backups
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={retainHourlyInput}
              onChange={(e) => setRetainHourlyInput(Number(e.target.value))}
            />
          </label>
          <label>
            <span
              className="field-label"
              title="Number of daily backups to keep before older ones are deleted"
            >
              Retain daily backups
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={retainDailyInput}
              onChange={(e) => setRetainDailyInput(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="card-footer">
          {settingsStatus && (
            <span className={`status ${settingsStatus.kind}`}>
              {settingsStatus.text}
            </span>
          )}
          <button
            type="button"
            className="btn-affirm"
            onClick={handleSaveSettings}
            disabled={savingSettings || !dirty}
          >
            Save changes
          </button>
        </div>
      </div>

      <div className="card">
        <div
          className="card-header-row"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0 }}>Backups</h2>
          <button
            type="button"
            className="btn"
            onClick={handleManualBackup}
            disabled={creatingBackup}
          >
            {creatingBackup ? 'Backing up...' : 'Create Manual Backup'}
          </button>
        </div>
        {createError && <p className="status error">{createError}</p>}
        {restoreMessage && <p className="status success">{restoreMessage}</p>}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="text-left">Kind</th>
                <th className="text-left">Filename</th>
                <th>Created</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups?.map((b) => (
                <tr key={b.id}>
                  <td className="text-left">{KIND_LABELS[b.kind]}</td>
                  <td className="text-left">
                    <a href={`/api/admin/backup/${b.id}/download`}>
                      {b.filename}
                    </a>
                  </td>
                  <td>{fmtDateTime(b.createdAt)}</td>
                  <td>{fmtBytes(b.sizeBytes)}</td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => setRestoring(b)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => setDeleting(b)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {backups?.length === 0 && (
                <tr>
                  <td colSpan={5} className="subtitle">
                    No backups yet - create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleting && (
        <ConfirmModal
          title={`Delete this ${KIND_LABELS[deleting.kind].toLowerCase()} backup?`}
          body={
            <p>
              This cannot be undone. The backup file "{deleting.filename}" will
              be permanently removed.
            </p>
          }
          confirmLabel="Delete backup"
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
        />
      )}

      {restoring && (
        <ConfirmModal
          title={`Restore "${restoring.filename}"?`}
          body={
            <>
              <p>
                This will immediately replace the entire live database with this
                backup's contents. Everything that happened since{' '}
                {fmtDateTime(restoring.createdAt)} will be lost.
              </p>
              <p>
                A safety backup of the current state is taken automatically
                first, and the server will restart.
              </p>
              <p>
                <strong>
                  This cannot be undone from this page once confirmed.
                </strong>
              </p>
            </>
          }
          confirmLabel="Restore backup"
          requireTypedPhrase="RESTORE BACKUP"
          onConfirm={handleRestore}
          onClose={() => setRestoring(null)}
        />
      )}
    </AdminLayout>
  );
}
