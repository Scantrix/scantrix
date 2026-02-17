import minimist from "minimist";
import path from "path";
import { scanRepo } from "./scanner";
import { writeReportArtifacts } from "./report";
import { loadAuditConfig, generateDefaultConfig } from "./auditConfig";
import { saveSnapshot, findLatestBaseline, formatDiffConsoleSummary, computeDiff, loadBaseline, type SnapshotMeta } from "./diffTracker";
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
    const apiUrl = (args.url as string) || process.env.QAVERITY_API_URL || "https://api.qaverity.com";
    const apiKey = (args.key as string) || process.env.QAVERITY_API_KEY;
    const repoName = (args.repo as string) || process.env.QAVERITY_REPO_NAME;

    if (!apiKey) {
      console.error("[push] Missing API key. Set --key or QAVERITY_API_KEY env var.");
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

  if (!repoPath) {
    console.error(
      "Usage:\n" +
      "  qaverity <repoPath> [--out <dir>] [--updates] [--config <path>]\n" +
      "           [--diff <baseline.json>] [--format md,html,json,sarif,email]\n" +
      "           [--no-trend]\n" +
      "\n" +
      "  qaverity init [dir]           Create a starter .auditrc.json\n" +
      "  qaverity push [findings.json] Push results to Qaverity dashboard\n" +
      "           [--key <api-key>] [--url <api-url>] [--repo <name>]\n"
    );
    process.exit(1);
  }

  const absRepo = path.resolve(repoPath);
  const absOut = path.resolve(outDir);

  // Avoid unused warnings in some TS configs; keep these for future path validations.
  void absRepo;
  void absOut;

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
