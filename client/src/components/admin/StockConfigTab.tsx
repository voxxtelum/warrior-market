import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPriceDistribution,
  getStockConfig,
  saveStockConfig,
  type StockAbilityConfig,
  type StockConfig,
  type TankTopNZoneConfig,
} from "../../api";
import {
  exponentialConvergence,
  fmtConvergenceDuration,
  percentileValue,
  reversionConvergence,
  reversionStrengthForRaidCount,
  sideACurveMultipliers,
} from "../../convergence";
import { slugifyHeading } from "../../docsMarkdown";

const STATUS_VISIBLE_MS = 3000;
const STATUS_FADE_MS = 1000;

type ScalarKey = Exclude<keyof StockConfig, "abilities" | "tankTopNByZone">;

type ScalarField = { key: ScalarKey; label: string; step: string; description: string };

function scalarsEqual(a: Record<ScalarKey, number>, b: Record<ScalarKey, number>): boolean {
  return (Object.keys(a) as ScalarKey[]).every((k) => a[k] === b[k]);
}

// "YY-MM-DD-HHMMSS", local time - precise enough that exporting twice in a
// row (e.g. before/after a tweak, to compare) never collides on filename.
function fmtExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = pad(date.getFullYear() % 100);
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yy}-${mm}-${dd}-${hh}${min}${ss}`;
}

function abilitiesEqual(a: StockAbilityConfig[], b: StockAbilityConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (ability, i) =>
      ability.id === b[i].id &&
      ability.name === b[i].name &&
      ability.weight === b[i].weight &&
      ability.bucket === b[i].bucket,
  );
}

function tankTopNByZoneEqual(a: TankTopNZoneConfig[], b: TankTopNZoneConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((z, i) => z.zone === b[i].zone && z.topN === b[i].topN);
}

// Grouped by which timeline in STOCKS.md each setting affects, rather than
// one flat list - a report ingest, a drift tick, and a trade each read a
// different subset of stock_config, and grouping the admin form the same
// way makes it obvious which knob affects which kind of price movement.

// Timeline 1: a raid report gets ingested (see STOCKS.md "A raid report gets ingested").
const RAID_SCORING_FIELDS: ScalarField[] = [
  { key: "damageWeight", label: "Damage weight", step: "0.05", description: "How much raw damage output affects the price" },
  { key: "castWeight", label: "Cast weight", step: "0.05", description: "How much tracked ability cast counts affect price" },
  { key: "pricePerScorePointUp", label: "Price per score point (up)", step: "0.5", description: "Flat dollar amount the price moves per 1.0 of a positive report score, regardless of current price - scaled by the price curve below based on current price percentile" },
  { key: "pricePerScorePointDown", label: "Price per score point (down)", step: "0.5", description: "Flat dollar amount the price moves per 1.0 of a negative report score, regardless of current price - scaled by the price curve below based on current price percentile" },
  { key: "priceCurveCenterPercentile", label: "Price curve center percentile", step: "0.01", description: "Price percentile (0-1) where the gain/loss multiplier is exactly 1.0 (unchanged from the flat rate above). Below it, gains are boosted and losses cushioned; above it, the reverse - see the preview table below" },
  { key: "priceCurveSteepness", label: "Price curve steepness", step: "1", description: "How sharply the multiplier transitions across the center percentile - higher means only warriors very close to the top/bottom of the field are affected" },
  { key: "priceCurveGainAmplitude", label: "Price curve gain amplitude", step: "0.05", description: "Max amount gains are suppressed above the center percentile (0.6 = as low as 0.4x at the extreme)" },
  { key: "priceCurveLossAmplitude", label: "Price curve loss amplitude", step: "0.05", description: "Max amount losses are amplified above the center percentile (0.9 = as high as 1.9x at the extreme)" },
  { key: "startingPrice", label: "Starting price", step: "1", description: "Starting price for a player with no history" },
  { key: "damageTrendWeight", label: "Damage trend weight", step: "0.05", description: "Weight of personal DPS trend (vs. own history) within the damage score" },
  { key: "damagePeerWeight", label: "Damage peer weight", step: "0.05", description: "Weight of peer DPS ranking (vs. bucket-mates this raid) within the damage score" },
  { key: "damageTrendZClampUp", label: "Damage trend z-clamp (up)", step: "0.5", description: "Max positive z-score for the personal DPS trend (good nights), before cold-start shrink is applied" },
  { key: "damageTrendZClampDown", label: "Damage trend z-clamp (down)", step: "0.5", description: "Max negative z-score for the personal DPS trend (bad nights), before cold-start shrink is applied" },
  { key: "dpsEmaAlpha", label: "DPS EMA alpha", step: "0.01", description: "How fast the DPS baseline reacts to new raids" },
  { key: "coldStartReports", label: "Cold-start reports", step: "1", description: "Raids needed before damage score reaches full weight" },
  { key: "minBucketSize", label: "Min bucket size", step: "1", description: "Minimum peers required to rank a cast count" },
  { key: "tankTopN", label: "Tank top N (default)", step: "1", description: "Max warriors classified as tanks per raid, for any zone not listed in the per-zone table below" },
  { key: "newPlayerGraceReports", label: "New-player grace reports", step: "1", description: "Raids in a zone during which a new player's cast penalties are softened" },
  { key: "newPlayerPenaltyLeniency", label: "New-player penalty leniency", step: "0.05", description: "Fraction of a negative cast score still applied during the grace period (0 = fully forgiven, 1 = no leniency)" },
  { key: "minAttendancePct", label: "Min attendance %", step: "0.05", description: "Active-time ratio (vs. the raid's top attendee) below which a report is excluded from affecting price" },
];

// Timeline 2: an idle drift tick fires (see STOCKS.md "An idle drift tick fires").
const DRIFT_FIELDS: ScalarField[] = [
  { key: "driftIntervalMs", label: "Drift interval (ms)", step: "60000", description: "How often idle price drift ticks between raids - takes effect on the next tick, no restart needed" },
  { key: "fundValuationIntervalMs", label: "Fund valuation interval (ms)", step: "60000", description: "How often fund NAVs recompute from their constituent warriors - takes effect on the next tick, no restart needed" },
  { key: "driftMaxPct", label: "Drift max %", step: "0.001", description: "Largest fraction a single normal drift tick can move a price, in either direction - the hard cap on the total move (reversion + gravity + noise combined)" },
  { key: "driftNoisePct", label: "Drift noise %", step: "0.001", description: "Amplitude of just the random component of a normal drift tick, independent of the overall cap above - set lower than Drift max % to make idle price action calmer without limiting how far reversion/gravity can move things when a real gap exists" },
  { key: "reversionNewPlayerHours", label: "Reversion: new player hours", step: "1", description: "Hours for a brand-new warrior's (0 raids) price to close 90% of its gap to the trading anchor" },
  { key: "reversionVeteranHours", label: "Reversion: veteran hours", step: "1", description: "Hours for a fully-settled warrior's price to close 90% of its gap to the trading anchor" },
  { key: "reversionSettleRaids", label: "Reversion: settle raids", step: "1", description: "Raid count scale of the transition from the new-player speed above to the veteran speed - roughly how many raids it takes to feel 'established'" },
  { key: "demandAnchorDecayPct", label: "Demand anchor decay %", step: "0.01", description: "Fraction of the gap between a warrior's trading anchor and their raid anchor that closes every drift tick - how fast a demand-driven pump fades without sustained buying" },
  { key: "marketGravityStrength", label: "Market gravity strength", step: "0.01", description: "How strongly every price is pulled toward the current market-wide average each drift tick - keeps the whole market from drifting up (or down) together" },
  { key: "swingChancePct", label: "Swing chance %", step: "0.005", description: "Per-warrior, per-tick odds of a large overnight swing that bypasses the normal drift cap. 0 disables it" },
  { key: "swingUpMagnitude", label: "Swing up magnitude ($)", step: "1", description: "Flat dollar size of an overnight swing to the upside, regardless of current price" },
  { key: "swingDownMagnitude", label: "Swing down magnitude ($)", step: "1", description: "Flat dollar size of an overnight swing to the downside, regardless of current price" },
  { key: "swingMagnitudeFuzz", label: "Swing magnitude fuzz ($)", step: "0.5", description: "Flat dollar +/- range applied around the base swing magnitude" },
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
  const [tankTopNByZone, setTankTopNByZone] = useState<TankTopNZoneConfig[] | null>(null);
  const [savedScalars, setSavedScalars] = useState<Record<ScalarKey, number> | null>(null);
  const [savedAbilities, setSavedAbilities] = useState<StockAbilityConfig[] | null>(null);
  const [savedTankTopNByZone, setSavedTankTopNByZone] = useState<TankTopNZoneConfig[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [statusFading, setStatusFading] = useState(false);
  // Sorted, ascending - the live field's current tradable prices, fetched
  // once on mount. Powers the Side A curve preview below; deliberately not
  // re-fetched on every edit, since it's what "current prices" means -
  // tweaking the curve shouldn't also move the distribution it's being
  // compared against.
  const [priceDistribution, setPriceDistribution] = useState<number[] | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStockConfig()
      .then((config) => {
        const { abilities: loadedAbilities, tankTopNByZone: loadedTankTopNByZone, ...loadedScalars } = config;
        setScalars(loadedScalars);
        setAbilities(loadedAbilities.map((a) => ({ ...a })));
        setTankTopNByZone(loadedTankTopNByZone.map((z) => ({ ...z })));
        setSavedScalars(loadedScalars);
        setSavedAbilities(loadedAbilities.map((a) => ({ ...a })));
        setSavedTankTopNByZone(loadedTankTopNByZone.map((z) => ({ ...z })));
      })
      .catch(() => {});
    getPriceDistribution()
      .then(setPriceDistribution)
      .catch(() => {});
  }, []);

  // Status text auto-dismisses instead of lingering until the next save:
  // shown plainly for STATUS_VISIBLE_MS, then fades out (via the "fading"
  // class/CSS transition) over STATUS_FADE_MS before being cleared.
  useEffect(() => {
    if (!status) return;
    setStatusFading(false);
    const fadeTimer = setTimeout(() => setStatusFading(true), STATUS_VISIBLE_MS);
    const clearTimer = setTimeout(() => setStatus(null), STATUS_VISIBLE_MS + STATUS_FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(clearTimer);
    };
  }, [status]);

  const dirty = useMemo(() => {
    if (!scalars || !abilities || !tankTopNByZone || !savedScalars || !savedAbilities || !savedTankTopNByZone) return false;
    return (
      !scalarsEqual(scalars, savedScalars) ||
      !abilitiesEqual(abilities, savedAbilities) ||
      !tankTopNByZoneEqual(tankTopNByZone, savedTankTopNByZone)
    );
  }, [scalars, abilities, tankTopNByZone, savedScalars, savedAbilities, savedTankTopNByZone]);

  // Live off the draft `scalars` (not savedScalars) so this updates as the
  // admin edits fields, before saving - the whole point is not having to
  // save-and-reload (or simulate) to see what a setting change would do.
  const convergence = useMemo(() => {
    if (!scalars) return null;
    return {
      demandDecay: exponentialConvergence(scalars.demandAnchorDecayPct, scalars.driftIntervalMs),
      marketGravity: exponentialConvergence(scalars.marketGravityStrength, scalars.driftIntervalMs),
    };
  }, [scalars]);

  // Reversion strength is no longer one flat number - it's derived from
  // raid count (see reversionStrengthForRaidCount) - so instead of a
  // single convergence row, show a few illustrative points along that
  // curve: a brand-new warrior, one right at the "settle raids" scale, and
  // a comfortably veteran one.
  const reversionBreakpoints = useMemo(() => {
    if (!scalars) return null;
    const points = [
      { label: "New player (0 raids)", raidCount: 0 },
      { label: `Settling (${scalars.reversionSettleRaids} raids)`, raidCount: scalars.reversionSettleRaids },
      { label: "Veteran (settled)", raidCount: scalars.reversionSettleRaids * 4 },
    ];
    return points.map(({ label, raidCount }) => {
      const strength = reversionStrengthForRaidCount(
        raidCount,
        scalars.reversionNewPlayerHours,
        scalars.reversionVeteranHours,
        scalars.reversionSettleRaids,
        scalars.driftIntervalMs,
      );
      return { label, estimate: reversionConvergence(strength, scalars.driftMaxPct, scalars.driftIntervalMs) };
    });
  }, [scalars]);

  // Side A curve preview: for a handful of percentile breakpoints (plus
  // wherever the admin has the center currently set), show the resulting
  // gain/loss multiplier and what price that percentile actually
  // corresponds to in the live field today - so the curve can be
  // sanity-checked and re-tuned without needing to know which specific
  // warrior sits where.
  const sideACurvePreview = useMemo(() => {
    if (!scalars) return null;
    const center = Math.min(1, Math.max(0, scalars.priceCurveCenterPercentile));
    const breakpoints = Array.from(new Set([0, 0.1, 0.25, 0.5, 0.75, center, 0.9, 0.95, 1])).sort((a, b) => a - b);
    return breakpoints.map((percentile) => ({
      percentile,
      isCenter: percentile === center,
      price: priceDistribution ? percentileValue(priceDistribution, percentile) : null,
      ...sideACurveMultipliers(
        percentile,
        scalars.priceCurveCenterPercentile,
        scalars.priceCurveSteepness,
        scalars.priceCurveGainAmplitude,
        scalars.priceCurveLossAmplitude,
      ),
    }));
  }, [scalars, priceDistribution]);

  function updateAbility<K extends keyof StockAbilityConfig>(index: number, key: K, value: StockAbilityConfig[K]) {
    setAbilities((prev) => prev?.map((a, i) => (i === index ? { ...a, [key]: value } : a)) ?? null);
  }

  function removeAbility(index: number) {
    setAbilities((prev) => prev?.filter((_, i) => i !== index) ?? null);
  }

  function addAbility() {
    setAbilities((prev) => [...(prev ?? []), { id: 0, name: "", weight: 1, bucket: "all" }]);
  }

  function updateTankZone<K extends keyof TankTopNZoneConfig>(index: number, key: K, value: TankTopNZoneConfig[K]) {
    setTankTopNByZone((prev) => prev?.map((z, i) => (i === index ? { ...z, [key]: value } : z)) ?? null);
  }

  function removeTankZone(index: number) {
    setTankTopNByZone((prev) => prev?.filter((_, i) => i !== index) ?? null);
  }

  function addTankZone() {
    setTankTopNByZone((prev) => [...(prev ?? []), { zone: "", topN: 1 }]);
  }

  // Exports whatever's currently in the form (including unsaved edits) -
  // not just the last-saved config - since "back up what I'm looking at
  // right now" is the more useful default, and it matches what Import
  // hands back: the same { scalars..., abilities, tankTopNByZone } shape
  // round-trips losslessly.
  function handleExport() {
    if (!scalars || !abilities || !tankTopNByZone) return;
    const json = JSON.stringify({ ...scalars, abilities, tankTopNByZone }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-config-${fmtExportTimestamp(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Lands as an unsaved draft, same as hand-editing fields - merges onto
  // the current scalars rather than replacing wholesale, so an older
  // export missing newer keys (or a hand-edited partial file) doesn't blow
  // away everything else, and only keys that are actually numbers get
  // applied. Nothing is persisted until "Save changes" is clicked, which
  // runs the same server-side validation as any manual edit.
  async function handleImportFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") throw new Error("File doesn't contain a JSON object");
      const { abilities: importedAbilities, tankTopNByZone: importedTankTopNByZone, ...importedScalars } = parsed;
      setScalars((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        for (const [key, value] of Object.entries(importedScalars)) {
          if (typeof value === "number" && key in next) next[key as ScalarKey] = value;
        }
        return next;
      });
      if (Array.isArray(importedAbilities)) {
        setAbilities(importedAbilities.map((a) => ({ ...a })));
      }
      if (Array.isArray(importedTankTopNByZone)) {
        setTankTopNByZone(importedTankTopNByZone.map((z) => ({ ...z })));
      }
      setStatus({ text: 'Imported as a draft - review below, then click "Save changes" to apply.', kind: "success" });
    } catch (err) {
      setStatus({ text: `Import failed: ${err instanceof Error ? err.message : String(err)}`, kind: "error" });
    }
  }

  async function handleSave() {
    if (!scalars || !abilities || !tankTopNByZone) return;
    setSaving(true);
    setStatus(null);
    try {
      await saveStockConfig({ ...scalars, abilities, tankTopNByZone });
      setSavedScalars(scalars);
      setSavedAbilities(abilities.map((a) => ({ ...a })));
      setSavedTankTopNByZone(tankTopNByZone.map((z) => ({ ...z })));
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
          <button type="button" className="text-link text-link-accent" onClick={() => onNavigateToDocs(slugifyHeading(docsHeading))}>
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
          {status && (
            <span className={`status ${status.kind}${statusFading ? " fading" : ""}`}>{status.text}</span>
          )}
          <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || !dirty}>
            Save changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Export / import config</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Export downloads the entire config below (including any unsaved edits) as a JSON file. Import loads a file
          back in as an unsaved draft - review it below and click "Save changes" to apply, same as editing fields by
          hand.
        </p>
        <div className="card-footer">
          {status && (
            <span className={`status ${status.kind}${statusFading ? " fading" : ""}`}>{status.text}</span>
          )}
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
          <button type="button" onClick={() => importInputRef.current?.click()} disabled={!scalars || !abilities || !tankTopNByZone}>
            Import config
          </button>
          <button type="button" onClick={handleExport} disabled={!scalars || !abilities || !tankTopNByZone}>
            Export config
          </button>
        </div>
      </div>

      {renderFieldGroup(
        "Raid scoring",
        "Applied when a raid report is ingested - scores the raid and updates the price.",
        "Timeline 1: A raid report gets ingested",
        RAID_SCORING_FIELDS,
      )}

      {sideACurvePreview && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Price curve preview</h2>
          <p className="subtitle" style={{ marginBottom: "1rem" }}>
            How the gain/loss multiplier above varies by current price percentile, computed live from the fields -
            not who's at each percentile, just the shape of the curve and what it's worth in dollars against the
            field's real prices today. Updates instantly as you edit a field, before saving.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Percentile</th>
                  <th>Price today</th>
                  <th>Gain multiplier</th>
                  <th>Loss multiplier</th>
                </tr>
              </thead>
              <tbody>
                {sideACurvePreview.map((row) => (
                  <tr key={row.percentile}>
                    <td>
                      {(row.percentile * 100).toFixed(0)}%{row.isCenter ? " (center)" : ""}
                    </td>
                    <td>{row.price !== null ? `$${row.price.toFixed(0)}` : "—"}</td>
                    <td>{row.gain.toFixed(2)}x</td>
                    <td>{row.loss.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtitle" style={{ marginBottom: 0, marginTop: "1rem" }}>
            "Price today" is interpolated from the live field's current tradable prices, fetched once when this page
            loaded - it won't move as you edit the curve fields, since it's what the curve is being compared against,
            not a result of it.
          </p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Tank identification by zone</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Each raid report, the top N warriors by raw total damage taken are classified as tanks - no other filter.
          N is looked up here by the report's zone name (must match exactly); zones not listed fall back to "Tank top
          N (default)" above.
        </p>
        <div className="table-scroll">
          <table id="tank-zone-config-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Top N</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tankTopNByZone?.map((z, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" value={z.zone} onChange={(e) => updateTankZone(i, "zone", e.target.value)} />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="1"
                      value={z.topN}
                      onChange={(e) => updateTankZone(i, "topN", Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => removeTankZone(i)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-footer space-between">
          <button type="button" onClick={addTankZone}>
            Add zone
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {status && (
              <span className={`status ${status.kind}${statusFading ? " fading" : ""}`}>{status.text}</span>
            )}
            <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || !dirty}>
              Save changes
            </button>
          </div>
        </div>
      </div>

      {renderFieldGroup(
        "Idle drift",
        "Applied on a timer between raids - small routine nudges plus rare overnight swings.",
        "Timeline 2: An idle drift tick fires",
        DRIFT_FIELDS,
      )}

      {convergence && reversionBreakpoints && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Convergence estimates</h2>
          <p className="subtitle" style={{ marginBottom: "1rem" }}>
            How long it takes a price gap to close under the idle-drift settings above, computed live from the
            values in the fields - not simulated, exact math for the first two rows. Updates instantly as you edit a
            field, before saving.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mechanism</th>
                  <th>Pulls toward</th>
                  <th>Half-life</th>
                  <th>~90% closed</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Demand anchor decay</td>
                  <td>this warrior's own raid anchor</td>
                  <td>{fmtConvergenceDuration(convergence.demandDecay.halfLifeMs)}</td>
                  <td>{fmtConvergenceDuration(convergence.demandDecay.ninetyPctMs)}</td>
                </tr>
                <tr>
                  <td>Market gravity</td>
                  <td>the whole-market average</td>
                  <td>{fmtConvergenceDuration(convergence.marketGravity.halfLifeMs)}</td>
                  <td>{fmtConvergenceDuration(convergence.marketGravity.ninetyPctMs)}</td>
                </tr>
                {reversionBreakpoints.map((bp) => (
                  <tr key={bp.label}>
                    <td>Drift reversion - {bp.label}</td>
                    <td>this warrior's trading anchor</td>
                    <td>{fmtConvergenceDuration(bp.estimate.halfLifeMs)}</td>
                    <td>{fmtConvergenceDuration(bp.estimate.ninetyPctMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtitle" style={{ marginBottom: 0, marginTop: "1rem" }}>
            Demand anchor decay and market gravity are exact - they're never capped by "Drift max %". Drift reversion
            is capped by it for any gap bigger than "Drift max %" / that raid-count's derived reversion strength, so
            it has no clean percentage-based curve like the other two - each row above walks it tick-by-tick starting
            from a representative 20% gap instead, at the reversion speed for that many lifetime raids (see the
            reversion fields above - reversion speed is no longer one flat number, it depends on how many raids a
            warrior has been in). None of these account for random noise or swing events, which add variance around
            the trend but don't change it.
          </p>
        </div>
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
            {status && (
              <span className={`status ${status.kind}${statusFading ? " fading" : ""}`}>{status.text}</span>
            )}
            <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || !dirty}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
