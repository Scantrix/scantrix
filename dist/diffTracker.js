"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBaseline = loadBaseline;
exports.getGitInfo = getGitInfo;
exports.saveSnapshot = saveSnapshot;
exports.listSnapshots = listSnapshots;
exports.findLatestBaseline = findLatestBaseline;
exports.loadTrendHistory = loadTrendHistory;
exports.computeDiff = computeDiff;
exports.formatDiffMarkdown = formatDiffMarkdown;
exports.formatDiffConsoleSummary = formatDiffConsoleSummary;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
/**
 * Load a previous findings.json as the diff baseline.
 */
async function loadBaseline(baselinePath) {
    try {
        const raw = await promises_1.default.readFile(baselinePath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
/**
 * Attempt to read git branch and short commit SHA from a repo path.
 */
function getGitInfo(repoPath) {
    const opts = repoPath ? { cwd: repoPath } : undefined;
    try {
        const branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { ...opts, stdio: ["pipe", "pipe", "pipe"] })
            .toString().trim();
        const commit = (0, child_process_1.execSync)("git rev-parse --short HEAD", { ...opts, stdio: ["pipe", "pipe", "pipe"] })
            .toString().trim();
        return { branch, commit };
    }
    catch {
        return {};
    }
}
/**
 * Save a timestamped snapshot of findings to the output directory.
 * Creates `<outDir>/snapshots/<ISO-date>/findings.json` + `meta.json`.
 */
async function saveSnapshot(outDir, findings, optionsOrRiskScore) {
    // Backwards-compatible: accept bare riskScore number or options object
    const opts = typeof optionsOrRiskScore === "number"
        ? { riskScore: optionsOrRiskScore }
        : optionsOrRiskScore ?? {};
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotDir = path_1.default.join(outDir, "snapshots", timestamp);
    await promises_1.default.mkdir(snapshotDir, { recursive: true });
    await promises_1.default.writeFile(path_1.default.join(snapshotDir, "findings.json"), JSON.stringify(findings, null, 2), "utf8");
    const git = getGitInfo(opts.repoPath);
    const meta = {
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
    await promises_1.default.writeFile(path_1.default.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    return snapshotDir;
}
/**
 * List all snapshots in chronological order.
 */
async function listSnapshots(outDir) {
    const snapshotsDir = path_1.default.join(outDir, "snapshots");
    try {
        const entries = await promises_1.default.readdir(snapshotsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort() // ISO timestamp dirs sort chronologically as strings
            .map((name) => path_1.default.join(snapshotsDir, name));
    }
    catch {
        return [];
    }
}
/**
 * Find the latest snapshot directory (most recent previous scan).
 * Returns the path to the snapshot's findings.json, or undefined if none exist.
 */
async function findLatestBaseline(outDir) {
    const snapshots = await listSnapshots(outDir);
    if (snapshots.length === 0)
        return undefined;
    const latest = snapshots[snapshots.length - 1];
    const findingsPath = path_1.default.join(latest, "findings.json");
    try {
        await promises_1.default.access(findingsPath);
        return findingsPath;
    }
    catch {
        return undefined;
    }
}
/**
 * Load the trend history — severity counts over time for dashboard graphing.
 */
async function loadTrendHistory(outDir) {
    const snapshots = await listSnapshots(outDir);
    const trend = [];
    for (const dir of snapshots) {
        try {
            const raw = await promises_1.default.readFile(path_1.default.join(dir, "meta.json"), "utf8");
            trend.push(JSON.parse(raw));
        }
        catch {
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
function normalizeEvidenceKey(file, line) {
    return `${file.toLowerCase().replace(/\\/g, "/")}:${line}`;
}
/**
 * Compare two sets of findings by stable findingId.
 * Each findingId appears at most once per scan, so direct set comparison works.
 * Also computes evidence-level deltas for persistent findings.
 */
function computeDiff(previous, current, options) {
    const prevIds = new Set(previous.map((f) => f.findingId));
    const currIds = new Set(current.map((f) => f.findingId));
    const prevMap = new Map(previous.map((f) => [f.findingId, f]));
    const newFindings = current.filter((f) => !prevIds.has(f.findingId));
    const resolvedFindings = previous.filter((f) => !currIds.has(f.findingId));
    const persistentFindings = current.filter((f) => prevIds.has(f.findingId));
    // Compute evidence-level changes for persistent findings
    const evidenceChanges = [];
    for (const curr of persistentFindings) {
        const prev = prevMap.get(curr.findingId);
        if (!prev)
            continue;
        const prevKeys = new Set(prev.evidence.map((e) => normalizeEvidenceKey(e.file, e.line)));
        const currKeys = new Set(curr.evidence.map((e) => normalizeEvidenceKey(e.file, e.line)));
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
    let inventoryDelta;
    const bi = options?.baselineInventory;
    const ci = options?.currentInventory;
    if (bi && ci &&
        typeof bi.totalFiles === "number" && typeof ci.totalFiles === "number" &&
        typeof bi.testFiles === "number" && typeof ci.testFiles === "number") {
        inventoryDelta = {
            totalFiles: { prev: bi.totalFiles, curr: ci.totalFiles },
            testFiles: { prev: bi.testFiles, curr: ci.testFiles },
        };
    }
    const parts = [];
    if (newFindings.length > 0)
        parts.push(`${newFindings.length} new`);
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
function formatDiffMarkdown(diff) {
    const md = [];
    md.push(`## Trend Analysis (Compared to Baseline)`);
    md.push(``);
    if (diff.baselineTimestamp) {
        md.push(`> Baseline: ${diff.baselineTimestamp} → Current: ${diff.currentTimestamp}`);
        md.push(``);
    }
    // Inventory delta (file counts)
    if (diff.inventoryDelta) {
        const { totalFiles, testFiles } = diff.inventoryDelta;
        const fmtDelta = (prev, curr) => {
            const d = curr - prev;
            if (d === 0)
                return `${curr} (no change)`;
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
            const sev = f.severity === "high"
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
            const sev = f.severity === "high"
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
            const sev = f.severity === "high"
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
function formatDiffConsoleSummary(diff) {
    const parts = [];
    if (diff.newFindings.length > 0) {
        parts.push(`${diff.newFindings.length} new issue${diff.newFindings.length > 1 ? "s" : ""}`);
    }
    if (diff.resolvedFindings.length > 0) {
        parts.push(`${diff.resolvedFindings.length} resolved`);
    }
    if (diff.persistentFindings.length > 0) {
        parts.push(`${diff.persistentFindings.length} unchanged`);
    }
    if (parts.length === 0)
        return "[trend] First scan — no baseline to compare.";
    let line = `[trend] Delta since last audit: ${parts.join(", ")}.`;
    if (diff.inventoryDelta) {
        const { totalFiles, testFiles } = diff.inventoryDelta;
        const fd = totalFiles.curr - totalFiles.prev;
        const td = testFiles.curr - testFiles.prev;
        if (fd !== 0 || td !== 0) {
            const deltas = [];
            if (fd !== 0)
                deltas.push(`files ${totalFiles.prev}→${totalFiles.curr}`);
            if (td !== 0)
                deltas.push(`tests ${testFiles.prev}→${testFiles.curr}`);
            line += ` (codebase: ${deltas.join(", ")})`;
        }
    }
    return line;
}
