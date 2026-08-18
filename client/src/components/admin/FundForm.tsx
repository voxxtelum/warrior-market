import { useEffect, useMemo, useState } from "react";
import {
  addFundConstituent,
  createFund,
  estimateFundStats,
  getAdminWarriors,
  removeFundConstituent,
  updateFund,
  updateFundConstituent,
  type AdminWarriorRow,
  type FundConstituentView,
  type FundDetailView,
  type FundStatsView,
} from "../../api";
import { RiskBar } from "../RiskBar";

interface FundFormProps {
  fund: FundDetailView | null; // null = create mode
  onSaved: () => void;
  onClose: () => void;
}

const ESTIMATE_DEBOUNCE_MS = 400;

function fmtPct(v: number): string {
  return (v * 100).toFixed(2);
}

export function FundForm({ fund, onSaved, onClose }: FundFormProps) {
  const isEdit = fund !== null;

  const [name, setName] = useState(fund?.name ?? "");
  const [risk, setRisk] = useState(fund?.risk ?? 3);
  const [feePct, setFeePct] = useState(fund ? fmtPct(fund.feePct) : "20");
  const [taxPct, setTaxPct] = useState(fund ? fmtPct(fund.taxPct) : "10");
  const [description, setDescription] = useState(fund?.description ?? "");
  const [gainMultiplier, setGainMultiplier] = useState(String(fund?.gainMultiplier ?? 1));
  const [lossMultiplier, setLossMultiplier] = useState(String(fund?.lossMultiplier ?? 1));

  const [constituents, setConstituents] = useState<FundConstituentView[]>(fund?.constituents ?? []);
  // In edit mode, add/remove/reweight are always server round-trips (never
  // a purely local draft edit like in create mode) - resync from the fresh
  // `fund` prop every time the parent refetches it after one of those calls,
  // otherwise this local state goes stale (e.g. still showing a removed
  // constituent, or pre-rebalance weights). `fund` stays a stable `null` for
  // the entire lifetime of a create-mode form, so this never fires there.
  useEffect(() => {
    setConstituents(fund?.constituents ?? []);
  }, [fund]);
  const [warriors, setWarriors] = useState<AdminWarriorRow[]>([]);
  const [pickerWarriorId, setPickerWarriorId] = useState<number | "">("");
  const [pickerStockCount, setPickerStockCount] = useState("1");

  const [stats, setStats] = useState<FundStatsView | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminWarriors()
      .then(setWarriors)
      .catch(() => {});
  }, []);

  const gainMultiplierNum = Number(gainMultiplier);
  const lossMultiplierNum = Number(lossMultiplier);

  // Live volatility/yield preview - recomputed from whatever constituents
  // are currently in the form (draft or saved), debounced so every keystroke
  // doesn't fire a request. Works identically pre- or post-save since the
  // server derives it purely from constituent price history, not the fund's
  // own trade history (see fundStats.ts).
  useEffect(() => {
    if (constituents.length === 0 || !Number.isFinite(gainMultiplierNum) || !Number.isFinite(lossMultiplierNum)) {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    const timer = setTimeout(() => {
      estimateFundStats(
        constituents.map((c) => ({ playerName: c.playerName, server: c.server, stockCount: c.stockCount })),
        gainMultiplierNum,
        lossMultiplierNum,
      )
        .then(setStats)
        .catch(() => setStats(null))
        .finally(() => setStatsLoading(false));
    }, ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constituents, gainMultiplierNum, lossMultiplierNum]);

  const availableWarriors = useMemo(() => {
    const used = new Set(constituents.map((c) => c.warriorId));
    return warriors.filter((w) => !used.has(w.id));
  }, [warriors, constituents]);

  function scalarPayload() {
    return {
      name,
      risk,
      feePct: Number(feePct) / 100,
      taxPct: Number(taxPct) / 100,
      description,
      gainMultiplier: gainMultiplierNum,
      lossMultiplier: lossMultiplierNum,
    };
  }

  async function handleSaveScalars() {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateFund(fund!.id, scalarPayload());
      } else {
        const result = await createFund({ ...scalarPayload(), constituents });
        if (result.skippedConstituents.length > 0) {
          setError(
            `Fund created, but these constituents weren't found and were skipped: ${result.skippedConstituents
              .map((c) => `${c.playerName} (${c.server})`)
              .join(", ")}`,
          );
        }
      }
      onSaved();
      if (!isEdit) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddConstituent() {
    if (pickerWarriorId === "") return;
    const warrior = warriors.find((w) => w.id === pickerWarriorId);
    if (!warrior) return;
    const stockCount = Number(pickerStockCount);
    if (!Number.isFinite(stockCount) || stockCount <= 0) {
      setError("Stock count must be a positive number");
      return;
    }

    if (isEdit) {
      setSaving(true);
      setError(null);
      try {
        await addFundConstituent(fund!.id, { playerName: warrior.playerName, server: warrior.server, stockCount });
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    } else {
      setConstituents((prev) => [...prev, { warriorId: warrior.id, playerName: warrior.playerName, server: warrior.server, stockCount }]);
    }
    setPickerWarriorId("");
    setPickerStockCount("1");
  }

  async function handleRemoveConstituent(c: FundConstituentView) {
    if (isEdit) {
      setSaving(true);
      setError(null);
      try {
        await removeFundConstituent(fund!.id, c.warriorId);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    } else {
      setConstituents((prev) => prev.filter((x) => x.warriorId !== c.warriorId));
    }
  }

  async function handleReweight(c: FundConstituentView, newStockCount: number) {
    if (!Number.isFinite(newStockCount) || newStockCount <= 0) return;
    if (isEdit) {
      setSaving(true);
      setError(null);
      try {
        await updateFundConstituent(fund!.id, c.warriorId, newStockCount);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    } else {
      setConstituents((prev) =>
        prev.map((x) => (x.warriorId === c.warriorId ? { ...x, stockCount: newStockCount } : x)),
      );
    }
  }

  const totalWeight = constituents.reduce((sum, c) => sum + c.stockCount, 0);

  return (
    <section className="admin-section">
      <h2 style={{ marginTop: 0 }}>{isEdit ? `Edit ${fund!.name}` : "New Fund"}</h2>

      <div className="config-grid">
        <label>
          <span className="field-label">Name (max 6 letters)</span>
          <input
            type="text"
            value={name}
            maxLength={6}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
          />
        </label>
        <label>
          <span className="field-label">Risk (1-5)</span>
          <input
            type="number"
            min={1}
            max={5}
            step={1}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </label>
        <label>
          <span className="field-label">Fee %</span>
          <input type="number" step="0.5" value={feePct} onChange={(e) => setFeePct(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Tax %</span>
          <input type="number" step="0.5" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Gain multiplier</span>
          <input type="number" step="0.1" value={gainMultiplier} onChange={(e) => setGainMultiplier(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Loss multiplier</span>
          <input type="number" step="0.1" value={lossMultiplier} onChange={(e) => setLossMultiplier(e.target.value)} />
        </label>
      </div>

      <label style={{ display: "block", marginTop: "0.75rem" }}>
        <span className="field-label">Description</span>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }} />
      </label>

      <div style={{ marginTop: "0.75rem" }}>
        <RiskBar risk={Math.min(5, Math.max(1, risk || 1))} />
      </div>

      <h3>Constituents</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Warrior</th>
              <th>Stock count</th>
              <th>% of basket</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {constituents.map((c) => (
              <tr key={c.warriorId}>
                <td>
                  {c.playerName} <span className="player-server">{c.server}</span>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    value={c.stockCount}
                    onChange={(e) => handleReweight(c, Number(e.target.value))}
                    style={{ width: "6rem" }}
                  />
                </td>
                <td>{totalWeight > 0 ? `${((c.stockCount / totalWeight) * 100).toFixed(1)}%` : "-"}</td>
                <td>
                  <button type="button" onClick={() => handleRemoveConstituent(c)} disabled={saving}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {constituents.length === 0 && (
              <tr>
                <td colSpan={4} className="subtitle">
                  No constituents yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="addcoins-row" style={{ marginTop: "0.75rem" }}>
        <select value={pickerWarriorId} onChange={(e) => setPickerWarriorId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Choose a warrior...</option>
          {availableWarriors.map((w) => (
            <option key={w.id} value={w.id}>
              {w.playerName} ({w.server})
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.1"
          value={pickerStockCount}
          onChange={(e) => setPickerStockCount(e.target.value)}
          style={{ width: "6rem" }}
        />
        <button type="button" onClick={handleAddConstituent} disabled={saving || pickerWarriorId === ""}>
          Add constituent
        </button>
      </div>

      <div className="admin-subpanel" style={{ marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>Estimated stats (admin-only)</h3>
        {statsLoading && <p className="subtitle">Calculating...</p>}
        {!statsLoading && stats === null && (
          <p className="subtitle">Insufficient constituent price history to estimate yet.</p>
        )}
        {!statsLoading && stats !== null && (
          <div className="config-grid">
            <div>
              <span className="field-label">Daily volatility</span>
              <div>{(stats.volatility * 100).toFixed(2)}%</div>
            </div>
            <div>
              <span className="field-label">Est. 7d yield</span>
              <div>{(stats.yield7d * 100).toFixed(2)}%</div>
            </div>
            <div>
              <span className="field-label">Est. 30d yield</span>
              <div>{(stats.yield30d * 100).toFixed(2)}%</div>
            </div>
            <div>
              <span className="field-label">Sample days</span>
              <div>{stats.sampleDays}</div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="status error">{error}</p>}

      <div className="card-footer">
        <button type="button" onClick={onClose}>
          {isEdit ? "Close" : "Cancel"}
        </button>
        <button type="button" className="btn-affirm" onClick={handleSaveScalars} disabled={saving || !name}>
          {isEdit ? "Save changes" : "Create fund"}
        </button>
      </div>
    </section>
  );
}
