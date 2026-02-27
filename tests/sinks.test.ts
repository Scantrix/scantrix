import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { buildScanResult, type ScanResult } from "../src/scanResult";
import {
  resolveSinkConfig,
  buildSinks,
  JsonSink,
  type SinkConfig,
} from "../src/sinks";
import type { ScanResults, Finding, Inventory } from "../src/scanner";

// ── Helpers ─────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingId: "PW-TEST-001",
    severity: "medium",
    title: "Test finding",
    description: "A test finding for unit tests",
    recommendation: "Fix it",
    evidence: [{ file: "test.ts", line: 1, snippet: "// bad" }],
    ...overrides,
  };
}

function makeInventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    totalFiles: 10,
    testFiles: 3,
    hasPlaywrightConfig: true,
    playwrightVersion: "1.40.0",
    detectedFrameworks: ["playwright"],
    ...overrides,
  };
}

function makeScanResults(overrides: Partial<ScanResults> = {}): ScanResults {
  return {
    repoPath: "/repos/test-repo",
    inventory: makeInventory(),
    findings: [
      makeFinding({ findingId: "PW-001", severity: "high" }),
      makeFinding({ findingId: "PW-002", severity: "medium" }),
      makeFinding({ findingId: "PW-003", severity: "low" }),
    ],
    gitBranch: "main",
    gitCommit: "abc1234",
    ...overrides,
  };
}

// ── buildScanResult ─────────────────────────────────────────────────

describe("buildScanResult", () => {
  it("produces a valid ScanResult with all required fields", () => {
    const raw = makeScanResults();
    const result = buildScanResult(raw, {
      version: "4.2.0",
      startedAt: "2026-02-20T10:00:00.000Z",
    });

    expect(result.tool).toBe("scantrix");
    expect(result.version).toBe("4.2.0");
    expect(result.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.startedAt).toBe("2026-02-20T10:00:00.000Z");
    expect(result.completedAt).toBeTruthy();
    expect(result.repo.path).toBe("/repos/test-repo");
    expect(result.repo.name).toBe("test-repo");
    expect(result.repo.branch).toBe("main");
    expect(result.repo.commit).toBe("abc1234");
  });

  it("computes correct summary counts", () => {
    const raw = makeScanResults();
    const result = buildScanResult(raw, {
      version: "1.0.0",
      startedAt: new Date().toISOString(),
    });

    expect(result.summary.total).toBe(3);
    expect(result.summary.high).toBe(1);
    expect(result.summary.medium).toBe(1);
    expect(result.summary.low).toBe(1);
    expect(result.summary.riskScore).toBeGreaterThan(0);
    expect(result.summary.riskGrade).toMatch(/^[A-F]$/);
  });

  it("uses overridden repoPath when provided", () => {
    const raw = makeScanResults({ repoPath: "relative/path" });
    const result = buildScanResult(raw, {
      version: "1.0.0",
      startedAt: new Date().toISOString(),
      repoPath: "/absolute/override",
    });

    expect(result.repo.path).toBe("/absolute/override");
    expect(result.repo.name).toBe("override");
  });

  it("handles empty findings", () => {
    const raw = makeScanResults({ findings: [] });
    const result = buildScanResult(raw, {
      version: "1.0.0",
      startedAt: new Date().toISOString(),
    });

    expect(result.summary.total).toBe(0);
    expect(result.summary.high).toBe(0);
    expect(result.summary.riskScore).toBe(100);
    expect(result.summary.riskGrade).toBe("A");
  });

  it("includes inventory in the result", () => {
    const inv = makeInventory({ totalFiles: 42, testFiles: 7 });
    const raw = makeScanResults({ inventory: inv });
    const result = buildScanResult(raw, {
      version: "1.0.0",
      startedAt: new Date().toISOString(),
    });

    expect(result.inventory.totalFiles).toBe(42);
    expect(result.inventory.testFiles).toBe(7);
  });

  it("generates unique runIds across calls", () => {
    const raw = makeScanResults();
    const a = buildScanResult(raw, { version: "1.0.0", startedAt: new Date().toISOString() });
    const b = buildScanResult(raw, { version: "1.0.0", startedAt: new Date().toISOString() });
    expect(a.runId).not.toBe(b.runId);
  });
});

// ── resolveSinkConfig ───────────────────────────────────────────────

describe("resolveSinkConfig", () => {
  const envBackup: Record<string, string | undefined> = {};
  const SINK_VARS = [
    "SCANTRIX_JSON_PATH",
  ];

  beforeEach(() => {
    for (const key of SINK_VARS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SINK_VARS) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("defaults to no jsonPath when no env/overrides", () => {
    const config = resolveSinkConfig();
    expect(config.jsonPath).toBeUndefined();
  });

  it("reads jsonPath from env var", () => {
    process.env.SCANTRIX_JSON_PATH = "/out/result.json";
    const config = resolveSinkConfig();
    expect(config.jsonPath).toBe("/out/result.json");
  });

  it("CLI overrides take precedence over env vars", () => {
    process.env.SCANTRIX_JSON_PATH = "/from/env.json";
    const config = resolveSinkConfig({
      jsonPath: "/from/override.json",
    });
    expect(config.jsonPath).toBe("/from/override.json");
  });
});

// ── buildSinks ──────────────────────────────────────────────────────

describe("buildSinks", () => {
  it("returns empty array with no paths", () => {
    const sinks = buildSinks({});
    expect(sinks).toHaveLength(0);
  });

  it("returns JsonSink when jsonPath is set", () => {
    const sinks = buildSinks({ jsonPath: "/out/result.json" });
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("json");
  });
});

// ── JsonSink integration ────────────────────────────────────────────

describe("JsonSink", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scantrix-json-sink-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid JSON file with all ScanResult fields", async () => {
    const raw = makeScanResults();
    const scanResult = buildScanResult(raw, {
      version: "4.2.0",
      startedAt: "2026-02-20T10:00:00.000Z",
    });

    const outPath = path.join(tmpDir, "nested", "scantrix-results.json");
    const sink = new JsonSink(outPath);
    await sink.write(scanResult);

    const written = JSON.parse(await fs.readFile(outPath, "utf8")) as ScanResult;
    expect(written.tool).toBe("scantrix");
    expect(written.version).toBe("4.2.0");
    expect(written.runId).toBe(scanResult.runId);
    expect(written.findings).toHaveLength(3);
    expect(written.summary.total).toBe(3);
    expect(written.repo.name).toBe("test-repo");
    expect(written.inventory.totalFiles).toBe(10);
  });

  it("creates parent directories if they do not exist", async () => {
    const outPath = path.join(tmpDir, "deep", "nested", "dir", "result.json");
    const sink = new JsonSink(outPath);
    const scanResult = buildScanResult(makeScanResults(), {
      version: "1.0.0",
      startedAt: new Date().toISOString(),
    });
    await sink.write(scanResult);

    const stat = await fs.stat(outPath);
    expect(stat.isFile()).toBe(true);
  });
});
