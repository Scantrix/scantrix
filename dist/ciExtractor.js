"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCiSummary = extractCiSummary;
const fast_glob_1 = __importDefault(require("fast-glob"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
function normalize(p) {
    return p.replace(/\\/g, "/");
}
function classifyCiFile(file) {
    const n = normalize(file).toLowerCase();
    if (n.includes("/.github/workflows/") &&
        (n.endsWith(".yml") || n.endsWith(".yaml"))) {
        return "github_actions";
    }
    // Typical Azure Pipelines
    if (n.endsWith("/azure-pipelines.yml") || n.endsWith("/azure-pipelines.yaml")) {
        return "azure_pipelines";
    }
    // Repo conventions: /pipelines/ folder or names containing azure/ado/pipeline
    const base = path_1.default.basename(n);
    if (n.includes("/pipelines/"))
        return "azure_pipelines";
    if (base.includes("pipeline") || base.includes("azure") || base.includes("ado"))
        return "azure_pipelines";
    return "unknown";
}
function contentHasAny(content, patterns) {
    return patterns.some((p) => p.test(content));
}
function looksLikeCiByPath(file) {
    const n = normalize(file).toLowerCase();
    const base = path_1.default.basename(n);
    return (n.includes("/pipelines/") ||
        n.includes("/.github/workflows/") ||
        base.includes("pipeline") ||
        base.includes("azure") ||
        base.includes("ado") ||
        base === "azure-pipelines.yml" ||
        base === "azure-pipelines.yaml");
}
function looksLikePipelineYamlContent(c) {
    // super lightweight heuristic to avoid false positives (e.g., docker-compose, k8s manifests)
    return contentHasAny(c, [
        /^\s*trigger\s*:/mi,
        /^\s*schedules\s*:/mi,
        /^\s*stages\s*:/mi,
        /^\s*jobs\s*:/mi,
        /^\s*steps\s*:/mi,
        /^\s*pool\s*:/mi,
        /^\s*-+\s*task\s*:/mi,
        /PublishPipelineArtifact/i,
        /PublishTestResults/i,
        /actions\/upload-artifact/i,
    ]);
}
async function extractCiSummary(repoPath) {
    // Bulletproof discovery: find all YAML files, then filter down.
    const allYaml = (await (0, fast_glob_1.default)(["**/*.yml", "**/*.yaml"], {
        cwd: repoPath,
        absolute: true,
        dot: true, // include .github/workflows
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    }));
    // First-pass filter by path/name conventions
    const likelyByPath = allYaml.filter(looksLikeCiByPath);
    // Second-pass: if we found nothing, fall back to scanning content for CI-ish keys.
    let candidates = likelyByPath;
    if (!candidates.length && allYaml.length) {
        const contentCandidates = [];
        // Cap to keep it fast on huge repos
        for (const f of allYaml.slice(0, 300)) {
            try {
                const c = await promises_1.default.readFile(f, "utf8");
                if (looksLikePipelineYamlContent(c))
                    contentCandidates.push(f);
            }
            catch {
                // ignore unreadable
            }
        }
        candidates = contentCandidates;
    }
    const files = candidates
        .map((f) => ({ file: normalize(f), kind: classifyCiFile(f) }))
        .filter((f) => !f.file.toLowerCase().includes("/node_modules/"));
    const summary = {
        files,
        detectedAzurePipelines: files.some((f) => f.kind === "azure_pipelines"),
        detectedGitHubActions: files.some((f) => f.kind === "github_actions"),
        publishesPlaywrightReport: false,
        publishesJUnit: false,
        publishesTracesOrTestResultsDir: false,
        publishesArtifactsOnFailure: false,
        usesCache: false,
        usesSharding: false,
        shardingFiles: [],
        setsWorkersEnv: false,
        workersEnvName: undefined,
        workersEnvFiles: [],
        setsHeadlessEnv: false,
        headlessEnvName: undefined,
        mentionsNodeSetup: false,
        mentionsNpmInstall: false,
        mentionsPlaywrightInstall: false,
        playwrightInstallMethod: undefined,
        usesSelfHostedPool: false,
        usesMicrosoftHostedPool: false,
        mentionsBrowsersPreinstalled: false,
        hasFailureHandling: false,
        failureHandlingMethods: [],
        setsCiEnvTrue: false,
        hasPipelineTimeout: false,
        pipelineTimeoutMinutes: undefined,
        hasReporterInPlaywrightCommand: false,
        notes: [],
    };
    if (!files.length) {
        summary.notes.push(`No CI pipeline YAML detected under repoPath: ${normalize(repoPath)}`);
        summary.notes.push(`YAML files scanned: ${allYaml.length}`);
        return summary;
    }
    for (const f of files) {
        let content = "";
        try {
            content = await promises_1.default.readFile(f.file, "utf8");
        }
        catch {
            continue;
        }
        const c = content;
        // Pool type signals
        if (contentHasAny(c, [
            /\bpool\s*:\s*\n\s*name\s*:/i,
            /\bpool\s*:\s*{[^}]*\bname\s*:/i,
        ])) {
            summary.usesSelfHostedPool = true;
        }
        if (contentHasAny(c, [/\bvmImage\s*:/i])) {
            summary.usesMicrosoftHostedPool = true;
        }
        if (contentHasAny(c, [
            /already\s+has\s+browsers?/i,
            /browsers?.*already\s+installed/i,
            /playwright.*already\s+has\s+browsers/i,
        ])) {
            summary.mentionsBrowsersPreinstalled = true;
        }
        // Report publishing
        if (contentHasAny(c, [/playwright-report/i, /\bhtml-report\b/i])) {
            if (contentHasAny(c, [
                /\bPublishPipelineArtifact\b/i,
                /\bPublishBuildArtifacts\b/i,
                /\bactions\/upload-artifact\b/i,
                /\bupload-artifact\b/i,
                /\bpublish:\s*/i,
            ])) {
                summary.publishesPlaywrightReport = true;
            }
        }
        // JUnit publishing
        if (contentHasAny(c, [/PublishTestResults@/i, /\bPublishTestResults\b/i])) {
            summary.publishesJUnit = true;
        }
        else if (contentHasAny(c, [/test-results\.xml/i, /junit/i])) {
            if (contentHasAny(c, [
                /\bPublishPipelineArtifact\b/i,
                /\bPublishBuildArtifacts\b/i,
                /\bactions\/upload-artifact\b/i,
                /\bupload-artifact\b/i,
            ])) {
                summary.publishesJUnit = true;
            }
        }
        // Traces/test-results publishing
        if (contentHasAny(c, [/test-results/i, /trace\.zip/i, /traces?/i])) {
            if (contentHasAny(c, [
                /\bPublishPipelineArtifact\b/i,
                /\bPublishBuildArtifacts\b/i,
                /\bactions\/upload-artifact\b/i,
                /\bupload-artifact\b/i,
            ])) {
                summary.publishesTracesOrTestResultsDir = true;
            }
        }
        // Detect if artifact publishing is configured to run even on failure
        // Azure DevOps: condition: always() or condition: failed() or condition: succeededOrFailed()
        // GitHub Actions: if: always() or if: failure() or if: ${{ always() }}
        if (contentHasAny(c, [
            // Azure DevOps conditions
            /condition\s*:\s*always\s*\(\)/i,
            /condition\s*:\s*failed\s*\(\)/i,
            /condition\s*:\s*succeededOrFailed\s*\(\)/i,
            // GitHub Actions conditions
            /if\s*:\s*always\s*\(\)/i,
            /if\s*:\s*failure\s*\(\)/i,
            /if\s*:\s*\$\{\{\s*always\s*\(\)/i,
            /if\s*:\s*\$\{\{\s*failure\s*\(\)/i,
            // Combined with artifact keywords nearby (within ~200 chars context)
        ])) {
            // Check if it's associated with artifact/test-results publishing
            if (contentHasAny(c, [
                /test-results/i,
                /playwright-report/i,
                /trace/i,
                /upload-artifact/i,
                /PublishPipelineArtifact/i,
                /PublishBuildArtifacts/i,
            ])) {
                summary.publishesArtifactsOnFailure = true;
            }
        }
        // Cache usage — tightened to avoid false negatives from unrelated YAML keys
        // Only match explicit CI cache tasks/actions, not arbitrary `cache:` keys
        if (contentHasAny(c, [
            /\bCache@2\b/i,
            /\bactions\/cache\b/i,
            /\bactions\/setup-node[\s\S]{0,200}cache\s*:/i,
            /\bnpm\s+ci\s+--cache/i,
        ])) {
            summary.usesCache = true;
        }
        // Env wiring
        if (contentHasAny(c, [/\bWORKERS\b/i])) {
            summary.setsWorkersEnv = true;
            summary.workersEnvName = "WORKERS";
            summary.workersEnvFiles.push(normalize(f.file));
        }
        if (contentHasAny(c, [/\bHEADLESS_MODE\b/i])) {
            summary.setsHeadlessEnv = true;
            summary.headlessEnvName = "HEADLESS_MODE";
        }
        // Tooling steps
        if (contentHasAny(c, [
            /\bNodeTool@0\b/i,
            /actions\/setup-node/i,
            /\bsetup-node\b/i,
        ])) {
            summary.mentionsNodeSetup = true;
        }
        if (contentHasAny(c, [
            /\bnpm ci\b/i,
            /\bnpm install\b/i,
            /\byarn install\b/i,
            /\bpnpm install\b/i,
        ])) {
            summary.mentionsNpmInstall = true;
        }
        if (contentHasAny(c, [/\bnpx playwright install\b/i, /playwright install\b/i])) {
            summary.mentionsPlaywrightInstall = true;
            // Detect install method
            if (contentHasAny(c, [/npx playwright install --with-deps/i])) {
                summary.playwrightInstallMethod = "npx playwright install --with-deps";
            }
            else if (contentHasAny(c, [/npx playwright install(?!\s+--with-deps)/i])) {
                summary.playwrightInstallMethod = "npx playwright install";
            }
            else {
                summary.playwrightInstallMethod = "unknown";
            }
        }
        // Sharding detection
        if (contentHasAny(c, [/--shard=/i, /\bshard\b.*\d+\/\d+/i])) {
            summary.usesSharding = true;
            summary.shardingFiles.push(normalize(f.file));
        }
        // Failure handling detection
        if (contentHasAny(c, [/continueOnError\s*:\s*true/i])) {
            summary.hasFailureHandling = true;
            if (!summary.failureHandlingMethods.includes("continueOnError")) {
                summary.failureHandlingMethods.push("continueOnError");
            }
        }
        if (contentHasAny(c, [/condition\s*:.*failed\(\)/i, /if\s*:.*failure\(\)/i])) {
            summary.hasFailureHandling = true;
            if (!summary.failureHandlingMethods.includes("conditional steps on failure")) {
                summary.failureHandlingMethods.push("conditional steps on failure");
            }
        }
        // CI-012: Does the pipeline explicitly set CI=true?
        // GitHub Actions sets CI=true automatically, Azure DevOps does not.
        if (contentHasAny(c, [
            /\bCI\s*:\s*['"]?true['"]?/i,
            /\bCI=true\b/i,
            /\benv\s*:\s*\n[^]*?\bCI\s*:\s/i, // env block with CI key
        ])) {
            summary.setsCiEnvTrue = true;
        }
        // GitHub Actions implicitly sets CI=true
        if (f.kind === "github_actions") {
            summary.setsCiEnvTrue = true;
        }
        // CI-013: Pipeline timeout detection
        // Azure DevOps: timeoutInMinutes at job/step level
        // GitHub Actions: timeout-minutes at job/step level
        const adoTimeoutMatch = c.match(/\btimeoutInMinutes\s*:\s*(\d+)/i);
        const ghaTimeoutMatch = c.match(/\btimeout-minutes\s*:\s*(\d+)/i);
        const timeoutMatch = adoTimeoutMatch || ghaTimeoutMatch;
        if (timeoutMatch) {
            summary.hasPipelineTimeout = true;
            const mins = Number(timeoutMatch[1]);
            if (Number.isFinite(mins)) {
                summary.pipelineTimeoutMinutes = summary.pipelineTimeoutMinutes
                    ? Math.max(summary.pipelineTimeoutMinutes, mins)
                    : mins;
            }
        }
        // CI-014: Does `npx playwright test` command include --reporter?
        if (contentHasAny(c, [/playwright\s+test\b[^\n]*--reporter/i])) {
            summary.hasReporterInPlaywrightCommand = true;
        }
    }
    // Dedupes (safe + makes CI-006 deterministic)
    summary.workersEnvFiles = [...new Set(summary.workersEnvFiles)];
    summary.shardingFiles = [...new Set(summary.shardingFiles)];
    return summary;
}
