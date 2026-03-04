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

export function severityScore(sev: "low" | "medium" | "high"): number {
  return sev === "high" ? 3 : sev === "medium" ? 2 : 1;
}

// ── Prevalence-based severity escalation ─────────────────────────────

export interface EscalationResult {
  finalSeverity: "low" | "medium" | "high";
  prevalence: number | null;
  reason: string;
}

/**
 * Determine whether a finding's severity should be escalated based on
 * how widespread the pattern is across the test suite.
 *
 * Pure function — no side-effects.
 */
export function computeFinalSeverity(
  baseSeverity: "low" | "medium" | "high",
  occurrences: number,
  totalTestFiles: number,
): EscalationResult {
  if (baseSeverity === "high") {
    return { finalSeverity: "high", prevalence: totalTestFiles > 0 ? occurrences / totalTestFiles : null, reason: "already high" };
  }

  if (totalTestFiles <= 0) {
    return { finalSeverity: baseSeverity, prevalence: null, reason: "unknown prevalence" };
  }

  const prevalence = occurrences / totalTestFiles;

  if (baseSeverity === "medium") {
    if (prevalence >= 0.25) {
      return { finalSeverity: "high", prevalence, reason: `prevalence ${(prevalence * 100).toFixed(1)}% >= 25% threshold` };
    }
    if (occurrences >= 200) {
      return { finalSeverity: "high", prevalence, reason: `${occurrences} occurrences >= 200 absolute threshold` };
    }
    if (prevalence >= 0.10 && occurrences >= 75) {
      return { finalSeverity: "high", prevalence, reason: `prevalence ${(prevalence * 100).toFixed(1)}% >= 10% and ${occurrences} occurrences >= 75 (compound threshold)` };
    }
    return { finalSeverity: "medium", prevalence, reason: "below escalation thresholds" };
  }

  // baseSeverity === "low"
  if (prevalence >= 0.25) {
    return { finalSeverity: "medium", prevalence, reason: `prevalence ${(prevalence * 100).toFixed(1)}% >= 25% threshold` };
  }
  if (occurrences >= 200) {
    return { finalSeverity: "medium", prevalence, reason: `${occurrences} occurrences >= 200 absolute threshold` };
  }
  return { finalSeverity: "low", prevalence, reason: "below escalation thresholds" };
}

/**
 * Post-scan escalation pass: promote finding severity when a pattern is
 * widespread across the test suite ("blast radius").
 *
 * Returns a new array. Non-escalated findings are returned by reference
 * (no copy). Escalated findings get `baseSeverity` and `escalationReason` set.
 * The original array is never mutated.
 */
export function applyEscalation(
  findings: Finding[],
  effectiveTestFiles: number,
): Finding[] {
  return findings.map((f) => {
    const occurrences = f.totalOccurrences ?? f.evidence.length;
    const result = computeFinalSeverity(f.severity, occurrences, effectiveTestFiles);
    if (result.finalSeverity === f.severity) {
      return f; // no escalation — return by reference
    }
    return {
      ...f,
      baseSeverity: f.severity,
      severity: result.finalSeverity,
      escalationReason: result.reason,
    };
  });
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
 *   50 risk points → 78
 *   100 risk points → 61
 *   200 risk points → 37
 *   300 risk points → 22
 *   400 risk points → 14
 */
export function riskPointsToHealthScore(riskPoints: number): number {
  return Math.round(100 * Math.exp(-riskPoints / 200));
}

/**
 * Map a 0–100 health score to a letter grade and human-readable level.
 * Higher score = better grade.
 *
 * Default thresholds: A (≥80), B (≥60), C (≥40), D (≥25), F (<25)
 */
export function gradeFromHealthScore(
  score: number,
  thresholds?: { gradeA: number; gradeB: number; gradeC: number },
): { grade: string; level: string; description: string } {
  const t = thresholds ?? { gradeA: 80, gradeB: 60, gradeC: 40 };
  if (score >= t.gradeA) return { grade: "A", level: "Excellent", description: "Well-structured framework with strong practices" };
  if (score >= t.gradeB) return { grade: "B", level: "Good", description: "Solid foundation with room for improvement" };
  if (score >= t.gradeC) return { grade: "C", level: "Fair", description: "Multiple areas need attention" };
  if (score >= 25)       return { grade: "D", level: "Poor", description: "Significant issues affecting reliability" };
  return                          { grade: "F", level: "Critical", description: "Widespread issues requiring immediate action" };
}

/**
 * Calculate the risk score and grade from a set of findings.
 *
 * This is the **single source of truth** for scoring — used by the CLI report
 * and all result output.  Any change to the formula must happen here so all
 * consumers stay in sync.
 *
 * ## Density normalization
 *
 * When `inventory` is provided, the decay constant (lambda) is scaled by suite
 * size so that larger test suites are evaluated more leniently.  The rationale:
 * 24 findings scattered across 981 test files is a healthier codebase than 18
 * findings concentrated in 105 test files.
 *
 * The density factor scales the decay constant (λ = 200 × factor), meaning
 * the same raw risk points produce a higher health score for larger suites.
 * Factor is clamped to [1.0, 4.0] — small suites see no penalty, and the
 * maximum benefit caps at 4.0× to prevent extremely large suites from
 * masking real problems.
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
    // Occurrence multiplier: N^0.6 power curve.
    // Provides meaningful sensitivity across the full range — fixing 58 of 170
    // occurrences produces a visible score improvement, unlike log₂ which
    // compresses too aggressively at high counts.
    // Uses totalOccurrences (true count) when available, since evidence arrays
    // are capped for report brevity (typically 10-25 items).
    //
    //   1 occurrence → 1.00    25 occurrences → 6.90
    //   5 occurrences → 2.63   50 occurrences → 10.46
    //  10 occurrences → 3.98  100 occurrences → 15.85
    const occurrences = f.totalOccurrences ?? f.evidence.length;
    const evidenceMultiplier = Math.pow(Math.max(occurrences, 1), 0.6);

    let multiplier = 1;
    if (f.findingId.startsWith("PW-INSIGHT-")) multiplier = INSIGHT_MULTIPLIER;
    else if (f.findingId.startsWith("CI-")) multiplier = CI_MULTIPLIER;
    else if (f.findingId.startsWith("ARCH-")) multiplier = ARCH_MULTIPLIER;

    riskPoints += basePoints * evidenceMultiplier * multiplier;
  }

  // Density normalization: scale the decay constant by suite size.
  // Larger suites get a higher lambda, so the same risk points yield a better score.
  //
  // densityFactor formula:  1.0 + 0.3 × log₂(effectiveTestFiles / 50)
  //   50 files   → 1.0  (neutral — no adjustment)
  //   100 files  → 1.3
  //   200 files  → 1.6
  //   500 files  → ~2.0
  //   1000 files → ~2.3
  //   5000 files → ~2.9
  //   < 50 files → 1.0  (floor — never penalize small suites)
  //   cap at 4.0 (reached only at ~51,000 files)
  const BASE_LAMBDA = 200;
  let lambda = BASE_LAMBDA;
  let densityInfo: DensityInfo | undefined;

  if (inventory && findings.length > 0) {
    const effectiveTestFiles =
      inventory.testFiles +
      (inventory.cypressTestFiles ?? 0) +
      (inventory.seleniumTestFiles ?? 0);

    if (effectiveTestFiles > 0) {
      const findingDensity = findings.length / effectiveTestFiles;
      const rawFactor = 1.0 + 0.3 * Math.log2(Math.max(effectiveTestFiles / 50, 1));
      const densityFactor = Math.min(4.0, Math.max(1.0, rawFactor));

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
