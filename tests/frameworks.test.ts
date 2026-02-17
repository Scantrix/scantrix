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

// ─── Cypress Repo: should detect Cypress framework + rules ──────────
describe("cypress-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "cypress-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("detects Cypress framework", () => {
    expect(results.inventory.detectedFrameworks).toContain("cypress");
  });

  it("populates cypressConfigSummary", () => {
    const cyConfig = results.inventory.cypressConfigSummary;
    expect(cyConfig).toBeDefined();
    expect(cyConfig!.baseUrl).toBe("http://localhost:3000");
    expect(cyConfig!.configFormat).toBe("ts");
    expect(cyConfig!.defaultCommandTimeout).toBe(10000);
    expect(cyConfig!.viewportWidth).toBe(1280);
    expect(cyConfig!.viewportHeight).toBe(720);
    expect(cyConfig!.video).toBe(false);
    expect(cyConfig!.retries?.runMode).toBe(2);
    expect(cyConfig!.retries?.openMode).toBe(0);
  });

  it("counts Cypress test files", () => {
    expect(results.inventory.cypressTestFiles).toBeGreaterThanOrEqual(2);
  });

  it("detects hard waits in Cypress (CY-FLAKE-001)", () => {
    expect(hasFinding(results, "CY-FLAKE-001")).toBe(true);
    const f = getFinding(results, "CY-FLAKE-001")!;
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
    expect(f.severity).toBe("high");
  });

  it("detects fragile CSS selectors (CY-FLAKE-002)", () => {
    expect(hasFinding(results, "CY-FLAKE-002")).toBe(true);
    const f = getFinding(results, "CY-FLAKE-002")!;
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("detects XPath in Cypress (CY-LOC-001)", () => {
    expect(hasFinding(results, "CY-LOC-001")).toBe(true);
  });

  it("does NOT flag missing baseUrl (it's configured)", () => {
    expect(hasFinding(results, "CY-PERF-001")).toBe(false);
  });
});

// ─── Cypress No-BaseUrl Repo: should flag CY-PERF-001 + CY-PERF-002 ─
describe("cypress-nobaseurl-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "cypress-nobaseurl-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("detects Cypress framework", () => {
    expect(results.inventory.detectedFrameworks).toContain("cypress");
  });

  it("flags missing baseUrl (CY-PERF-001)", () => {
    expect(hasFinding(results, "CY-PERF-001")).toBe(true);
  });

  it("flags excessive defaultCommandTimeout (CY-PERF-002)", () => {
    expect(hasFinding(results, "CY-PERF-002")).toBe(true);
  });

  it("detects hard waits (CY-FLAKE-001)", () => {
    expect(hasFinding(results, "CY-FLAKE-001")).toBe(true);
  });
});

// ─── Selenium Repo: should detect Selenium framework + rules ─────────
describe("selenium-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "selenium-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("detects Selenium framework", () => {
    expect(results.inventory.detectedFrameworks).toContain("selenium");
  });

  it("detects hard waits in Selenium (SE-FLAKE-001)", () => {
    expect(hasFinding(results, "SE-FLAKE-001")).toBe(true);
    const f = getFinding(results, "SE-FLAKE-001")!;
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
    expect(f.severity).toBe("high");
  });

  it("detects implicit waits (SE-FLAKE-002)", () => {
    expect(hasFinding(results, "SE-FLAKE-002")).toBe(true);
  });

  it("detects XPath selectors in Selenium (SE-LOC-001)", () => {
    expect(hasFinding(results, "SE-LOC-001")).toBe(true);
    const f = getFinding(results, "SE-LOC-001")!;
    expect(f.evidence.length).toBeGreaterThanOrEqual(3);
  });
});
