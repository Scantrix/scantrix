import type { Finding } from "./scanner";

/** Minimal inventory fields needed for density normalization. */
export interface ScoreInventory {
  testFiles: number;
  cypressTestFiles?: number;
  seleniumTestFiles?: number;
}

export interface DensityInfo {
  effectiveTestFiles: number;
  findingDensity: number;
  densityFactor: number;
}

export interface RiskResult {
  grade: string;
  level: string;
  description: string;
  riskScore: number;
  /** Present when density normalization was applied. */
  densityInfo?: DensityInfo;
}

function severityScore(sev: "low" | "medium" | "high"): number {
  return sev === "high" ? 3 : sev === "medium" ? 2 : 1;
}

/**
 * Finding prefixes that are tied to test files.
 * Used by reports and downstream consumers to classify findings.
 */
const TEST_SCOPED_PREFIXES = [
  "PW-FLAKE-",
  "PW-STABILITY-",
  "PW-LOC-",
  "PW-PERF-",
  "PW-DEPREC-",
  "CY-",
  "SE-",
  "DEP-",
];

export function isTestScoped(findingId: string): boolean {
  return TEST_SCOPED_PREFIXES.some((p) => findingId.startsWith(p));
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
 * ## Density normalization
 *
 * When `inventory` is provided, the decay constant (lambda) is scaled by suite
 * size so that larger test suites are evaluated more leniently.  The rationale:
 * 24 findings scattered across 981 test files is a healthier codebase than 18
 * findings concentrated in 105 test files.
 *
 * The density factor scales the decay constant (λ = 80 × factor), meaning
 * the same raw risk points produce a higher health score for larger suites.
 * Factor is clamped to [1.0, 3.5] — small suites see no penalty, and the
 * maximum benefit caps at 3.5× (reached at ~3,200 files) to prevent
 * extremely large suites from masking real problems.
 *
 * Returns a 0–100 health score (higher = better) in the `riskScore` field.
 */
export function calculateRiskScore(
  findings: Finding[],
  inventory?: ScoreInventory,
): RiskResult {
  // Weight findings by type and severity
  const INSIGHT_MULTIPLIER = 1.5; // Correlated findings are higher signal
  const CI_MULTIPLIER = 1.3; // CI issues affect entire pipeline
  const ARCH_MULTIPLIER = 1.2; // Architecture issues compound over time

  let riskPoints = 0;

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

  // Density normalization: scale the decay constant by suite size.
  // Larger suites get a higher lambda, so the same risk points yield a better score.
  //
  // densityFactor formula:  1.0 + 0.5 × log₂(effectiveTestFiles / 50)
  //   50 files  → 1.0 (neutral — no adjustment)
  //   100 files → 1.5
  //   200 files → 2.0
  //   500 files → ~2.16
  //   1000 files → ~2.66
  //   3200 files → ~3.5 (cap)
  //   < 50 files → 1.0  (floor — never penalize small suites)
  const BASE_LAMBDA = 80;
  let lambda = BASE_LAMBDA;
  let densityInfo: DensityInfo | undefined;

  if (inventory && findings.length > 0) {
    const effectiveTestFiles =
      inventory.testFiles +
      (inventory.cypressTestFiles ?? 0) +
      (inventory.seleniumTestFiles ?? 0);

    if (effectiveTestFiles > 0) {
      const findingDensity = findings.length / effectiveTestFiles;
      const rawFactor = 1.0 + 0.5 * Math.log2(Math.max(effectiveTestFiles / 50, 1));
      const densityFactor = Math.min(3.5, Math.max(1.0, rawFactor));

      lambda = BASE_LAMBDA * densityFactor;
      densityInfo = {
        effectiveTestFiles,
        findingDensity: Math.round(findingDensity * 1000) / 1000,
        densityFactor: Math.round(densityFactor * 100) / 100,
      };
    }
  }

  const healthScore = Math.round(100 * Math.exp(-riskPoints / lambda));
  const gradeInfo = gradeFromHealthScore(healthScore);

  return { ...gradeInfo, riskScore: healthScore, densityInfo };
}
