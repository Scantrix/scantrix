import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { scanRepo } from "../src/scanner";
import type { ScanResults } from "../src/scanner";

const FIXTURES = path.join(__dirname, "fixtures");

function hasFinding(results: ScanResults, id: string): boolean {
  return results.findings.some((f) => f.findingId === id);
}

function getFinding(results: ScanResults, id: string) {
  return results.findings.find((f) => f.findingId === id);
}

// ─── Bad Repo: should trigger many findings ─────────────────────────
describe("bad-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "bad-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  // ── Flakiness ──────────────────────────────────────────────────
  it("detects hard waits (PW-FLAKE-001)", () => {
    expect(hasFinding(results, "PW-FLAKE-001")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-001")!;
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("detects disguised hard waits via global name scan (PW-FLAKE-001)", () => {
    const f = getFinding(results, "PW-FLAKE-001")!;
    const disguisedEvidence = f.evidence.filter((e) =>
      e.snippet.includes("Disguised hard wait"),
    );
    expect(disguisedEvidence.length).toBeGreaterThanOrEqual(3);
    expect(disguisedEvidence.some((e) => e.snippet.includes("delay()"))).toBe(true);
    expect(disguisedEvidence.some((e) => e.snippet.includes("waitForDataSync()"))).toBe(true);
    expect(disguisedEvidence.some((e) => e.snippet.includes("waitForIdleNetwork()"))).toBe(true);
    // retryOperation should NOT appear (false-positive filter)
    expect(disguisedEvidence.some((e) => e.snippet.includes("retryOperation"))).toBe(false);
    // Non-test files (page objects) should also be scanned for disguised waits
    expect(disguisedEvidence.some((e) => e.file.includes("pages/"))).toBe(true);
  });

  it("detects debug pauses (PW-FLAKE-009)", () => {
    expect(hasFinding(results, "PW-FLAKE-009")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-009")!;
    expect(f.severity).toBe("high");
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    // Should NOT include evidence from login.spec.ts (test.fixme file)
    expect(f.evidence.some((e) => e.file.includes("login.spec"))).toBe(false);
  });

  it("detects retrieval methods without content guard (PW-FLAKE-010)", () => {
    expect(hasFinding(results, "PW-FLAKE-010")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-010")!;
    expect(f.severity).toBe("medium");
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
    // Guarded retrieval calls (preceded by expect().not.toHaveText/toContainText) should NOT appear
    const guardedEvidence = f.evidence.filter((e) =>
      e.snippet.includes("guarded retrieval")
    );
    expect(guardedEvidence.length).toBe(0);
  });

  it("PW-FLAKE-001 does not catch page.pause()", () => {
    const f = getFinding(results, "PW-FLAKE-001")!;
    const pauseEvidence = f.evidence.filter((e) =>
      e.snippet.includes("page.pause"),
    );
    expect(pauseEvidence.length).toBe(0);
  });

  it("detects force clicks (PW-FLAKE-002)", () => {
    expect(hasFinding(results, "PW-FLAKE-002")).toBe(true);
  });

  it("detects test.skip (PW-FLAKE-003)", () => {
    expect(hasFinding(results, "PW-FLAKE-003")).toBe(true);
  });

  it("detects networkidle (PW-FLAKE-004)", () => {
    expect(hasFinding(results, "PW-FLAKE-004")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-004")!;
    expect(f.severity).toBe("high");
  });

  it("detects non-retrying assertions (PW-FLAKE-005)", () => {
    expect(hasFinding(results, "PW-FLAKE-005")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-005")!;
    expect(f.severity).toBe("high");
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("detects test.fixme markers (PW-FLAKE-006)", () => {
    expect(hasFinding(results, "PW-FLAKE-006")).toBe(true);
  });

  it("detects deprecated page.type() (PW-DEPREC-007)", () => {
    expect(hasFinding(results, "PW-DEPREC-007")).toBe(true);
  });

  it("detects deprecated layout selectors (PW-DEPREC-008)", () => {
    expect(hasFinding(results, "PW-DEPREC-008")).toBe(true);
  });

  // ── Locators ───────────────────────────────────────────────────
  it("detects XPath selectors (PW-LOC-001)", () => {
    expect(hasFinding(results, "PW-LOC-001")).toBe(true);
  });

  it("detects nth/first/last (PW-LOC-003)", () => {
    expect(hasFinding(results, "PW-LOC-003")).toBe(true);
  });

  // ── Performance ────────────────────────────────────────────────
  it("detects hardcoded URLs (PW-PERF-002)", () => {
    expect(hasFinding(results, "PW-PERF-002")).toBe(true);
  });

  // ── Architecture ───────────────────────────────────────────────
  it("detects locator-bag POMs (ARCH-002)", () => {
    expect(hasFinding(results, "ARCH-002")).toBe(true);
    const f = getFinding(results, "ARCH-002")!;
    expect(f.severity).toBe("low");
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("detects hardcoded credentials (ARCH-005)", () => {
    expect(hasFinding(results, "ARCH-005")).toBe(true);
  });

  it("detects inline config overrides (ARCH-009)", () => {
    expect(hasFinding(results, "ARCH-009")).toBe(true);
  });

  it("detects hardcoded inline test data (ARCH-010)", () => {
    expect(hasFinding(results, "ARCH-010")).toBe(true);
    const f = getFinding(results, "ARCH-010")!;
    expect(f.severity).toBe("low");
  });

  // ── Stability ────────────────────────────────────────────────
  it("detects browser resource leaks (PW-STABILITY-005)", () => {
    expect(hasFinding(results, "PW-STABILITY-005")).toBe(true);
    const f = getFinding(results, "PW-STABILITY-005")!;
    expect(f.severity).toBe("medium");
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("detects over-asserted tests (PW-STABILITY-006)", () => {
    expect(hasFinding(results, "PW-STABILITY-006")).toBe(true);
    const f = getFinding(results, "PW-STABILITY-006")!;
    expect(f.severity).toBe("low");
  });

  it("detects variable shadowing between scopes (PW-STABILITY-007)", () => {
    expect(hasFinding(results, "PW-STABILITY-007")).toBe(true);
    const f = getFinding(results, "PW-STABILITY-007")!;
    expect(f.severity).toBe("high");
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    expect(f.evidence[0].snippet).toContain("shadowed");
  });

  it("detects manual browser.newContext()/request.newContext() in test bodies (PW-STABILITY-008)", () => {
    expect(hasFinding(results, "PW-STABILITY-008")).toBe(true);
    const f = getFinding(results, "PW-STABILITY-008")!;
    expect(f.severity).toBe("medium");
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
    expect(f.evidence[0].snippet).toContain("context(s) manually");
  });

  // ── Flakiness (AST) ──────────────────────────────────────────
  it("detects custom assertion wrappers (PW-FLAKE-007)", () => {
    expect(hasFinding(results, "PW-FLAKE-007")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-007")!;
    expect(f.severity).toBe("high");
    expect(f.evidence[0].snippet).toContain("expect()");
  });

  it("detects missing await on async Playwright APIs (PW-FLAKE-008)", () => {
    expect(hasFinding(results, "PW-FLAKE-008")).toBe(true);
    const f = getFinding(results, "PW-FLAKE-008")!;
    expect(f.severity).toBe("high");
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
    expect(f.evidence[0].snippet).toContain("unawaited");
  });

  // ── CI ─────────────────────────────────────────────────────────
  it("detects missing report publishing (CI-002)", () => {
    expect(hasFinding(results, "CI-002")).toBe(true);
  });

  it("detects missing playwright install (CI-011)", () => {
    expect(hasFinding(results, "CI-011")).toBe(true);
  });

  // ── Architecture ─────────────────────────────────────────────
  it("detects emoji characters in log messages (ARCH-011)", () => {
    expect(hasFinding(results, "ARCH-011")).toBe(true);
    const f = getFinding(results, "ARCH-011")!;
    expect(f.severity).toBe("low");
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("detects mutating imported test data (ARCH-012)", () => {
    expect(hasFinding(results, "ARCH-012")).toBe(true);
    const f = getFinding(results, "ARCH-012")!;
    expect(f.severity).toBe("high");
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    expect(f.evidence[0].snippet).toContain("mutation");
  });

  // ── Insights ───────────────────────────────────────────────────
  it("produces insight for hardcoded URLs + no baseURL (PW-INSIGHT-010)", () => {
    expect(hasFinding(results, "PW-INSIGHT-010")).toBe(true);
  });

  // ── Severity ───────────────────────────────────────────────────
  it("marks PW-FLAKE-001 as high severity", () => {
    const f = getFinding(results, "PW-FLAKE-001");
    expect(f?.severity).toBe("high");
  });

  // ── test.fixme file exclusion ─────────────────────────────────
  it("excludes test.fixme files from rules other than PW-FLAKE-006", () => {
    // login.spec.ts contains test.fixme() — its evidence should not appear
    // in any finding except PW-FLAKE-006
    const flake006 = getFinding(results, "PW-FLAKE-006")!;
    expect(flake006.evidence.some((e) => e.file.includes("login.spec"))).toBe(true);

    // PW-FLAKE-001 evidence must NOT reference login.spec.ts
    const flake001 = getFinding(results, "PW-FLAKE-001")!;
    expect(flake001.evidence.some((e) => e.file.includes("login.spec"))).toBe(false);
  });

  // ── False-positive suppression ────────────────────────────────
  it("does NOT flag utility files in fixtures/ for PW-FLAKE-001", () => {
    const f = getFinding(results, "PW-FLAKE-001")!;
    const evidenceFiles = f.evidence.map((e) => e.file);
    expect(evidenceFiles.some((p) => p.includes("resource-manager"))).toBe(false);
  });

  it("does NOT flag utility files in fixtures/ for PW-FLAKE-002", () => {
    const f = getFinding(results, "PW-FLAKE-002");
    if (f) {
      const evidenceFiles = f.evidence.map((e) => e.file);
      expect(evidenceFiles.some((p) => p.includes("resource-manager"))).toBe(false);
    }
  });

  // ── Inventory ──────────────────────────────────────────────────
  it("counts test files correctly", () => {
    expect(results.inventory.testFiles).toBe(13);
  });

  it("counts individual test cases across files", () => {
    expect(results.inventory.testCases).toBeDefined();
    expect(results.inventory.testCases).toBe(47);
  });

  it("detects Playwright config", () => {
    expect(results.inventory.hasPlaywrightConfig).toBe(true);
  });
});

// ─── Good Repo: should be mostly clean ───────────────────────────────
describe("good-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "good-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("produces few or no high-severity findings", () => {
    const highFindings = results.findings.filter(
      (f) => f.severity === "high"
    );
    expect(highFindings.length).toBeLessThanOrEqual(1);
  });

  it("does NOT detect hard waits", () => {
    expect(hasFinding(results, "PW-FLAKE-001")).toBe(false);
  });

  it("does NOT detect force clicks", () => {
    expect(hasFinding(results, "PW-FLAKE-002")).toBe(false);
  });

  it("does NOT detect XPath selectors", () => {
    expect(hasFinding(results, "PW-LOC-001")).toBe(false);
  });

  it("does NOT flag hardcoded URLs (baseURL is configured)", () => {
    expect(hasFinding(results, "PW-INSIGHT-010")).toBe(false);
  });

  it("does NOT flag resource leaks (uses fixtures or variable-based cleanup)", () => {
    expect(hasFinding(results, "PW-STABILITY-005")).toBe(false);
  });

  it("does NOT flag over-asserted tests", () => {
    expect(hasFinding(results, "PW-STABILITY-006")).toBe(false);
  });

  it("does NOT flag inline test data", () => {
    expect(hasFinding(results, "ARCH-010")).toBe(false);
  });

  it("does NOT flag variable shadowing (PW-STABILITY-007)", () => {
    expect(hasFinding(results, "PW-STABILITY-007")).toBe(false);
  });

  it("does NOT flag custom assertion wrappers (PW-FLAKE-007)", () => {
    expect(hasFinding(results, "PW-FLAKE-007")).toBe(false);
  });

  it("does NOT flag mutating imported test data (ARCH-012)", () => {
    expect(hasFinding(results, "ARCH-012")).toBe(false);
  });

  it("does NOT flag locator-bag POMs (ARCH-002) — has action methods", () => {
    expect(hasFinding(results, "ARCH-002")).toBe(false);
  });

  it("does NOT flag missing await (PW-FLAKE-008)", () => {
    expect(hasFinding(results, "PW-FLAKE-008")).toBe(false);
  });

  it("does NOT flag retrieval methods (PW-FLAKE-010)", () => {
    expect(hasFinding(results, "PW-FLAKE-010")).toBe(false);
  });

  it("has Playwright config detected", () => {
    expect(results.inventory.hasPlaywrightConfig).toBe(true);
  });

  it("detects properly configured CI", () => {
    // Good repo has Cache@2, playwright install, report publishing
    expect(hasFinding(results, "CI-011")).toBe(false);
  });

  it("counts individual test cases across files", () => {
    expect(results.inventory.testCases).toBeDefined();
    expect(results.inventory.testCases).toBe(5);
  });
});

// ─── Multi-config repo: discovers all Playwright configs ─────────────
describe("multi-config-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "multi-config-repo"), {
      checkOutdatedDependencies: false,
    });
  });

  it("detects hasPlaywrightConfig when configs are in a subdirectory", () => {
    expect(results.inventory.hasPlaywrightConfig).toBe(true);
  });

  it("discovers all 4 config files (standard + variants)", () => {
    expect(results.inventory.playwrightConfigPaths).toBeDefined();
    expect(results.inventory.playwrightConfigPaths!.length).toBe(4);
  });

  it("includes variant config names in playwrightConfigPaths", () => {
    const paths = results.inventory.playwrightConfigPaths!;
    expect(paths.some((p) => p.includes("playwright-ci.config"))).toBe(true);
    expect(paths.some((p) => p.includes("playwright-local.config"))).toBe(true);
    expect(paths.some((p) => p.includes("playwright-mobile.config"))).toBe(true);
  });

  it("picks the standard config (playwright.config.ts) as primary for extraction", () => {
    const pw = results.inventory.playwrightConfigSummary;
    expect(pw).toBeDefined();
    expect(pw!.configPath).toContain("playwright.config.ts");
    expect(pw!.configPath).not.toContain("playwright-ci");
    expect(pw!.configPath).not.toContain("playwright-local");
  });

  it("correctly extracts config details from the primary config", () => {
    const pw = results.inventory.playwrightConfigSummary!;
    expect(pw.workers).toBeDefined();
    expect(pw.retries).toBeDefined();
  });
});

// ─── Nested package.json: version extraction with multiple package.json files ──
describe("nested-pkg-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "nested-pkg-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("extracts Playwright version from root package.json despite nested package.json files", () => {
    expect(results.inventory.playwrightVersion).toBe("1.57.0");
  });

  it("detects Playwright framework", () => {
    expect(results.inventory.detectedFrameworks).toContain("playwright");
  });

  it("detects Playwright config", () => {
    expect(results.inventory.hasPlaywrightConfig).toBe(true);
  });
});

// ─── .auditrc filtering ─────────────────────────────────────────────
describe("auditrc filtering", () => {
  it("removes disabled rules from findings", async () => {
    const results = await scanRepo(path.join(FIXTURES, "bad-repo"), {
      checkOutdatedDependencies: false,
      auditConfig: {
        rules: {
          disabled: ["PW-FLAKE-001"],
        },
      },
    });
    expect(hasFinding(results, "PW-FLAKE-001")).toBe(false);
    // Other findings should still be present
    expect(results.findings.length).toBeGreaterThan(0);
  });

  it("applies severity overrides", async () => {
    const results = await scanRepo(path.join(FIXTURES, "bad-repo"), {
      checkOutdatedDependencies: false,
      auditConfig: {
        rules: {
          severityOverrides: { "PW-FLAKE-002": "low" },
        },
      },
    });
    const f = getFinding(results, "PW-FLAKE-002");
    if (f) expect(f.severity).toBe("low");
  });
});

// ─── Missing repo path: should return empty result, not throw ────────
describe("missing repo path", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "nonexistent-repo"));
  });

  it("returns a result instead of throwing", () => {
    expect(results).toBeDefined();
  });

  it("produces SCAN-MISSING-REPO finding", () => {
    expect(hasFinding(results, "SCAN-MISSING-REPO")).toBe(true);
    const f = getFinding(results, "SCAN-MISSING-REPO")!;
    expect(f.severity).toBe("high");
    expect(f.description).toContain("does not exist");
  });

  it("has empty inventory", () => {
    expect(results.inventory.totalFiles).toBe(0);
    expect(results.inventory.testFiles).toBe(0);
    expect(results.inventory.hasPlaywrightConfig).toBe(false);
  });
});

// ─── CI-012: List-style Azure variable detection ─────────────────────
describe("CI-012 — list-style Azure DevOps variables", () => {
  it("does NOT fire CI-012 when all pipelines set CI=true via list-style variables", async () => {
    const results = await scanRepo(
      path.join(FIXTURES, "ci-012-all-list-style-repo"),
      { checkOutdatedDependencies: false },
    );
    expect(hasFinding(results, "CI-012")).toBe(false);
  }, 30_000);

  it("fires CI-012 only for the pipeline missing CI=true (per-file evidence)", async () => {
    const results = await scanRepo(
      path.join(FIXTURES, "ci-012-list-style-repo"),
      { checkOutdatedDependencies: false },
    );
    expect(hasFinding(results, "CI-012")).toBe(true);
    const f = getFinding(results, "CI-012")!;
    // Evidence should reference only the pipeline missing CI, not the one that has it
    const pipelineEvidence = f.evidence.filter((e) =>
      e.snippet.includes("CI env var not explicitly set"),
    );
    expect(pipelineEvidence.length).toBe(1);
    expect(pipelineEvidence[0].file).toContain("pipeline-missing-ci");
  }, 30_000);

  it("still detects map-style CI: true (good-repo baseline)", async () => {
    const results = await scanRepo(path.join(FIXTURES, "good-repo"), {
      checkOutdatedDependencies: false,
    });
    expect(hasFinding(results, "CI-012")).toBe(false);
  }, 30_000);
});

// ─── Env-driven retries: no false-positive PW-INSIGHT-004 ────────────
describe("env-retries-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "env-retries-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("does NOT fire PW-INSIGHT-004 for parseInt(process.env.RETRIES!, 10)", () => {
    expect(hasFinding(results, "PW-INSIGHT-004")).toBe(false);
  });

  it("does NOT fire PW-INSIGHT-015 for env-driven retries", () => {
    expect(hasFinding(results, "PW-INSIGHT-015")).toBe(false);
  });
});
