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

  // ── Insights ───────────────────────────────────────────────────
  it("produces insight for hardcoded URLs + no baseURL (PW-INSIGHT-010)", () => {
    expect(hasFinding(results, "PW-INSIGHT-010")).toBe(true);
  });

  // ── Severity ───────────────────────────────────────────────────
  it("marks PW-FLAKE-001 as high severity", () => {
    const f = getFinding(results, "PW-FLAKE-001");
    expect(f?.severity).toBe("high");
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
    expect(results.inventory.testFiles).toBe(6);
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

  it("has Playwright config detected", () => {
    expect(results.inventory.hasPlaywrightConfig).toBe(true);
  });

  it("detects properly configured CI", () => {
    // Good repo has Cache@2, playwright install, report publishing
    expect(hasFinding(results, "CI-011")).toBe(false);
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
