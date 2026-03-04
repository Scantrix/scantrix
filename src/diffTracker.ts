import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import type { Finding, Inventory } from "./scanner";

type InventoryDelta = {
  totalFiles: { prev: number; curr: number };
  testFiles: { prev: number; curr: number };
};

type DiffResult = {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  persistentFindings: Finding[];
  summary: string;
  /** ISO timestamp of the baseline scan (from snapshot dir name) */
  baselineTimestamp?: string;
  /** ISO timestamp of the current scan */
  currentTimestamp: string;
  /** Evidence-level changes for persistent findings (same rule but different files/lines) */
  evidenceChanges: EvidenceChange[];
  /** Inventory-level delta between baseline and current scan */
  inventoryDelta?: InventoryDelta;
};

type EvidenceChange = {
  findingId: string;
  title: string;
  addedEvidence: number;
  removedEvidence: number;
};

export type SnapshotMeta = {
  timestamp: string;
  findingsCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  riskScore?: number;
  /** Inventory summary for tracking codebase-level changes across scans */
  totalFiles?: number;
  testFiles?: number;
  /** Git branch at time of scan */
  gitBranch?: string;
  /** Git commit SHA at time of scan */
  gitCommit?: string;
};

/**
 * Load a previous findings.json as the diff baseline.
 */
export async function loadBaseline(baselinePath: string): Promise<Finding[]> {
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    return JSON.parse(raw) as Finding[];
  } catch {
    return [];
  }
}

/**
 * Attempt to read git branch and short commit SHA from a repo path.
 */
export function getGitInfo(repoPath?: string): { branch?: string; commit?: string } {
  const opts = repoPath ? { cwd: repoPath } : undefined;
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { ...opts, stdio: ["pipe", "pipe", "pipe"] })
      .toString().trim();
    const commit = execSync("git rev-parse --short HEAD", { ...opts, stdio: ["pipe", "pipe", "pipe"] })
      .toString().trim();
    return { branch, commit };
  } catch {
    return {};
  }
}

type SaveSnapshotOptions = {
  riskScore?: number;
  inventory?: Inventory;
  /** Path to the scanned repo (used for git metadata) */
  repoPath?: string;
};

/**
 * Save a timestamped snapshot of findings to the output directory.
 * Creates `<outDir>/snapshots/<ISO-date>/findings.json` + `meta.json`.
 */
