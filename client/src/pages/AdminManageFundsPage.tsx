import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { ConfirmModal } from "../components/ConfirmModal";
import { FundForm } from "../components/admin/FundForm";
import { RiskBar } from "../components/RiskBar";
import {
  createFund,
  deleteFund,
  getAdminFund,
  getAdminFunds,
  type CreateFundInput,
  type FundDetailView,
  type FundView,
} from "../api";
import { fmtCoin } from "../format";

interface FundExportEntry {
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  gainMultiplier: number;
  lossMultiplier: number;
  constituents: { playerName: string; server: string; stockCount: number }[];
}

// "YY-MM-DD-HHMMSS", local time - same convention as StockConfigTab's export.
function fmtExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function AdminManageFundsPage() {
  const [funds, setFunds] = useState<FundView[] | null>(null);
  const [editing, setEditing] = useState<FundDetailView | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FundView | null>(null);
  const [ioStatus, setIoStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getAdminFunds()
      .then(setFunds)
      .catch(() => {});
  }

  useEffect(load, []);

  // Exports every active fund, constituents keyed by (playerName, server) -
  // NEVER raw warrior_id, since dev/prod AUTOINCREMENT ids never line up
  // across environments (see funds.md's dev->prod migration ask).
  async function handleExport() {
    if (!funds) return;
    setIoBusy(true);
    setIoStatus(null);
    try {
      const active = funds.filter((f) => !f.deletedAt);
      const details = await Promise.all(active.map((f) => getAdminFund(f.id)));
      const entries: FundExportEntry[] = details.map((d) => ({
        name: d.name,
        risk: d.risk,
        feePct: d.feePct,
        taxPct: d.taxPct,
        description: d.description,
        gainMultiplier: d.gainMultiplier,
        lossMultiplier: d.lossMultiplier,
        constituents: d.constituents.map((c) => ({
          playerName: c.playerName,
          server: c.server,
          stockCount: c.stockCount,
        })),
      }));
      const json = JSON.stringify({ exportedAt: new Date().toISOString(), funds: entries }, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `funds-${fmtExportTimestamp(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setIoStatus({ text: `Exported ${entries.length} fund(s).`, kind: "success" });
    } catch (err) {
      setIoStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setIoBusy(false);
    }
  }

  // Creates or updates each imported fund via the same POST /api/admin/funds
  // path a manual create uses, with upsert:true so a name match resyncs the
  // existing fund (scalars + full constituent basket replaced) instead of
  // failing - unmatched constituent warriors are skipped (not an aborting
  // failure, per the server's tolerance), and a whole fund that still fails
  // (e.g. invalid name) is reported but doesn't stop the rest of the batch.
  async function handleImportFile(file: File) {
    setIoBusy(true);
    setIoStatus(null);
    try {
      const parsed = JSON.parse(await file.text()) as { funds?: FundExportEntry[] };
      if (!parsed || !Array.isArray(parsed.funds)) throw new Error("File doesn't contain a funds export");

      const created: string[] = [];
      const updated: string[] = [];
      const skippedNotes: string[] = [];
      const failed: string[] = [];
      for (const entry of parsed.funds) {
        const input: CreateFundInput = {
          name: entry.name,
          risk: entry.risk,
          feePct: entry.feePct,
          taxPct: entry.taxPct,
          description: entry.description,
          gainMultiplier: entry.gainMultiplier,
          lossMultiplier: entry.lossMultiplier,
          constituents: entry.constituents,
        };
        try {
          const result = await createFund(input, { upsert: true });
          (result.created ? created : updated).push(result.name);
          if (result.skippedConstituents.length > 0) {
            skippedNotes.push(
              `${result.name}: skipped ${result.skippedConstituents.map((c) => `${c.playerName} (${c.server})`).join(", ")}`,
            );
          }
        } catch (err) {
          failed.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const parts = [`Imported ${created.length + updated.length} of ${parsed.funds.length} fund(s) (${created.length} created, ${updated.length} updated).`];
      if (skippedNotes.length > 0) parts.push(`Skipped constituents - ${skippedNotes.join("; ")}`);
      if (failed.length > 0) parts.push(`Failed - ${failed.join("; ")}`);
      setIoStatus({ text: parts.join(" "), kind: failed.length > 0 ? "error" : "success" });
      load();
    } catch (err) {
      setIoStatus({ text: `Import failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error" });
    } finally {
      setIoBusy(false);
    }
  }

  async function openEdit(fund: FundView) {
    const detail = await getAdminFund(fund.id);
    setEditing(detail);
  }

  async function refreshEditing() {
    load();
    if (editing) setEditing(await getAdminFund(editing.id));
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteFund(deleting.id);
    setDeleting(null);
    load();
  }

  return (
    <AdminLayout>
      <div className="card">
        <div className="card-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Manage Funds</h2>
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
            <button type="button" onClick={handleExport} disabled={ioBusy || !funds || funds.length === 0}>
              Export
            </button>
            <button type="button" className="btn-affirm" onClick={() => setCreating(true)}>
              New Fund
            </button>
          </div>
        </div>
        {ioStatus && <p className={`status ${ioStatus.kind}`}>{ioStatus.text}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Risk</th>
                <th>Gx</th>
                <th>Lx</th>
                <th>Fee</th>
                <th>Tax</th>
                <th>NAV</th>
                <th>Shares</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {funds?.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>
                    <RiskBar risk={f.risk} />
                  </td>
                  <td>{f.gainMultiplier.toFixed(2)}</td>
                  <td>{f.lossMultiplier.toFixed(2)}</td>
                  <td>{(f.feePct * 100).toFixed(2)}%</td>
                  <td>{(f.taxPct * 100).toFixed(2)}%</td>
                  <td>{fmtCoin(f.nav)}</td>
                  <td>{f.sharesOutstanding.toFixed(2)}</td>
                  <td>{f.deletedAt ? "Deleted" : "Active"}</td>
                  <td>
                    <button type="button" onClick={() => openEdit(f)}>
                      Edit
                    </button>
                    {!f.deletedAt && (
                      <button type="button" className="btn-danger" onClick={() => setDeleting(f)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {funds?.length === 0 && (
                <tr>
                  <td colSpan={10} className="subtitle">
                    No funds yet - create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <FundForm
          fund={null}
          onSaved={load}
          onClose={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {editing && <FundForm fund={editing} onSaved={refreshEditing} onClose={() => setEditing(null)} />}

      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          body={
            <p>
              Every holder will be refunded their current position in {deleting.name} at its NAV, penalty-free, with
              a notification. This cannot be undone.
            </p>
          }
          confirmLabel="Delete fund"
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </AdminLayout>
  );
}
