import { describe, it, expect } from "vitest";
import {
  calculateRiskScore,
  riskPointsToHealthScore,
  gradeFromHealthScore,
  isTestScoped,
  computeFinalSeverity,
  applyEscalation,
  type ScoreInventory,
} from "../src/scoring";
import type { Finding } from "../src/scanner";

/** Helper: build a minimal finding with N evidence items. */
function makeFinding(
  findingId: string,
  severity: "low" | "medium" | "high",
  evidenceCount = 1,
): Finding {
  return {
    findingId,
    severity,
    title: `Test finding ${findingId}`,
    description: "test",
    recommendation: "test",
    evidence: Array.from({ length: evidenceCount }, (_, i) => ({
      file: `test-${i}.spec.ts`,
      line: i + 1,
      snippet: "snippet",
    })),
  };
}

// ── isTestScoped ──

describe("isTestScoped", () => {
  it("returns true for test-file finding prefixes", () => {
    expect(isTestScoped("PW-FLAKE-001")).toBe(true);
    expect(isTestScoped("PW-STABILITY-003")).toBe(true);
    expect(isTestScoped("PW-LOC-002")).toBe(true);
    expect(isTestScoped("PW-PERF-003")).toBe(true);
    expect(isTestScoped("PW-DEPREC-001")).toBe(true);
    expect(isTestScoped("CY-PERF-001")).toBe(true);
    expect(isTestScoped("CY-STABILITY-001")).toBe(true);
    expect(isTestScoped("SE-STABILITY-001")).toBe(true);
    expect(isTestScoped("DEP-001")).toBe(true);
  });

  it("returns false for infrastructure finding prefixes", () => {
    expect(isTestScoped("CI-001")).toBe(false);
    expect(isTestScoped("CI-014")).toBe(false);
    expect(isTestScoped("ARCH-001")).toBe(false);
    expect(isTestScoped("ARCH-010")).toBe(false);
    expect(isTestScoped("PW-INSIGHT-001")).toBe(false);
    expect(isTestScoped("PW-INSIGHT-015")).toBe(false);
  });
});

// ── riskPointsToHealthScore ──

