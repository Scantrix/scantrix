import type { Finding } from "./scanner";

export interface RiskResult {
  grade: string;
  level: string;
  description: string;
  riskScore: number;
}

function severityScore(sev: "low" | "medium" | "high"): number {
  return sev === "high" ? 3 : sev === "medium" ? 2 : 1;
}

/**
 * Convert raw risk points (unbounded, higher = worse) to a 0–100 health score
 * (higher = better) using exponential decay.
 *
 * Examples:
 *   0 risk points → 100 (perfect)
 *   20 risk points → 78
 *   50 risk points → 54
 *   85 risk points → 35
 *   120 risk points → 22
 *   164 risk points → 13
 */
export function riskPointsToHealthScore(riskPoints: number): number {
  return Math.round(100 * Math.exp(-riskPoints / 80));
}

/**
 * Map a 0–100 health score to a letter grade and human-readable level.
 * Higher score = better grade.
 *
 * Default thresholds: A (≥80), B (≥50), C (≥30), D (≥15), F (<15)
 */
export function gradeFromHealthScore(
  score: number,
  thresholds?: { gradeA: number; gradeB: number; gradeC: number },
): { grade: string; level: string; description: string } {
  const t = thresholds ?? { gradeA: 80, gradeB: 50, gradeC: 30 };
  if (score >= t.gradeA) return { grade: "A", level: "Excellent", description: "Framework follows best practices" };
  if (score >= t.gradeB) return { grade: "B", level: "Good", description: "Minor issues, normal maintenance needed" };
  if (score >= t.gradeC) return { grade: "C", level: "Fair", description: "Notable issues requiring attention" };
  if (score >= 15)       return { grade: "D", level: "Poor", description: "Serious issues, prioritize remediation" };
  return                          { grade: "F", level: "Critical", description: "Systemic issues across the framework" };
}

/**
 * Calculate the risk score and grade from a set of findings.
 *
 * This is the **single source of truth** for scoring — used by the CLI report,
 * the push client, and (indirectly) the dashboard.  Any change to the formula
 * must happen here so all consumers stay in sync.
 *
 * Returns a 0–100 health score (higher = better) in the `riskScore` field.
 */
export function calculateRiskScore(findings: Finding[]): RiskResult {
  let riskPoints = 0;

  // Weight findings by type and severity
  const INSIGHT_MULTIPLIER = 1.5; // Correlated findings are higher signal
  const CI_MULTIPLIER = 1.3; // CI issues affect entire pipeline
  const ARCH_MULTIPLIER = 1.2; // Architecture issues compound over time

  for (const f of findings) {
    const basePoints = severityScore(f.severity);
    // Cap evidence impact; use log scale for better distribution with large evidence counts
    // Capped at 3.5× (was 5×) to prevent large evidence sets from dominating the score
    const evidenceMultiplier = Math.min(1 + Math.log2(Math.max(f.evidence.length, 1)), 3.5);

    let multiplier = 1;
    if (f.findingId.startsWith("PW-INSIGHT-")) multiplier = INSIGHT_MULTIPLIER;
    else if (f.findingId.startsWith("CI-")) multiplier = CI_MULTIPLIER;
    else if (f.findingId.startsWith("ARCH-")) multiplier = ARCH_MULTIPLIER;

    riskPoints += basePoints * evidenceMultiplier * multiplier;
  }

  const healthScore = riskPointsToHealthScore(riskPoints);
  const gradeInfo = gradeFromHealthScore(healthScore);

  return { ...gradeInfo, riskScore: healthScore };
}
