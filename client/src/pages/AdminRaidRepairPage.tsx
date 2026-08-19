import { Fragment, useEffect, useState } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { ConfirmModal } from '../components/ConfirmModal';
import { applyRaidRepair, getRaidRepairPreview, type RaidLedgerCorrection } from '../api';
import { fmtCoin } from '../format';

// Temporary, one-off tooling for the historical raid-ledger corruption
// described in src/raidLedgerRepair.ts (server). Delete this page, its
// route, and its sidebar entry once it's been run in production.
export function AdminRaidRepairPage() {
  const [corrections, setCorrections] = useState<RaidLedgerCorrection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  function refresh() {
    setError(null);
    getRaidRepairPreview()
      .then(setCorrections)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(refresh, []);

  async function handleApply() {
    const applied = await applyRaidRepair();
    setAppliedCount(applied);
    refresh();
  }

  const totalRows = corrections?.reduce((sum, c) => sum + c.raidRows.length + 1, 0) ?? 0;

  return (
    <AdminLayout>
      <section className="admin-section">
        <h2 style={{ marginTop: 0 }}>Raid Ledger Repair</h2>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          One-time correction for raid rows a past report-deletion bug rewrote with recomputed, wrong values (see
          the "raid dip immediately corrected by an oversized drift" pattern). Each cluster below is a run of raid
          rows sandwiched between two untouched drift/trade/swing rows, whose known-good prices bound what the
          raid(s) in between should actually have moved. Nothing is written until you click Apply.
        </p>

        {error && <p className="status error">{error}</p>}
        {appliedCount !== null && (
          <p className="status success">Applied {appliedCount} correction{appliedCount === 1 ? '' : 's'}.</p>
        )}

        {corrections === null ? (
          <p className="no-data">Loading…</p>
        ) : corrections.length === 0 ? (
          <p className="no-data">No corrections needed — the ledger is clean.</p>
        ) : (
          <>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span>
                {corrections.length} cluster{corrections.length === 1 ? '' : 's'} across{' '}
                {new Set(corrections.map((c) => c.warriorId)).size} character
                {new Set(corrections.map((c) => c.warriorId)).size === 1 ? '' : 's'} ({totalRows} rows)
              </span>
              <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
                Apply Corrections
              </button>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Report</th>
                    <th>Price</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((c) => (
                    <Fragment key={`${c.warriorId}-${c.afterRow.id}`}>
                      {c.raidRows.map((r) => (
                        <tr key={r.id}>
                          <td className="warrior-name">
                            {c.playerName}-{c.server}
                          </td>
                          <td>{r.reportCode}</td>
                          <td>
                            {fmtCoin(r.oldPrice)} → {fmtCoin(r.newPrice)}
                          </td>
                          <td>
                            {r.oldDelta === null ? '–' : fmtCoin(r.oldDelta)} → {fmtCoin(r.newDelta)}
                          </td>
                        </tr>
                      ))}
                      <tr key={c.afterRow.id} className="no-data">
                        <td className="warrior-name">
                          {c.playerName}-{c.server}
                        </td>
                        <td>(corrective drift)</td>
                        <td>{fmtCoin(c.afterRow.price)} (unchanged)</td>
                        <td>
                          {c.afterRow.oldDelta === null ? '–' : fmtCoin(c.afterRow.oldDelta)} →{' '}
                          {fmtCoin(c.afterRow.newDelta)}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {confirming && (
        <ConfirmModal
          title="Apply raid ledger corrections?"
          body={
            <p>
              This rewrites price/delta on the {totalRows} rows listed above. A manual backup is taken first. This
              cannot be undone except by restoring that backup.
            </p>
          }
          confirmLabel="Apply Corrections"
          onConfirm={handleApply}
          onClose={() => setConfirming(false)}
        />
      )}
    </AdminLayout>
  );
}
