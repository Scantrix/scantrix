import { describe, it, expect } from "vitest";
import { computeDiff } from "../src/diffTracker";

describe("computeDiff", () => {
  const baseline = [
    { findingId: "PW-FLAKE-001", severity: "high", title: "Hard waits", description: "", recommendation: "", evidence: [] },
    { findingId: "PW-LOC-001", severity: "medium", title: "XPath", description: "", recommendation: "", evidence: [] },
  ];

  const current = [
    { findingId: "PW-FLAKE-001", severity: "high", title: "Hard waits", description: "", recommendation: "", evidence: [] },
    { findingId: "PW-FLAKE-002", severity: "medium", title: "Force clicks", description: "", recommendation: "", evidence: [] },
  ];

  it("identifies new findings", () => {
    const diff = computeDiff(baseline as any, current as any);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].findingId).toBe("PW-FLAKE-002");
  });

  it("identifies resolved findings", () => {
    const diff = computeDiff(baseline as any, current as any);
    expect(diff.resolvedFindings).toHaveLength(1);
    expect(diff.resolvedFindings[0].findingId).toBe("PW-LOC-001");
  });

  it("identifies unchanged findings", () => {
    const diff = computeDiff(baseline as any, current as any);
    expect(diff.persistentFindings).toHaveLength(1);
    expect(diff.persistentFindings[0].findingId).toBe("PW-FLAKE-001");
  });
});
