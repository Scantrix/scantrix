import minimist from "minimist";
import path from "path";
import { readFileSync } from "fs";
import { scanRepo } from "./scanner";
import { writeReportArtifacts } from "./report";
import { loadAuditConfig, generateDefaultConfig } from "./auditConfig";
import { saveSnapshot, findLatestBaseline, formatDiffConsoleSummary, computeDiff, loadBaseline, type SnapshotMeta } from "./diffTracker";
import { buildScanResult } from "./scanResult";
import { resolveSinkConfig, buildSinks, type SinkMode } from "./sinks";
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

  // ── Subcommand: push ─────────────────────────────────────────────
  if (subcommand === "push") {
    const findingsPath = args._[1] || "./audit-out/findings.json";
    const apiUrl = (args.url as string) || process.env.SCANTRIX_API_URL || process.env.QAVERITY_API_URL || "https://api.scantrix.com";
    const apiKey = (args.key as string) || process.env.SCANTRIX_API_KEY || process.env.QAVERITY_API_KEY;
    const repoName = (args.repo as string) || process.env.SCANTRIX_REPO_NAME || process.env.QAVERITY_REPO_NAME;

    // Emit deprecation warnings for legacy env vars
    if (!process.env.SCANTRIX_API_URL && process.env.QAVERITY_API_URL) console.warn("[deprecation] QAVERITY_API_URL is deprecated — use SCANTRIX_API_URL");
    if (!process.env.SCANTRIX_API_KEY && process.env.QAVERITY_API_KEY) console.warn("[deprecation] QAVERITY_API_KEY is deprecated — use SCANTRIX_API_KEY");
    if (!process.env.SCANTRIX_REPO_NAME && process.env.QAVERITY_REPO_NAME) console.warn("[deprecation] QAVERITY_REPO_NAME is deprecated — use SCANTRIX_REPO_NAME");

    if (!apiKey) {
      console.error("[push] Missing API key. Set --key or SCANTRIX_API_KEY env var.");
      process.exit(1);
    }

    try {
      const raw = await fs.readFile(path.resolve(findingsPath), "utf8");
      const payload = JSON.parse(raw);

      // findings.json may be a wrapped object { repoName, findings } or a plain array
      const isWrapped = payload && !Array.isArray(payload) && Array.isArray(payload.findings);
      const findings = isWrapped ? payload.findings : payload;
      const effectiveRepo = repoName || (isWrapped ? payload.repoName : undefined);

      // Attempt to load repo_inventory.json from the same directory
      let inventory: Record<string, any> | undefined;
      try {
        const invPath = path.join(path.dirname(path.resolve(findingsPath)), "repo_inventory.json");
        const invRaw = await fs.readFile(invPath, "utf8");
        inventory = JSON.parse(invRaw);
      } catch { /* inventory not available — push without it */ }

      const { pushFindings } = await import("./pushClient");
      await pushFindings({ apiUrl, apiKey, repoName: effectiveRepo, findings, inventory });
      console.log("[push] Successfully pushed findings to dashboard.");
    } catch (err) {
      console.error("[push] FAILED:", err);
      process.exit(1);
    }
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

  // ── Auto-push flags (scan + push in one command) ───────────────────
  const pushUrl = (args.url as string) || process.env.SCANTRIX_API_URL;
  const pushKey = (args.key as string) || process.env.SCANTRIX_API_KEY;
  const pushRepoName = (args["repo-name"] as string) || process.env.SCANTRIX_REPO_NAME;
  const autoPush = Boolean(args.push) || Boolean(pushUrl && pushKey);

  if (!repoPath) {
    console.error(
      "Usage:\n" +
      "  scantrix <repoPath> [--out <dir>] [--updates] [--config <path>]\n" +
      "           [--diff <baseline.json>] [--format md,html,json,sarif,email]\n" +
      "           [--no-trend]\n" +
      "\n" +
      "  Auto-push to dashboard (scan + push in one command):\n" +
      "  scantrix <repoPath> --out <dir> --push --url <dashboard-url> --key <api-key>\n" +
      "           [--repo-name <name>]\n" +
      "\n" +
      "  Sink routing (advanced):\n" +
      "  scantrix <repoPath> --sink local|hub [--json-path <path>]\n" +
      "           [--sqlite-path <path>] [--ingest-url <url>] [--token <tok>]\n" +
      "\n" +
      "  scantrix init [dir]           Create a starter .auditrc.json\n" +
      "  scantrix push [findings.json] Push results to dashboard (standalone)\n" +
      "           [--key <api-key>] [--url <api-url>] [--repo <name>]\n" +
      "\n" +
      "Environment variables:\n" +
      "  SCANTRIX_API_URL       Dashboard URL (enables auto-push with --push)\n" +
      "  SCANTRIX_API_KEY       API key (enables auto-push with --push)\n" +
      "  SCANTRIX_REPO_NAME     Override auto-detected repo name\n" +
      "  SCANTRIX_SINK          local (default) | hub\n" +
      "  SCANTRIX_JSON_PATH     Write canonical results JSON to this path\n" +
      "  SCANTRIX_SQLITE_PATH   Local SQLite DB path (local mode only)\n" +
      "  SCANTRIX_INGEST_URL    Hub ingestion endpoint (hub mode only)\n" +
      "  SCANTRIX_TOKEN         Bearer token for Hub auth (hub mode only)\n"
    );
    process.exit(1);
  }

  const absRepo = path.resolve(repoPath);
  const absOut = path.resolve(outDir);

  // Read tool version from package.json (dist/cli.js → ../package.json)
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  const toolVersion: string = pkg.version ?? "0.0.0";

  // ── Fail-fast: validate sink configuration ─────────────────────
  const sinkConfig = resolveSinkConfig({
    mode: args.sink as SinkMode | undefined,
    jsonPath: args["json-path"] as string | undefined,
    sqlitePath: args["sqlite-path"] as string | undefined,
    ingestUrl: args["ingest-url"] as string | undefined,
    token: args.token as string | undefined,
  });

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

  // ── Sink routing ─────────────────────────────────────────────────
  const scanResult = buildScanResult(results, {
    version: toolVersion,
    startedAt,
    repoPath: absRepo,
  });
  const sinks = buildSinks(sinkConfig);

  for (const sink of sinks) {
    try {
      await sink.write(scanResult);
      console.log(`[sink:${sink.name}] Results written successfully.`);
    } catch (sinkErr) {
      console.error(`[sink:${sink.name}] FAILED:`, sinkErr);
      process.exit(1);
    }
  }

  // ── Auto-push to dashboard ───────────────────────────────────────
  if (autoPush) {
    if (!pushUrl) {
      console.error("[push] --push requires --url <dashboard-url> or SCANTRIX_API_URL env var.");
      process.exit(1);
    }
    if (!pushKey) {
      console.error("[push] --push requires --key <api-key> or SCANTRIX_API_KEY env var.");
      process.exit(1);
    }

    // Load inventory from the just-written repo_inventory.json
    let inventory: Record<string, any> | undefined;
    try {
      const invPath = path.join(absOut, "repo_inventory.json");
      const invRaw = await fs.readFile(invPath, "utf8");
      inventory = JSON.parse(invRaw);
    } catch { /* inventory not available — push without it */ }

    try {
      const { pushFindings } = await import("./pushClient");
      await pushFindings({
        apiUrl: pushUrl,
        apiKey: pushKey,
        repoName: pushRepoName,
        findings: results.findings,
        inventory,
      });
      console.log(`[push] Results pushed to ${pushUrl}`);
    } catch (pushErr) {
      console.error("[push] FAILED:", pushErr);
      process.exit(1);
    }
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
