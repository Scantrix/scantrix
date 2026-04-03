import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  computeDiff,
  saveSnapshot,
  listSnapshots,
  findLatestBaseline,
  loadSnapshotHistory,
  formatDiffMarkdown,
  formatDiffConsoleSummary,
} from "../src/diffTracker";

/** Helper: create a temp dir for snapshot tests */
async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "qaverity-test-"));
}

/** Helper: create minimal Finding objects */
function finding(
  id: string,
  severity: "high" | "medium" | "low" = "medium",
  evidence: Array<{ file: string; line: number; code?: string }> = [],
) {
  return {
    findingId: id,
    severity,
    title: `Title for ${id}`,
    description: "",
    recommendation: "",
    evidence: evidence.map((e) => ({
      file: e.file,
      line: e.line,
      code: e.code ?? "",
    })),
  } as any;
}

describe("saveSnapshot + listSnapshots + findLatestBaseline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves findings.json and meta.json into a timestamped directory", async () => {
    const findings = [finding("PW-001", "high"), finding("PW-002", "low")];
    const snapshotDir = await saveSnapshot(tmpDir, findings, 42);

    const findingsRaw = await fs.readFile(
      path.join(snapshotDir, "findings.json"),
      "utf8",
    );
    const metaRaw = await fs.readFile(
      path.join(snapshotDir, "meta.json"),
      "utf8",
    );

    const savedFindings = JSON.parse(findingsRaw);
    const meta = JSON.parse(metaRaw);

    expect(savedFindings).toHaveLength(2);
    expect(meta.findingsCount).toBe(2);
    expect(meta.highCount).toBe(1);
    expect(meta.lowCount).toBe(1);
    expect(meta.riskScore).toBe(42);
    expect(meta.timestamp).toBeDefined();
  });

  it("saves inventory and git metadata with options object", async () => {
    const findings = [finding("PW-001", "high")];
    const snapshotDir = await saveSnapshot(tmpDir, findings, {
      riskScore: 55,
      inventory: { totalFiles: 1336, testFiles: 981 } as any,
    });

    const metaRaw = await fs.readFile(
      path.join(snapshotDir, "meta.json"),
      "utf8",
    );
    const meta = JSON.parse(metaRaw);

    expect(meta.riskScore).toBe(55);
    expect(meta.totalFiles).toBe(1336);
    expect(meta.testFiles).toBe(981);
    expect(meta.timestamp).toBeDefined();
  });

  it("listSnapshots returns empty for fresh dir", async () => {
    const list = await listSnapshots(tmpDir);
    expect(list).toEqual([]);
  });

  it("listSnapshots returns directories in chronological order", async () => {
    await saveSnapshot(tmpDir, [finding("A")]);
    // small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 20));
    await saveSnapshot(tmpDir, [finding("B")]);

    const list = await listSnapshots(tmpDir);
    expect(list).toHaveLength(2);
    // first entry should be chronologically before the second
    expect(list[0] < list[1]).toBe(true);
  });

  it("findLatestBaseline returns the most recent findings.json", async () => {
    await saveSnapshot(tmpDir, [finding("OLD")]);
    await new Promise((r) => setTimeout(r, 20));
    await saveSnapshot(tmpDir, [finding("NEW")]);

    const baselinePath = await findLatestBaseline(tmpDir);
    expect(baselinePath).toBeDefined();
    expect(baselinePath!.endsWith("findings.json")).toBe(true);

    const raw = await fs.readFile(baselinePath!, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed[0].findingId).toBe("NEW");
  });

  it("findLatestBaseline returns undefined when no snapshots", async () => {
    const result = await findLatestBaseline(tmpDir);
    expect(result).toBeUndefined();
  });
});

describe("loadSnapshotHistory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads all snapshot meta.json files in order", async () => {
    await saveSnapshot(tmpDir, [finding("A", "high")], 10);
    await new Promise((r) => setTimeout(r, 20));
    await saveSnapshot(
      tmpDir,
      [finding("A", "high"), finding("B", "medium")],
      25,
    );

    const history = await loadSnapshotHistory(tmpDir);
    expect(history).toHaveLength(2);
    expect(history[0].findingsCount).toBe(1);
    expect(history[1].findingsCount).toBe(2);
    expect(history[0].riskScore).toBe(10);
    expect(history[1].riskScore).toBe(25);
  });

  it("returns empty array when no snapshots", async () => {
    const history = await loadSnapshotHistory(tmpDir);
    expect(history).toEqual([]);
  });
});

