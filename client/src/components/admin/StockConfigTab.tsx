import { useEffect, useState } from "react";
import { getStockConfig, saveStockConfig, type StockAbilityConfig, type StockConfig } from "../../api";
import { slugifyHeading } from "./DocsTab";

type ScalarKey = Exclude<keyof StockConfig, "abilities">;

type ScalarField = { key: ScalarKey; label: string; step: string; description: string };

// Grouped by which timeline in STOCKS.md each setting affects, rather than
// one flat list - a report ingest, a drift tick, and a trade each read a
// different subset of stock_config, and grouping the admin form the same
// way makes it obvious which knob affects which kind of price movement.

// Timeline 1: a raid report gets ingested (see STOCKS.md "A raid report gets ingested").
const RAID_SCORING_FIELDS: ScalarField[] = [
  { key: "damageWeight", label: "Damage weight", step: "0.05", description: "How much raw damage output affects the price" },
  { key: "castWeight", label: "Cast weight", step: "0.05", description: "How much tracked ability cast counts affect price" },
  { key: "priceSensitivity", label: "Price sensitivity", step: "0.01", description: "How strongly each raid's score moves the price" },
  { key: "startingPrice", label: "Starting price", step: "1", description: "Starting price for a player with no history" },
  { key: "damageTrendWeight", label: "Damage trend weight", step: "0.05", description: "Weight of personal DPS trend (vs. own history) within the damage score" },
  { key: "damagePeerWeight", label: "Damage peer weight", step: "0.05", description: "Weight of peer DPS ranking (vs. bucket-mates this raid) within the damage score" },
  { key: "damageTrendZClamp", label: "Damage trend z-clamp", step: "0.5", description: "Max absolute z-score for the personal DPS trend, before cold-start shrink is applied" },
  { key: "dpsEmaAlpha", label: "DPS EMA alpha", step: "0.01", description: "How fast the DPS baseline reacts to new raids" },
  { key: "coldStartReports", label: "Cold-start reports", step: "1", description: "Raids needed before damage score reaches full weight" },
  { key: "minBucketSize", label: "Min bucket size", step: "1", description: "Minimum peers required to rank a cast count" },
  { key: "tankTopN", label: "Tank top N", step: "1", description: "Max warriors classified as tanks per raid" },
  { key: "tankMinUptimePct", label: "Tank min uptime %", step: "0.01", description: "Min damage-taken uptime to be classified as tank" },
  { key: "newPlayerGraceReports", label: "New-player grace reports", step: "1", description: "Raids in a zone during which a new player's cast penalties are softened" },
  { key: "newPlayerPenaltyLeniency", label: "New-player penalty leniency", step: "0.05", description: "Fraction of a negative cast score still applied during the grace period (0 = fully forgiven, 1 = no leniency)" },
  { key: "minAttendancePct", label: "Min attendance %", step: "0.05", description: "Active-time ratio (vs. the raid's top attendee) below which a report is excluded from affecting price" },
];