export async function saveSnapshot(
  outDir: string,
  findings: Finding[],
  optionsOrRiskScore?: SaveSnapshotOptions | number,
): Promise<string> {
  // Backwards-compatible: accept bare riskScore number or options object
  const opts: SaveSnapshotOptions = typeof optionsOrRiskScore === "number"
    ? { riskScore: optionsOrRiskScore }
    : optionsOrRiskScore ?? {};

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotDir = path.join(outDir, "snapshots", timestamp);
  await fs.mkdir(snapshotDir, { recursive: true });

  await fs.writeFile(
    path.join(snapshotDir, "findings.json"),
    JSON.stringify(findings, null, 2),
    "utf8",
  );

  const git = getGitInfo(opts.repoPath);

  const meta: SnapshotMeta = {
    timestamp: new Date().toISOString(),
    findingsCount: findings.length,
    highCount: findings.filter((f) => f.severity === "high").length,
    mediumCount: findings.filter((f) => f.severity === "medium").length,
    lowCount: findings.filter((f) => f.severity === "low").length,
    riskScore: opts.riskScore,
    totalFiles: opts.inventory?.totalFiles,
    testFiles: opts.inventory?.testFiles,
    gitBranch: git.branch,
    gitCommit: git.commit,
  };

  await fs.writeFile(
    path.join(snapshotDir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  return snapshotDir;
}

/**
 * List all snapshots in chronological order.
 */
export async function listSnapshots(outDir: string): Promise<string[]> {
  const snapshotsDir = path.join(outDir, "snapshots");
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort() // ISO timestamp dirs sort chronologically as strings
      .map((name) => path.join(snapshotsDir, name));
  } catch {
    return [];
  }
}

/**
 * Find the latest snapshot directory (most recent previous scan).
 * Returns the path to the snapshot's findings.json, or undefined if none exist.
 */
export async function findLatestBaseline(
  outDir: string,
): Promise<string | undefined> {
  const snapshots = await listSnapshots(outDir);
  if (snapshots.length === 0) return undefined;
  const latest = snapshots[snapshots.length - 1];
  const findingsPath = path.join(latest, "findings.json");
  try {
    await fs.access(findingsPath);
    return findingsPath;
  } catch {
    return undefined;
  }
}

/**
 * Load the trend history — severity counts over time for trend analysis.
 */
export async function loadTrendHistory(
  outDir: string,
): Promise<SnapshotMeta[]> {
  const snapshots = await listSnapshots(outDir);
  const trend: SnapshotMeta[] = [];
  for (const dir of snapshots) {
    try {
      const raw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
      trend.push(JSON.parse(raw) as SnapshotMeta);
    } catch {
      // skip corrupt snapshots
    }
  }
  return trend;
}

/**
 * Normalise an evidence key for comparison.
 * On Windows the drive-letter casing can vary between runs,
 * so we lower-case the whole key to avoid phantom diffs.
 */
function normalizeEvidenceKey(file: string, line: number): string {
  return `${file.toLowerCase().replace(/\\/g, "/")}:${line}`;
}

type ComputeDiffOptions = {
  /** Baseline inventory (from previous meta.json) */
  baselineInventory?: { totalFiles?: number; testFiles?: number };
  /** Current inventory from this scan */
  currentInventory?: { totalFiles?: number; testFiles?: number };
};

/**
 * Compare two sets of findings by stable findingId.
 * Each findingId appears at most once per scan, so direct set comparison works.
 * Also computes evidence-level deltas for persistent findings.
 */
export function computeDiff(
  previous: Finding[],
  current: Finding[],
  options?: ComputeDiffOptions,
): DiffResult {
  const prevIds = new Set(previous.map((f) => f.findingId));
  const currIds = new Set(current.map((f) => f.findingId));
  const prevMap = new Map(previous.map((f) => [f.findingId, f]));

  const newFindings = current.filter((f) => !prevIds.has(f.findingId));
  const resolvedFindings = previous.filter((f) => !currIds.has(f.findingId));
  const persistentFindings = current.filter((f) => prevIds.has(f.findingId));

  // Compute evidence-level changes for persistent findings
  const evidenceChanges: EvidenceChange[] = [];
  for (const curr of persistentFindings) {
    const prev = prevMap.get(curr.findingId);
    if (!prev) continue;
    const prevKeys = new Set(
      prev.evidence.map((e) => normalizeEvidenceKey(e.file, e.line)),
    );
    const currKeys = new Set(
      curr.evidence.map((e) => normalizeEvidenceKey(e.file, e.line)),
    );
    const added = [...currKeys].filter((k) => !prevKeys.has(k)).length;
    const removed = [...prevKeys].filter((k) => !currKeys.has(k)).length;
    if (added > 0 || removed > 0) {
      evidenceChanges.push({
        findingId: curr.findingId,
        title: curr.title,
        addedEvidence: added,
        removedEvidence: removed,
      });
    }
  }

  // Compute inventory delta if both sides are available
  let inventoryDelta: InventoryDelta | undefined;
  const bi = options?.baselineInventory;
  const ci = options?.currentInventory;
  if (
    bi && ci &&
    typeof bi.totalFiles === "number" && typeof ci.totalFiles === "number" &&
    typeof bi.testFiles === "number" && typeof ci.testFiles === "number"
  ) {
    inventoryDelta = {
      totalFiles: { prev: bi.totalFiles, curr: ci.totalFiles },
      testFiles: { prev: bi.testFiles, curr: ci.testFiles },
    };
  }

  const parts: string[] = [];
  if (newFindings.length > 0) parts.push(`${newFindings.length} new`);
  if (resolvedFindings.length > 0)
    parts.push(`${resolvedFindings.length} resolved`);
  if (persistentFindings.length > 0)
    parts.push(`${persistentFindings.length} persistent`);

  const summary = parts.length ? parts.join(", ") : "No changes";
  return {
    newFindings,
    resolvedFindings,
    persistentFindings,
    summary,
    currentTimestamp: new Date().toISOString(),
    evidenceChanges,
    inventoryDelta,
  };
}

/**
 * Render the diff as a Markdown section suitable for inclusion in the report.
 */
export function formatDiffMarkdown(diff: DiffResult): string {
  const md: string[] = [];

  md.push(`## Trend Analysis (Compared to Baseline)`);
  md.push(``);
  if (diff.baselineTimestamp) {
    md.push(`> Baseline: ${diff.baselineTimestamp} → Current: ${diff.currentTimestamp}`);
    md.push(``);
  }

  // Inventory delta (file counts)
  if (diff.inventoryDelta) {
    const { totalFiles, testFiles } = diff.inventoryDelta;
    const fmtDelta = (prev: number, curr: number) => {
      const d = curr - prev;
      if (d === 0) return `${curr} (no change)`;
      return `${prev} → ${curr} (${d > 0 ? "+" : ""}${d})`;
    };
    md.push(`| Metric | Change |`);
    md.push(`|--------|--------|`);
    md.push(`| Total files scanned | ${fmtDelta(totalFiles.prev, totalFiles.curr)} |`);
    md.push(`| Test files | ${fmtDelta(testFiles.prev, testFiles.curr)} |`);
    md.push(``);
  }

  md.push(`**Summary:** ${diff.summary}`);
  md.push(``);

  if (diff.newFindings.length > 0) {
    md.push(`### 🆕 New Issues`);
    md.push(``);
    md.push(`| ID | Title | Severity |`);
    md.push(`|----|-------|----------|`);
    for (const f of diff.newFindings) {
      const sev =
        f.severity === "high"
          ? "🔴 High"
          : f.severity === "medium"
          ? "🟠 Medium"
          : "🟡 Low";
      md.push(`| \`${f.findingId}\` | ${f.title} | ${sev} |`);
    }
    md.push(``);
  }

  if (diff.resolvedFindings.length > 0) {
    md.push(`### ✅ Resolved Issues`);
    md.push(``);
    md.push(`| ID | Title | Severity |`);
    md.push(`|----|-------|----------|`);
    for (const f of diff.resolvedFindings) {
      const sev =
        f.severity === "high"
          ? "🔴 High"
          : f.severity === "medium"
          ? "🟠 Medium"
          : "🟡 Low";
      md.push(`| \`${f.findingId}\` | ${f.title} | ${sev} |`);
    }
    md.push(``);
  }

  if (diff.persistentFindings.length > 0) {
    md.push(`### 🔄 Persistent Issues (${diff.persistentFindings.length})`);
    md.push(``);
    for (const f of diff.persistentFindings) {
      const sev =
        f.severity === "high"
          ? "🔴"
          : f.severity === "medium"
          ? "🟠"
          : "🟡";
      md.push(`- ${sev} **${f.findingId}**: ${f.title}`);
    }
    md.push(``);
  }

  if (diff.evidenceChanges.length > 0) {
    md.push(`### 📊 Evidence Changes (within persistent findings)`);
    md.push(``);
    md.push(`| ID | Title | New Evidence | Removed Evidence |`);
    md.push(`|----|-------|:-----------:|:---------------:|`);
    for (const c of diff.evidenceChanges) {
      md.push(`| \`${c.findingId}\` | ${c.title} | +${c.addedEvidence} | -${c.removedEvidence} |`);
    }
    md.push(``);
  }

  return md.join("\n");
}

/**
 * Format a one-line console summary for the diff.
 */
export function formatDiffConsoleSummary(diff: DiffResult): string {
  const parts: string[] = [];
  if (diff.newFindings.length > 0) {
    parts.push(`${diff.newFindings.length} new issue${diff.newFindings.length > 1 ? "s" : ""}`);
  }
  if (diff.resolvedFindings.length > 0) {
    parts.push(`${diff.resolvedFindings.length} resolved`);
  }
  if (diff.persistentFindings.length > 0) {
    parts.push(`${diff.persistentFindings.length} unchanged`);
  }
  if (parts.length === 0) return "[trend] First scan — no baseline to compare.";

  let line = `[trend] Delta since last audit: ${parts.join(", ")}.`;
  if (diff.inventoryDelta) {
    const { totalFiles, testFiles } = diff.inventoryDelta;
    const fd = totalFiles.curr - totalFiles.prev;
    const td = testFiles.curr - testFiles.prev;
    if (fd !== 0 || td !== 0) {
      const deltas: string[] = [];
      if (fd !== 0) deltas.push(`files ${totalFiles.prev}→${totalFiles.curr}`);
      if (td !== 0) deltas.push(`tests ${testFiles.prev}→${testFiles.curr}`);
      line += ` (codebase: ${deltas.join(", ")})`;
    }
  }
  return line;
}
