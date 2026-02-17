"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const minimist_1 = __importDefault(require("minimist"));
const path_1 = __importDefault(require("path"));
const scanner_1 = require("./scanner");
const report_1 = require("./report");
const auditConfig_1 = require("./auditConfig");
const diffTracker_1 = require("./diffTracker");
const promises_1 = __importDefault(require("fs/promises"));
async function main() {
    const args = (0, minimist_1.default)(process.argv.slice(2));
    const subcommand = args._[0];
    // ── Subcommand: init ─────────────────────────────────────────────
    if (subcommand === "init") {
        const targetDir = args._[1] || ".";
        const configPath = path_1.default.join(path_1.default.resolve(targetDir), ".auditrc.json");
        try {
            await promises_1.default.access(configPath);
            console.error(`[init] .auditrc.json already exists at ${configPath}`);
            process.exit(1);
        }
        catch {
            // File doesn't exist — good
        }
        await promises_1.default.writeFile(configPath, (0, auditConfig_1.generateDefaultConfig)(), "utf8");
        console.log(`[init] Created .auditrc.json at ${configPath}`);
        return;
    }
    // ── Subcommand: push ─────────────────────────────────────────────
    if (subcommand === "push") {
        const findingsPath = args._[1] || "./audit-out/findings.json";
        const apiUrl = args.url || process.env.QAVERITY_API_URL || "https://api.qaverity.com";
        const apiKey = args.key || process.env.QAVERITY_API_KEY;
        const repoName = args.repo || process.env.QAVERITY_REPO_NAME;
        if (!apiKey) {
            console.error("[push] Missing API key. Set --key or QAVERITY_API_KEY env var.");
            process.exit(1);
        }
        try {
            const raw = await promises_1.default.readFile(path_1.default.resolve(findingsPath), "utf8");
            const payload = JSON.parse(raw);
            // findings.json may be a wrapped object { repoName, findings } or a plain array
            const isWrapped = payload && !Array.isArray(payload) && Array.isArray(payload.findings);
            const findings = isWrapped ? payload.findings : payload;
            const effectiveRepo = repoName || (isWrapped ? payload.repoName : undefined);
            // Attempt to load repo_inventory.json from the same directory
            let inventory;
            try {
                const invPath = path_1.default.join(path_1.default.dirname(path_1.default.resolve(findingsPath)), "repo_inventory.json");
                const invRaw = await promises_1.default.readFile(invPath, "utf8");
                inventory = JSON.parse(invRaw);
            }
            catch { /* inventory not available — push without it */ }
            const { pushFindings } = await Promise.resolve().then(() => __importStar(require("./pushClient")));
            await pushFindings({ apiUrl, apiKey, repoName: effectiveRepo, findings, inventory });
            console.log("[push] Successfully pushed findings to dashboard.");
        }
        catch (err) {
            console.error("[push] FAILED:", err);
            process.exit(1);
        }
        return;
    }
    // ── Standard scan ────────────────────────────────────────────────
    const repoPath = args.repo || args._[0];
    const outDir = args.out || "./audit-out";
    const checkUpdates = Boolean(args.updates || args.update || args.checkUpdates);
    const configPath = args.config; // --config .auditrc.json
    const diffPath = args.diff; // --diff path/to/baseline/findings.json
    const formatArg = args.format; // --format md,html,json,sarif,email
    const noTrend = Boolean(args["no-trend"]); // --no-trend to disable auto-snapshot
    if (!repoPath) {
        console.error("Usage:\n" +
            "  qaverity <repoPath> [--out <dir>] [--updates] [--config <path>]\n" +
            "           [--diff <baseline.json>] [--format md,html,json,sarif,email]\n" +
            "           [--no-trend]\n" +
            "\n" +
            "  qaverity init [dir]           Create a starter .auditrc.json\n" +
            "  qaverity push [findings.json] Push results to Qaverity dashboard\n" +
            "           [--key <api-key>] [--url <api-url>] [--repo <name>]\n");
        process.exit(1);
    }
    const absRepo = path_1.default.resolve(repoPath);
    const absOut = path_1.default.resolve(outDir);
    // Avoid unused warnings in some TS configs; keep these for future path validations.
    void absRepo;
    void absOut;
    // ── Load optional .auditrc.json ────────────────────────────────────
    const auditConfig = await (0, auditConfig_1.loadAuditConfig)(configPath ?? repoPath);
    // ── Parse --format flag ────────────────────────────────────────────
    const validFormats = ["md", "html", "json", "sarif", "email"];
    let formats;
    if (formatArg) {
        formats = formatArg.split(",").map(s => s.trim().toLowerCase()).filter((s) => validFormats.includes(s));
        if (formats.length === 0)
            formats = undefined; // fall back to all
    }
    // ── Resolve baseline for diff / trend tracking ─────────────────────
    let resolvedBaseline = diffPath;
    let baselineMeta;
    if (!resolvedBaseline && !noTrend) {
        resolvedBaseline = await (0, diffTracker_1.findLatestBaseline)(outDir) ?? undefined;
        // Load the baseline snapshot's meta.json for inventory comparison
        if (resolvedBaseline) {
            try {
                const metaPath = path_1.default.join(path_1.default.dirname(resolvedBaseline), "meta.json");
                const metaRaw = await promises_1.default.readFile(metaPath, "utf8");
                baselineMeta = JSON.parse(metaRaw);
            }
            catch { /* no meta available — first scan or corrupt snapshot */ }
        }
    }
    try {
        const results = await (0, scanner_1.scanRepo)(repoPath, {
            checkOutdatedDependencies: checkUpdates,
            auditConfig,
        });
        await (0, report_1.writeReportArtifacts)(outDir, results, {
            baselinePath: resolvedBaseline,
            baselineMeta,
            formats,
        });
        console.log(`[audit] wrote report to: ${outDir}`);
        // ── Auto-snapshot for trend tracking ───────────────────────────────
        if (!noTrend) {
            await (0, diffTracker_1.saveSnapshot)(outDir, results.findings, {
                inventory: results.inventory,
                repoPath: absRepo,
            });
            console.log(`[trend] Snapshot saved to ${outDir}/snapshots/`);
        }
        // ── Console trend summary ──────────────────────────────────────────
        if (resolvedBaseline) {
            const baseline = await (0, diffTracker_1.loadBaseline)(resolvedBaseline);
            if (baseline.length > 0) {
                const diff = (0, diffTracker_1.computeDiff)(baseline, results.findings, {
                    baselineInventory: baselineMeta,
                    currentInventory: results.inventory,
                });
                console.log((0, diffTracker_1.formatDiffConsoleSummary)(diff));
            }
        }
        else if (!noTrend) {
            console.log("[trend] First scan — no baseline to compare.");
        }
    }
    catch (err) {
        console.error("[audit] FAILED:", err);
        // Write a minimal crash report so audit_summary.md is never empty again
        await promises_1.default.mkdir(outDir, { recursive: true });
        await promises_1.default.writeFile(path_1.default.join(outDir, "audit_summary.md"), `# Playwright Reliability Audit (Crash)\n\nRepo: \`${repoPath}\`\n\nError:\n\n\`\`\`\n${String(err)}\n\`\`\`\n`, "utf8");
        throw err;
    }
}
main().catch((e) => {
    console.error(" Audit failed:", e);
    process.exit(1);
});
