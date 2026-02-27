import minimist from "minimist";
import path from "path";
import { readFileSync } from "fs";
import { scanRepo } from "./scanner";
import { writeReportArtifacts } from "./report";
import { loadAuditConfig, generateDefaultConfig } from "./auditConfig";
import { saveSnapshot, findLatestBaseline, formatDiffConsoleSummary, computeDiff, loadBaseline, type SnapshotMeta } from "./diffTracker";
import { buildScanResult } from "./scanResult";
import { JsonSink } from "./sinks";
import fs from "fs/promises";

async function main() {
  const args = minimist(process.argv.slice(2));
  const subcommand = args._[0];

  // ── Subcommand: init ─────────────────────────────────────────────
  if (subcommand === "init") {
    const targetDir = args._[1] || ".";
    const configPath = path.join(path.resolve(targetDir), ".auditrc.json");
    try {
      await fs.access(configPath);
      console.error(`[init] .auditrc.json already exists at ${configPath}`);
      process.exit(1);
    } catch {
      // File doesn't exist — good
    }
    await fs.writeFile(configPath, generateDefaultConfig(), "utf8");
    console.log(`[init] Created .auditrc.json at ${configPath}`);
    return;
  }

  // ── Standard scan ────────────────────────────────────────────────
  const repoPath = args.repo || args._[0];
  const outDir = args.out || "./audit-out";
  const checkUpdates = Boolean(args.updates || args.update || args.checkUpdates);
  const configPath = args.config as string | undefined;   // --config .auditrc.json
  const diffPath = args.diff as string | undefined;       // --diff path/to/baseline/findings.json
  const formatArg = args.format as string | undefined;    // --format md,html,json,sarif,email
  const noTrend = Boolean(args["no-trend"]);              // --no-trend to disable auto-snapshot
  const jsonPath = args["json-path"] as string | undefined; // --json-path path/to/results.json

  if (!repoPath) {
    console.error(
      "Usage:\n" +
      "  scantrix <repoPath> [--out <dir>] [--updates] [--config <path>]\n" +
      "           [--diff <baseline.json>] [--format md,html,json,sarif,email]\n" +
      "           [--no-trend] [--json-path <path>]\n" +
      "\n" +
      "  scantrix init [dir]           Create a starter .auditrc.json\n" +
      "\n" +
      "Environment variables:\n" +
      "  SCANTRIX_JSON_PATH     Write canonical results JSON to this path\n"
    );
    process.exit(1);
  }

  const absRepo = path.resolve(repoPath);
  const absOut = path.resolve(outDir);

  // Read tool version from package.json (dist/cli.js → ../package.json)
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  const toolVersion: string = pkg.version ?? "0.0.0";

  // ── Load optional .auditrc.json ────────────────────────────────────
  const auditConfig = await loadAuditConfig(configPath ?? repoPath);

  // ── Parse --format flag ────────────────────────────────────────────
  const validFormats = ["md", "html", "json", "sarif", "email"] as const;
  type Fmt = typeof validFormats[number];
  let formats: Fmt[] | undefined;
  if (formatArg) {
    formats = formatArg.split(",").map(s => s.trim().toLowerCase()).filter(
      (s): s is Fmt => (validFormats as readonly string[]).includes(s)
    );
    if (formats.length === 0) formats = undefined; // fall back to all
  }

  // ── Resolve baseline for diff / trend tracking ─────────────────────
  let resolvedBaseline = diffPath;
  let baselineMeta: SnapshotMeta | undefined;
  if (!resolvedBaseline && !noTrend) {
    resolvedBaseline = await findLatestBaseline(outDir) ?? undefined;
    // Load the baseline snapshot's meta.json for inventory comparison
    if (resolvedBaseline) {
      try {
        const metaPath = path.join(path.dirname(resolvedBaseline), "meta.json");
        const metaRaw = await fs.readFile(metaPath, "utf8");
        baselineMeta = JSON.parse(metaRaw) as SnapshotMeta;
      } catch { /* no meta available — first scan or corrupt snapshot */ }
    }
  }

const startedAt = new Date().toISOString();

try {
  const results = await scanRepo(repoPath, {
    checkOutdatedDependencies: checkUpdates,
    auditConfig,
  });
  await writeReportArtifacts(outDir, results, {
    baselinePath: resolvedBaseline,
    baselineMeta,
    formats,
  });
  console.log(`[audit] wrote report to: ${outDir}`);

  // ── Auto-snapshot for trend tracking ───────────────────────────────
  if (!noTrend) {
    await saveSnapshot(outDir, results.findings, {
      inventory: results.inventory,
      repoPath: absRepo,
    });
    console.log(`[trend] Snapshot saved to ${outDir}/snapshots/`);
  }

  // ── Console trend summary ──────────────────────────────────────────
  if (resolvedBaseline) {
    const baseline = await loadBaseline(resolvedBaseline);
    if (baseline.length > 0) {
      const diff = computeDiff(baseline, results.findings, {
        baselineInventory: baselineMeta,
        currentInventory: results.inventory,
      });
      console.log(formatDiffConsoleSummary(diff));
    }
  } else if (!noTrend) {
    console.log("[trend] First scan — no baseline to compare.");
  }

  // ── Write canonical ScanResult JSON ────────────────────────────────
  const effectiveJsonPath = jsonPath ?? process.env.SCANTRIX_JSON_PATH;
  if (effectiveJsonPath) {
    const scanResult = buildScanResult(results, {
      version: toolVersion,
      startedAt,
      repoPath: absRepo,
    });
    const sink = new JsonSink(effectiveJsonPath);
    await sink.write(scanResult);
    console.log(`[sink:json] Results written to ${effectiveJsonPath}`);
  }

} catch (err) {
  console.error("[audit] FAILED:", err);

  // Write a minimal crash report so audit_summary.md is never empty again
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "audit_summary.md"),
    `# Playwright Reliability Audit (Crash)\n\nRepo: \`${repoPath}\`\n\nError:\n\n\`\`\`\n${String(err)}\n\`\`\`\n`,
    "utf8"
  );
  throw err;
}
}

main().catch((e) => {
  console.error(" Audit failed:", e);
  process.exit(1);
});