// Timeline 2: an idle drift tick fires (see STOCKS.md "An idle drift tick fires").
const DRIFT_FIELDS: ScalarField[] = [
  { key: "driftIntervalMs", label: "Drift interval (ms)", step: "60000", description: "How often idle price drift ticks between raids - takes effect on the next tick, no restart needed" },
  { key: "driftMaxPct", label: "Drift max %", step: "0.001", description: "Largest fraction a single normal drift tick can move a price, in either direction" },
  { key: "driftReversionStrength", label: "Drift reversion strength", step: "0.05", description: "How strongly drift pulls a price back toward its trading anchor (0 = no pull, 1 = fully anchored)" },
  { key: "demandAnchorDecayPct", label: "Demand anchor decay %", step: "0.01", description: "Fraction of the gap between a warrior's trading anchor and their raid anchor that closes every drift tick - how fast a demand-driven pump fades without sustained buying" },
  { key: "marketGravityStrength", label: "Market gravity strength", step: "0.01", description: "How strongly every price is pulled toward the current market-wide average each drift tick - keeps the whole market from drifting up (or down) together" },
  { key: "swingChancePct", label: "Swing chance %", step: "0.005", description: "Per-warrior, per-tick odds of a large overnight swing that bypasses the normal drift cap. 0 disables it" },
  { key: "swingUpMagnitudePct", label: "Swing up magnitude %", step: "0.01", description: "Base size of an overnight swing to the upside" },
  { key: "swingDownMagnitudePct", label: "Swing down magnitude %", step: "0.01", description: "Base size of an overnight swing to the downside" },
  { key: "swingMagnitudeFuzzPct", label: "Swing magnitude fuzz %", step: "0.005", description: "Random +/- range applied around the base swing magnitude" },
  { key: "swingCooldownGapPct", label: "Swing cooldown gap %", step: "0.01", description: "How far a price must already be displaced from its anchor (in a swing's direction) before another same-direction swing gets blocked" },
];

// Timeline 3: a trade executes (see STOCKS.md "A trade executes").
const TRADE_FIELDS: ScalarField[] = [
  { key: "demandMaxPctPerTrade", label: "Demand max % per trade", step: "0.001", description: "Largest fraction a single trade's buy/sell pressure can move a price, in either direction" },
  { key: "demandLiquidityDenominator", label: "Demand liquidity denominator", step: "1000", description: "Coin amount that produces ~1% price impact - smaller means the market is more sensitive to trading" },
  { key: "tradeFeePct", label: "Trade fee %", step: "0.0005", description: "Fee taken on every buy and sell - makes round-trip wash-trading a guaranteed loss" },
];

const BUCKETS = ["all", "dps", "tank"];

export function StockConfigTab({ onNavigateToDocs }: { onNavigateToDocs: (anchor: string) => void }) {
  const [scalars, setScalars] = useState<Record<ScalarKey, number> | null>(null);
  const [abilities, setAbilities] = useState<StockAbilityConfig[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    getStockConfig()
      .then((config) => {
        const { abilities: loadedAbilities, ...loadedScalars } = config;
        setScalars(loadedScalars);
        setAbilities(loadedAbilities.map((a) => ({ ...a })));
      })
      .catch(() => {});
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

  // `intro` is the sentence fragment before the doc link, `docsHeading` is
  // the literal STOCKS.md heading text this group corresponds to - slugified
  // the same way DocsTab tags each rendered heading with an id, so the link
  // lands on the right section.
  function renderFieldGroup(title: string, intro: string, docsHeading: string, fields: ScalarField[]) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          {intro} See{" "}
          <button type="button" className="docs-link-button" onClick={() => onNavigateToDocs(slugifyHeading(docsHeading))}>
            "{docsHeading}"
          </button>{" "}
          in the docs.
        </p>
        <div className="config-grid">
          {scalars &&
            fields.map((field) => (
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
        <div className="card-footer">
          {status && <span className={`status ${status.kind}`}>{status.text}</span>}
          <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving}>
            Save changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {renderFieldGroup(
        "Raid scoring",
        "Applied when a raid report is ingested - scores the raid and updates the price.",
        "Timeline 1: A raid report gets ingested",
        RAID_SCORING_FIELDS,
      )}

      {renderFieldGroup(
        "Idle drift",
        "Applied on a timer between raids - small routine nudges plus rare overnight swings.",
        "Timeline 2: An idle drift tick fires",
        DRIFT_FIELDS,
      )}

      {renderFieldGroup(
        "Trading & demand",
        "Applied the instant someone buys or sells.",
        "Timeline 3: A trade executes",
        TRADE_FIELDS,
      )}

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
        <div className="card-footer space-between">
          <button type="button" onClick={addAbility}>
            Add ability
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {status && <span className={`status ${status.kind}`}>{status.text}</span>}
            <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
