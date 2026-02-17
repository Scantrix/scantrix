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

// ─── Deprecated API Detection ────────────────────────────────────────
describe("deprecated-repo", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "deprecated-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("detects deprecated selector engine methods (PW-DEPREC-001)", () => {
    expect(hasFinding(results, "PW-DEPREC-001")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-001")!;
    expect(f.severity).toBe("medium");
    // Should detect $, $$, $eval, $$eval
    expect(f.evidence.length).toBeGreaterThanOrEqual(4);
    expect(f.recommendation).toContain("page.locator()");
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("detects deprecated page.action(selector) methods (PW-DEPREC-002)", () => {
    expect(hasFinding(results, "PW-DEPREC-002")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-002")!;
    expect(f.severity).toBe("medium");
    // Should detect click, dblclick, fill, type, hover, check, uncheck, selectOption, focus, press, tap, etc.
    expect(f.evidence.length).toBeGreaterThanOrEqual(10);
    expect(f.recommendation).toContain("page.locator('sel').click()");
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("detects deprecated wait methods (PW-DEPREC-003)", () => {
    expect(hasFinding(results, "PW-DEPREC-003")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-003")!;
    expect(f.severity).toBe("medium");
    // waitForNavigation + waitForSelector
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
    expect(f.recommendation).toContain("page.waitForURL");
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("detects test.describe.serial usage (PW-DEPREC-004)", () => {
    expect(hasFinding(results, "PW-DEPREC-004")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-004")!;
    expect(f.severity).toBe("medium");
    // Only serial is flagged now (parallel is not deprecated per Playwright docs)
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    expect(f.recommendation).toContain("test.describe.configure");
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("detects deprecated snapshotDir config (PW-DEPREC-005)", () => {
    expect(hasFinding(results, "PW-DEPREC-005")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-005")!;
    expect(f.severity).toBe("low");
    expect(f.recommendation).toContain("snapshotPathTemplate");
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("detects deprecated BrowserContext methods (PW-DEPREC-006)", () => {
    expect(hasFinding(results, "PW-DEPREC-006")).toBe(true);
    const f = getFinding(results, "PW-DEPREC-006")!;
    expect(f.severity).toBe("low");
    expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    expect(f.recommendation).toContain("https://playwright.dev/");
  });

  it("includes doc URLs in all PW-DEPREC recommendations", () => {
    const deprecFindings = results.findings.filter(f => f.findingId.startsWith("PW-DEPREC-"));
    expect(deprecFindings.length).toBeGreaterThanOrEqual(6);
    for (const f of deprecFindings) {
      expect(f.recommendation).toContain("https://playwright.dev/");
    }
  });
});

// ─── DEP-002: npm-deprecated package detection ──────────────────────
describe("deprecated-repo DEP-002 (non-deprecated packages)", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "deprecated-repo"), {
      checkOutdatedDependencies: true,
    });
  }, 60_000);

  it("does NOT flag DEP-002 when packages are not deprecated on npm", () => {
    // @playwright/test is not deprecated, so DEP-002 should not fire
    expect(hasFinding(results, "DEP-002")).toBe(false);
  });
});

// ─── Good Repo: should NOT trigger deprecated findings ───────────────
describe("good-repo does not trigger deprecated rules", () => {
  let results: ScanResults;

  beforeAll(async () => {
    results = await scanRepo(path.join(FIXTURES, "good-repo"), {
      checkOutdatedDependencies: false,
    });
  }, 30_000);

  it("does not flag PW-DEPREC-001 in clean code", () => {
    expect(hasFinding(results, "PW-DEPREC-001")).toBe(false);
  });

  it("does not flag PW-DEPREC-002 in clean code", () => {
    expect(hasFinding(results, "PW-DEPREC-002")).toBe(false);
  });

  it("does not flag PW-DEPREC-003 in clean code", () => {
    expect(hasFinding(results, "PW-DEPREC-003")).toBe(false);
  });

  it("does not flag PW-DEPREC-004 in clean code", () => {
    expect(hasFinding(results, "PW-DEPREC-004")).toBe(false);
  });
});