describe("computeDiff – evidence changes", () => {
  it("detects added and removed evidence locations", () => {
    const prev = [
      finding("PW-001", "high", [
        { file: "a.spec.ts", line: 10 },
        { file: "b.spec.ts", line: 20 },
      ]),
    ];
    const curr = [
      finding("PW-001", "high", [
        { file: "a.spec.ts", line: 10 },
        { file: "c.spec.ts", line: 30 },
        { file: "d.spec.ts", line: 40 },
      ]),
    ];

    const diff = computeDiff(prev, curr);
    expect(diff.persistentFindings).toHaveLength(1);
    expect(diff.evidenceChanges).toHaveLength(1);
    expect(diff.evidenceChanges[0].findingId).toBe("PW-001");
    expect(diff.evidenceChanges[0].addedEvidence).toBe(2); // c.spec.ts:30, d.spec.ts:40
    expect(diff.evidenceChanges[0].removedEvidence).toBe(1); // b.spec.ts:20
  });

  it("omits evidence change entry when evidence is identical", () => {
    const prev = [finding("PW-001", "high", [{ file: "a.ts", line: 5 }])];
    const curr = [finding("PW-001", "high", [{ file: "a.ts", line: 5 }])];

    const diff = computeDiff(prev, curr);
    expect(diff.evidenceChanges).toHaveLength(0);
  });

  it("handles Windows path casing differences without phantom evidence changes", () => {
    const prev = [
      finding("PW-001", "high", [
        { file: "c:/Repositories/Repo/test.spec.ts", line: 10 },
        { file: "c:/Repositories/Repo/other.spec.ts", line: 20 },
      ]),
    ];
    const curr = [
      finding("PW-001", "high", [
        { file: "C:/Repositories/Repo/test.spec.ts", line: 10 },
        { file: "C:/Repositories/Repo/other.spec.ts", line: 20 },
      ]),
    ];

    const diff = computeDiff(prev, curr);
    expect(diff.evidenceChanges).toHaveLength(0);
  });
});

describe("computeDiff – inventory delta", () => {
  it("includes inventory delta when both sides have inventory data", () => {
    const prev = [finding("PW-001")];
    const curr = [finding("PW-001")];

    const diff = computeDiff(prev, curr, {
      baselineInventory: { totalFiles: 1200, testFiles: 800 },
      currentInventory: { totalFiles: 1336, testFiles: 981 },
    });

    expect(diff.inventoryDelta).toBeDefined();
    expect(diff.inventoryDelta!.totalFiles).toEqual({ prev: 1200, curr: 1336 });
    expect(diff.inventoryDelta!.testFiles).toEqual({ prev: 800, curr: 981 });
  });

  it("omits inventory delta when baseline has no inventory data", () => {
    const diff = computeDiff([finding("A")], [finding("A")], {
      baselineInventory: undefined,
      currentInventory: { totalFiles: 100, testFiles: 50 },
    });
    expect(diff.inventoryDelta).toBeUndefined();
  });
});

describe("formatDiffConsoleSummary", () => {
  it("returns first-scan message when no changes", () => {
    const diff = computeDiff([], []);
    const msg = formatDiffConsoleSummary(diff);
    expect(msg).toContain("First scan");
  });

  it("includes new and resolved counts", () => {
    const prev = [finding("OLD")];
    const curr = [finding("NEW")];

    const diff = computeDiff(prev, curr);
    const msg = formatDiffConsoleSummary(diff);
    expect(msg).toContain("1 new");
    expect(msg).toContain("1 resolved");
  });

  it("includes unchanged count for persistent findings", () => {
    const prev = [finding("SAME"), finding("OLD")];
    const curr = [finding("SAME"), finding("NEW")];

    const diff = computeDiff(prev, curr);
    const msg = formatDiffConsoleSummary(diff);
    expect(msg).toContain("1 unchanged");
  });

  it("includes codebase file count change when inventory delta present", () => {
    const diff = computeDiff([finding("A")], [finding("A")], {
      baselineInventory: { totalFiles: 1200, testFiles: 800 },
      currentInventory: { totalFiles: 1336, testFiles: 981 },
    });
    const msg = formatDiffConsoleSummary(diff);
    expect(msg).toContain("1200");
    expect(msg).toContain("1336");
  });
});

describe("formatDiffMarkdown", () => {
  it("renders markdown with all sections", () => {
    const prev = [
      finding("PW-001", "high", [{ file: "a.ts", line: 1 }]),
      finding("PW-002", "medium"),
    ];
    const curr = [
      finding("PW-001", "high", [
        { file: "a.ts", line: 1 },
        { file: "b.ts", line: 2 },
      ]),
      finding("PW-003", "low"),
    ];

    const diff = computeDiff(prev, curr);
    diff.baselineTimestamp = "2025-01-01T00:00:00.000Z";
    const md = formatDiffMarkdown(diff);

    expect(md).toContain("Change Analysis");
    expect(md).toContain("🆕 New Issues");
    expect(md).toContain("PW-003");
    expect(md).toContain("✅ Resolved Issues");
    expect(md).toContain("PW-002");
    expect(md).toContain("🔄 Persistent Issues");
    expect(md).toContain("PW-001");
    expect(md).toContain("📊 Evidence Changes");
    expect(md).toContain("+1");
  });

  it("includes baseline timestamp when provided", () => {
    const diff = computeDiff([], [finding("NEW")]);
    diff.baselineTimestamp = "2025-06-01T12:00:00.000Z";
    const md = formatDiffMarkdown(diff);
    expect(md).toContain("2025-06-01");
  });
});
