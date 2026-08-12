import { riskLabel } from "../riskScale";

// Small CSS-only segmented bar: `risk` (1-5) of the 5 segments are filled,
// all in the same fixed color for that risk value (see riskScale.ts /
// funds.md REVISIONS - the color comes from `[data-risk="N"]` CSS rules in
// styles.css, not computed here).
export function RiskBar({ risk, showLabel = true }: { risk: number; showLabel?: boolean }) {
  return (
    <span className="risk-bar-wrap">
      <span className="risk-bar" data-risk={risk}>
        {[1, 2, 3, 4, 5].map((segment) => (
          <span key={segment} className={segment <= risk ? "risk-segment filled" : "risk-segment"} />
        ))}
      </span>
      {showLabel && <span className="risk-bar-label">{riskLabel(risk)}</span>}
    </span>
  );
}
