"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRiskScore = calculateRiskScore;
function severityScore(sev) {
    return sev === "high" ? 3 : sev === "medium" ? 2 : 1;
}
/**
 * Calculate the risk score and grade from a set of findings.
 *
 * This is the **single source of truth** for scoring — used by the CLI report,
 * the push client, and (indirectly) the dashboard.  Any change to the formula
 * must happen here so all consumers stay in sync.
 */
function calculateRiskScore(findings) {
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
        if (f.findingId.startsWith("PW-INSIGHT-"))
            multiplier = INSIGHT_MULTIPLIER;
        else if (f.findingId.startsWith("CI-"))
            multiplier = CI_MULTIPLIER;
        else if (f.findingId.startsWith("ARCH-"))
            multiplier = ARCH_MULTIPLIER;
        riskPoints += basePoints * evidenceMultiplier * multiplier;
    }
    // Convert risk points to letter grade (A = best, F = worst)
    // Thresholds calibrated for typical Playwright repos
    // Thresholds raised in v2.5.0 to avoid grade inflation — most real repos should land B-C.
    if (riskPoints <= 20) {
        return { grade: "A", level: "🟢 Excellent", description: "Framework follows best practices", riskScore: Math.round(riskPoints) };
    }
    else if (riskPoints <= 50) {
        return { grade: "B", level: "🟡 Good", description: "Minor issues, normal maintenance needed", riskScore: Math.round(riskPoints) };
    }
    else if (riskPoints <= 85) {
        return { grade: "C", level: "🟠 Needs Improvement", description: "Notable issues requiring attention", riskScore: Math.round(riskPoints) };
    }
    else if (riskPoints <= 120) {
        return { grade: "D", level: "🔴 Critical", description: "Serious issues, prioritize remediation", riskScore: Math.round(riskPoints) };
    }
    else {
        return { grade: "F", level: "🔴 Severe", description: "Systemic issues across the framework", riskScore: Math.round(riskPoints) };
    }
}