describe("riskPointsToHealthScore", () => {
  it("returns 100 for 0 risk points", () => {
    expect(riskPointsToHealthScore(0)).toBe(100);
  });

  it("decreases monotonically", () => {
    const scores = [0, 20, 50, 85, 120, 164].map(riskPointsToHealthScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});

// ── gradeFromHealthScore ──

describe("gradeFromHealthScore", () => {
  it("maps score thresholds to correct grades", () => {
    expect(gradeFromHealthScore(100).grade).toBe("A");
    expect(gradeFromHealthScore(80).grade).toBe("A");
    expect(gradeFromHealthScore(79).grade).toBe("B");
    expect(gradeFromHealthScore(60).grade).toBe("B");
    expect(gradeFromHealthScore(59).grade).toBe("C");
    expect(gradeFromHealthScore(40).grade).toBe("C");
    expect(gradeFromHealthScore(39).grade).toBe("D");
    expect(gradeFromHealthScore(30).grade).toBe("D");
    expect(gradeFromHealthScore(29).grade).toBe("F");
    expect(gradeFromHealthScore(0).grade).toBe("F");
  });
});

// ── calculateRiskScore (baseline — no inventory) ──

describe("calculateRiskScore (no inventory)", () => {
  it("returns 100/A for empty findings", () => {
    const result = calculateRiskScore([]);
    expect(result.riskScore).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.densityInfo).toBeUndefined();
  });

  it("applies category multipliers", () => {
    // Use multiple findings with evidence so the multiplier difference is visible after rounding
    const insight = calculateRiskScore([makeFinding("PW-INSIGHT-001", "high", 10)]);
    const ci = calculateRiskScore([makeFinding("CI-001", "high", 10)]);
    const arch = calculateRiskScore([makeFinding("ARCH-001", "high", 10)]);
    const base = calculateRiskScore([makeFinding("PW-FLAKE-001", "high", 10)]);

    // Higher multiplier = more risk points = lower health score
    expect(insight.riskScore).toBeLessThanOrEqual(base.riskScore);
    expect(ci.riskScore).toBeLessThanOrEqual(base.riskScore);
    expect(arch.riskScore).toBeLessThanOrEqual(base.riskScore);
    // Insight (1.5x) should produce strictly lower score than base (1.0x)
    expect(insight.riskScore).toBeLessThan(base.riskScore);
  });

  it("does not include densityInfo when no inventory is passed", () => {
    const result = calculateRiskScore([makeFinding("PW-FLAKE-001", "high", 5)]);
    expect(result.densityInfo).toBeUndefined();
  });
});

// ── calculateRiskScore (density normalization) ──

describe("calculateRiskScore (density normalization)", () => {
  const fiveHighFlakes = Array.from({ length: 5 }, (_, i) =>
    makeFinding(`PW-FLAKE-00${i + 1}`, "high", 10),
  );

  it("produces a higher score for a large suite than without inventory", () => {
    const withoutInv = calculateRiskScore(fiveHighFlakes);
    const withLargeSuite = calculateRiskScore(fiveHighFlakes, { testFiles: 500 });
    expect(withLargeSuite.riskScore).toBeGreaterThan(withoutInv.riskScore);
  });

  it("does not adjust score for suites at or below 50 files", () => {
    // Below 50 files: densityFactor = 1.0, score unchanged
    const withoutInv = calculateRiskScore(fiveHighFlakes);
    const withSmallSuite = calculateRiskScore(fiveHighFlakes, { testFiles: 30 });
    expect(withSmallSuite.riskScore).toBe(withoutInv.riskScore);
    expect(withSmallSuite.densityInfo!.densityFactor).toBe(1);
  });

  it("populates densityInfo when inventory is provided and suite > 50 files", () => {
    const result = calculateRiskScore(fiveHighFlakes, { testFiles: 100 });
    expect(result.densityInfo).toBeDefined();
    expect(result.densityInfo!.effectiveTestFiles).toBe(100);
    expect(result.densityInfo!.findingDensity).toBe(0.05);
    expect(result.densityInfo!.densityFactor).toBeGreaterThanOrEqual(1.0);
    expect(result.densityInfo!.densityFactor).toBeLessThanOrEqual(4.0);
  });

  it("larger suites get higher density factors", () => {
    const med = calculateRiskScore(fiveHighFlakes, { testFiles: 100 });
    const large = calculateRiskScore(fiveHighFlakes, { testFiles: 500 });
    const huge = calculateRiskScore(fiveHighFlakes, { testFiles: 1000 });

    expect(large.densityInfo!.densityFactor).toBeGreaterThan(med.densityInfo!.densityFactor);
    // Both large and huge may hit the 2.5 cap, but score should be >= for huge
    expect(huge.riskScore).toBeGreaterThanOrEqual(large.riskScore);
  });

  it("adjusts all findings equally (lambda-based approach)", () => {
    // With lambda scaling, even CI/ARCH findings benefit from a larger suite
    const ciFindings = Array.from({ length: 3 }, (_, i) =>
      makeFinding(`CI-00${i + 1}`, "high", 5),
    );
    const withoutInv = calculateRiskScore(ciFindings);
    const withLargeSuite = calculateRiskScore(ciFindings, { testFiles: 500 });
    expect(withLargeSuite.riskScore).toBeGreaterThan(withoutInv.riskScore);
  });

  it("returns identical score when testFiles is 0", () => {
    const withoutInv = calculateRiskScore(fiveHighFlakes);
    const withZeroFiles = calculateRiskScore(fiveHighFlakes, { testFiles: 0 });
    expect(withZeroFiles.riskScore).toBe(withoutInv.riskScore);
    expect(withZeroFiles.densityInfo).toBeUndefined();
  });

  it("returns 100/A for empty findings regardless of inventory", () => {
    const result = calculateRiskScore([], { testFiles: 500 });
    expect(result.riskScore).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.densityInfo).toBeUndefined();
  });

  it("caps densityFactor at 4.0 for very large suites", () => {
    const result = calculateRiskScore(fiveHighFlakes, { testFiles: 100000 });
    expect(result.densityInfo).toBeDefined();
    expect(result.densityInfo!.densityFactor).toBe(4.0);
  });

  it("has densityFactor of 1.0 at 50 test files (neutral point)", () => {
    // 50 files is the neutral point: factor = 1.0 + 0.3 * log2(50/50) = 1.0
    const result = calculateRiskScore(fiveHighFlakes, { testFiles: 50 });
    // At exactly 50 files, factor = 1.0 which means no adjustment → densityInfo not emitted
    const withoutInv = calculateRiskScore(fiveHighFlakes);
    expect(result.riskScore).toBe(withoutInv.riskScore);
  });

  it("includes cypressTestFiles and seleniumTestFiles in effective count", () => {
    const findings = [makeFinding("CY-PERF-001", "high", 5)];
    const inv: ScoreInventory = {
      testFiles: 0,
      cypressTestFiles: 200,
      seleniumTestFiles: 50,
    };
    const result = calculateRiskScore(findings, inv);
    expect(result.densityInfo).toBeDefined();
    expect(result.densityInfo!.effectiveTestFiles).toBe(250);
  });

  it("reducing evidence count always improves the score (no dead zone)", () => {
    // Core property: every occurrence fix should move the score.
    // Test across a wide range: 100 → 50 → 25 → 10 → 5 → 1
    const evidenceCounts = [100, 50, 25, 10, 5, 1];
    const scores = evidenceCounts.map((n) => {
      // Use a realistic multi-finding context so the single finding's change is
      // measured against background noise (not in isolation).
      const background = [
        makeFinding("PW-FLAKE-002", "high", 15),
        makeFinding("CI-001", "medium", 3),
        makeFinding("ARCH-001", "low", 8),
      ];
      const target = makeFinding("PW-FLAKE-001", "high", n);
      return calculateRiskScore([target, ...background]).riskScore;
    });

    // Each step should produce a strictly higher health score
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it("uses totalOccurrences instead of evidence.length when present", () => {
    // Simulate a finding with 25 evidence items but 127 total occurrences
    const capped: Finding = {
      ...makeFinding("PW-FLAKE-001", "high", 25),
      totalOccurrences: 127,
    };
    const uncapped = makeFinding("PW-FLAKE-001", "high", 25);

    const scoreCapped = calculateRiskScore([capped]).riskScore;
    const scoreUncapped = calculateRiskScore([uncapped]).riskScore;

    // 127 occurrences should produce a lower health score than 25
    expect(scoreCapped).toBeLessThan(scoreUncapped);
  });

  it("real-world scenario: large sparse suite scores better than small dense suite", () => {
    // 24 findings across 981 files vs 18 findings across 105 files
    const largeRepoFindings = Array.from({ length: 24 }, (_, i) =>
      makeFinding(`PW-FLAKE-${String(i).padStart(3, "0")}`, i < 5 ? "high" : "medium", 5),
    );
    const smallRepoFindings = Array.from({ length: 18 }, (_, i) =>
      makeFinding(`PW-FLAKE-${String(i).padStart(3, "0")}`, i < 5 ? "high" : "medium", 5),
    );

    const large = calculateRiskScore(largeRepoFindings, { testFiles: 981 });
    const small = calculateRiskScore(smallRepoFindings, { testFiles: 105 });

    // Large sparse suite should score higher despite having more absolute findings
    expect(large.riskScore).toBeGreaterThan(small.riskScore);
  });
});

// ── computeFinalSeverity ──

describe("computeFinalSeverity", () => {
  it("high stays high", () => {
    const r = computeFinalSeverity("high", 50, 100);
    expect(r.finalSeverity).toBe("high");
    expect(r.reason).toBe("already high");
  });

  it("totalTestFiles = 0 → no escalation, null prevalence", () => {
    const r = computeFinalSeverity("medium", 50, 0);
    expect(r.finalSeverity).toBe("medium");
    expect(r.prevalence).toBeNull();
    expect(r.reason).toBe("unknown prevalence");
  });

  it("medium → high via prevalence threshold (≥25%)", () => {
    const r = computeFinalSeverity("medium", 25, 100);
    expect(r.finalSeverity).toBe("high");
    expect(r.prevalence).toBe(0.25);
    expect(r.reason).toContain("25%");
  });

  it("medium → high via absolute threshold (≥200 occurrences)", () => {
    const r = computeFinalSeverity("medium", 200, 10000);
    expect(r.finalSeverity).toBe("high");
    expect(r.reason).toContain("200");
    expect(r.reason).toContain("absolute");
  });

  it("medium → high via compound threshold (≥10% AND ≥75 occurrences)", () => {
    const r = computeFinalSeverity("medium", 80, 500);
    expect(r.finalSeverity).toBe("high");
    expect(r.prevalence).toBe(0.16);
    expect(r.reason).toContain("compound");
  });

  it("medium stays medium when compound partially met (≥10% but <75 occurrences)", () => {
    const r = computeFinalSeverity("medium", 50, 400);
    expect(r.finalSeverity).toBe("medium");
    // prevalence = 12.5% >= 10%, but occurrences = 50 < 75
    expect(r.prevalence).toBe(0.125);
  });

  it("medium stays medium below all thresholds", () => {
    const r = computeFinalSeverity("medium", 10, 100);
    expect(r.finalSeverity).toBe("medium");
    expect(r.reason).toBe("below escalation thresholds");
  });

  it("low → medium via prevalence threshold (≥25%)", () => {
    const r = computeFinalSeverity("low", 30, 100);
    expect(r.finalSeverity).toBe("medium");
    expect(r.reason).toContain("25%");
  });

  it("low → medium via absolute threshold (≥200 occurrences)", () => {
    const r = computeFinalSeverity("low", 200, 10000);
    expect(r.finalSeverity).toBe("medium");
    expect(r.reason).toContain("200");
    expect(r.reason).toContain("absolute");
  });

  it("low stays low below thresholds (no compound threshold for low)", () => {
    // prevalence 15% >= 10% and 80 >= 75, but low has no compound rule
    const r = computeFinalSeverity("low", 80, 500);
    expect(r.finalSeverity).toBe("low");
  });

  // Boundary tests
  it("exactly at 25% threshold → escalates", () => {
    const r = computeFinalSeverity("medium", 25, 100);
    expect(r.finalSeverity).toBe("high");
  });

  it("just below 25% threshold → no escalation", () => {
    const r = computeFinalSeverity("medium", 24, 100);
    // 24/100 = 0.24 < 0.25, and 24 < 200, and (0.24 >= 0.10 but 24 < 75)
    expect(r.finalSeverity).toBe("medium");
  });

  it("exactly 200 occurrences → escalates", () => {
    const r = computeFinalSeverity("medium", 200, 10000);
    expect(r.finalSeverity).toBe("high");
  });

  it("199 occurrences with low prevalence → no escalation", () => {
    const r = computeFinalSeverity("medium", 199, 10000);
    // prevalence = 1.99% < 10%, occurrences = 199 < 200
    expect(r.finalSeverity).toBe("medium");
  });

  it("high with totalTestFiles = 0 still returns high", () => {
    const r = computeFinalSeverity("high", 50, 0);
    expect(r.finalSeverity).toBe("high");
    expect(r.prevalence).toBeNull();
  });
});

// ── applyEscalation ──

describe("applyEscalation", () => {
  it("non-escalated findings returned by reference (no baseSeverity set)", () => {
    const f = makeFinding("PW-FLAKE-001", "medium", 3);
    const result = applyEscalation([f], 100);
    expect(result[0]).toBe(f); // same reference
    expect(result[0].baseSeverity).toBeUndefined();
  });

  it("escalated findings get baseSeverity + escalationReason", () => {
    const f = makeFinding("PW-FLAKE-001", "medium", 30);
    const result = applyEscalation([f], 100);
    // 30/100 = 30% >= 25% → medium→high
    expect(result[0].severity).toBe("high");
    expect(result[0].baseSeverity).toBe("medium");
    expect(result[0].escalationReason).toBeDefined();
  });

  it("original array not mutated", () => {
    const f = makeFinding("PW-FLAKE-001", "medium", 30);
    const original = [f];
    const result = applyEscalation(original, 100);
    expect(original[0].severity).toBe("medium"); // original unchanged
    expect(result[0].severity).toBe("high"); // new array has escalated
    expect(original).toHaveLength(1);
  });

  it("uses totalOccurrences when available, falls back to evidence.length", () => {
    const withTotal: Finding = {
      ...makeFinding("PW-FLAKE-001", "medium", 5),
      totalOccurrences: 30,
    };
    const withoutTotal = makeFinding("PW-FLAKE-002", "medium", 30);

    // Both should escalate: 30/100 = 30% >= 25%
    const result = applyEscalation([withTotal, withoutTotal], 100);
    expect(result[0].severity).toBe("high");
    expect(result[1].severity).toBe("high");
  });

  it("effectiveTestFiles = 0 → no escalation", () => {
    const f = makeFinding("PW-FLAKE-001", "medium", 500);
    const result = applyEscalation([f], 0);
    expect(result[0]).toBe(f);
    expect(result[0].severity).toBe("medium");
    expect(result[0].baseSeverity).toBeUndefined();
  });

  it("high findings pass through unchanged", () => {
    const f = makeFinding("PW-FLAKE-001", "high", 50);
    const result = applyEscalation([f], 100);
    expect(result[0]).toBe(f);
    expect(result[0].baseSeverity).toBeUndefined();
  });
});
