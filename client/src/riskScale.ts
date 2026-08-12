// Fund risk score (1-5), stored as a plain integer in the DB - all
// label/color logic lives here, client-side only, so it can be re-skinned
// later without a migration (see funds.md REVISIONS).
export interface RiskLevel {
  label: string;
  cssVar: string;
}

export const RISK_LEVELS: Record<number, RiskLevel> = {
  1: { label: "Low", cssVar: "--risk-1" },
  2: { label: "Below Average", cssVar: "--risk-2" },
  3: { label: "Average", cssVar: "--risk-3" },
  4: { label: "Above Average", cssVar: "--risk-4" },
  5: { label: "High", cssVar: "--risk-5" },
};

export function riskLabel(risk: number): string {
  return RISK_LEVELS[risk]?.label ?? `Risk ${risk}`;
}
