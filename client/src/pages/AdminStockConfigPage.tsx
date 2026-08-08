import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { getStockConfig, saveStockConfig, type StockAbilityConfig, type StockConfig } from "../api";

type ScalarKey = Exclude<keyof StockConfig, "abilities">;

const SCALAR_FIELDS: { key: ScalarKey; label: string; step: string; description: string }[] = [
  { key: "damageWeight", label: "Damage weight", step: "0.05", description: "How much raw damage output affects the price" },
  { key: "castWeight", label: "Cast weight", step: "0.05", description: "How much tracked ability cast counts affect price" },
  { key: "priceSensitivity", label: "Price sensitivity", step: "0.01", description: "How strongly each raid's score moves the price" },
  { key: "startingPrice", label: "Starting price", step: "1", description: "Starting price for a player with no history" },
  { key: "dpsEmaAlpha", label: "DPS EMA alpha", step: "0.01", description: "How fast the DPS baseline reacts to new raids" },
  { key: "coldStartReports", label: "Cold-start reports", step: "1", description: "Raids needed before damage score reaches full weight" },
  { key: "minBucketSize", label: "Min bucket size", step: "1", description: "Minimum peers required to rank a cast count" },
  { key: "tankTopN", label: "Tank top N", step: "1", description: "Max warriors classified as tanks per raid" },
  { key: "tankMinUptimePct", label: "Tank min uptime %", step: "0.01", description: "Min damage-taken uptime to be classified as tank" },
  { key: "newPlayerGraceReports", label: "New-player grace reports", step: "1", description: "Raids in a zone during which a new player's cast penalties are softened" },
  { key: "newPlayerPenaltyLeniency", label: "New-player penalty leniency", step: "0.05", description: "Fraction of a negative cast score still applied during the grace period (0 = fully forgiven, 1 = no leniency)" },
  { key: "minAttendancePct", label: "Min attendance %", step: "0.05", description: "Active-time ratio (vs. the raid's top attendee) below which a report is excluded from affecting price" },
  { key: "damageTrendWeight", label: "Damage trend weight", step: "0.05", description: "Weight of personal DPS trend (vs. own history) within the damage score" },
  { key: "damagePeerWeight", label: "Damage peer weight", step: "0.05", description: "Weight of peer DPS ranking (vs. bucket-mates this raid) within the damage score" },
  { key: "damageTrendZClamp", label: "Damage trend z-clamp", step: "0.5", description: "Max absolute z-score for the personal DPS trend, before cold-start shrink is applied" },
  { key: "driftIntervalMs", label: "Drift interval (ms)", step: "60000", description: "How often idle price drift ticks between raids - takes effect on the next tick, no restart needed" },
  { key: "driftMaxPct", label: "Drift max %", step: "0.001", description: "Largest fraction a single drift tick can move a price, in either direction" },
  { key: "driftReversionStrength", label: "Drift reversion strength", step: "0.05", description: "How strongly drift pulls a price back toward its last raid-anchored value (0 = no pull, 1 = fully anchored)" },
];

const BUCKETS = ["all", "dps", "tank"];

export function AdminStockConfigPage() {
  const [scalars, setScalars] = useState<Record<ScalarKey, number> | null>(null);
  const [abilities, setAbilities] = useState<StockAbilityConfig[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    getStockConfig().then((config) => {
      const { abilities: loadedAbilities, ...loadedScalars } = config;
      setScalars(loadedScalars);
      setAbilities(loadedAbilities.map((a) => ({ ...a })));
    });
  }, []);

  function updateAbility<K extends keyof StockAbilityConfig>(index: number, key: K, value: StockAbilityConfig[K]) {
    setAbilities((prev) => prev?.map((a, i) => (i === index ? { ...a, [key]: value } : a)) ?? null);
  }

  function removeAbility(index: number) {
    setAbilities((prev) => prev?.filter((_, i) => i !== index) ?? null);
  }

  function addAbility() {
    setAbilities((prev) => [...(prev ?? []), { id: 0, name: "", weight: 1, bucket: "all" }]);
  }

  async function handleSave() {
    if (!scalars || !abilities) return;
    setSaving(true);
    setStatus(null);
    try {
      await saveStockConfig({ ...scalars, abilities });
      setStatus({ text: "Saved. Changes apply immediately, no restart needed.", kind: "success" });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Scoring settings</h2>
        <div className="config-grid">
          {scalars &&
            SCALAR_FIELDS.map((field) => (
              <label key={field.key}>
                <span className="field-label" title={field.description}>
                  {field.label}
                </span>
                <input
                  type="number"
                  step={field.step}
                  value={scalars[field.key]}
                  onChange={(e) => setScalars((prev) => (prev ? { ...prev, [field.key]: Number(e.target.value) } : prev))}
                />
              </label>
            ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Tracked abilities</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Weight and bucket used when scoring cast counts. Bucket "all" compares against everyone; "dps" or "tank"
          compares only within that role.
        </p>
        <div className="table-scroll">
          <table id="ability-config-table">
            <thead>
              <tr>
                <th>Ability ID</th>
                <th>Name</th>
                <th>Weight</th>
                <th>Bucket</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {abilities?.map((ability, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      value={ability.id}
                      onChange={(e) => updateAbility(i, "id", Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input type="text" value={ability.name} onChange={(e) => updateAbility(i, "name", e.target.value)} />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      value={ability.weight}
                      onChange={(e) => updateAbility(i, "weight", Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <select value={ability.bucket} onChange={(e) => updateAbility(i, "bucket", e.target.value)}>
                      {BUCKETS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" onClick={() => removeAbility(i)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" style={{ marginTop: "1rem" }} onClick={addAbility}>
          Add ability
        </button>
      </div>

      <div className="card">
        <button type="button" onClick={handleSave} disabled={saving}>
          Save changes
        </button>
        {status && <span className={`status ${status.kind}`}>{status.text}</span>}
      </div>
    </AdminLayout>
  );
}
