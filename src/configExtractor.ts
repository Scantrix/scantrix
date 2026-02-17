import fs from "fs/promises";
import path from "path";
import { parseConfigWithAst } from "./astConfigParser";

export type PlaywrightConfigSummary = {
  configPath: string;
  testDir?: string;
  timeoutMs?: number;
  expectTimeoutMs?: number;
  workers?: string; // keep as string (could be expression)
  retries?: string; // expression
  globalSetup?: string;

  use?: {
    headless?: string;
    actionTimeoutMs?: number;
    trace?: string;
    video?: string;
    screenshot?: string;
    ignoreHTTPSErrors?: boolean;
    launchArgs?: string[];
    baseURL?: string;
  };

  reporters?: Array<{ name: string; details?: Record<string, any> }>;

  projects?: Array<{
    name: string;
    grep?: string;
    browserName?: string;
    isMobile?: boolean;
  }>;

  envHints?: {
    headlessEnvVar?: string;
    workersEnvVar?: string;
    ciEnvVar?: string;
    azureTokenEnvVar?: string;
    planIdEnvVar?: string;
  };
};

// small helpers
function matchFirst(content: string, re: RegExp): string | undefined {
  const m = content.match(re);
  return m?.[1];
}

function parseNumber(s?: string): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Evaluate common numeric expressions found in Playwright configs.
 *
 * Handles:
 *   - Plain integers: 60000
 *   - Underscore notation: 60_000
 *   - Scientific notation: 6e4
 *   - Simple multiplication: 60 * 1000, 1000 * 60, 2 * 60 * 1000
 *
 * Does NOT handle:
 *   - Ternary expressions: process.env.CI ? 30000 : 60000
 *   - Variable references: MY_TIMEOUT
 *   - Function calls: getTimeout()
 *   - Template literals or string concatenation
 *
 * Returns undefined for expressions it cannot evaluate.
 */
export function evaluateNumericExpression(expr?: string): number | undefined {
  if (!expr) return undefined;

  const cleaned = expr
    .trim()
    .replace(/_/g, "")       // 60_000 -> 60000
    .replace(/\s+/g, " ");  // normalise whitespace

  // Direct number (handles 60000, 6e4, 0x... etc.)
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;

  // Simple multiplication chain: N * M [ * P ... ]
  const parts = cleaned.split(/\s*\*\s*/);
  if (parts.length >= 2 && parts.every((p) => /^\d+(?:\.\d+)?(?:e\d+)?$/.test(p))) {
    const result = parts.reduce((acc, p) => acc * Number(p), 1);
    if (Number.isFinite(result)) return result;
  }

  return undefined;
}

// very small “object block” extraction: finds `key: { ... }` and returns {...} as text
function extractBlock(content: string, key: string): string | undefined {
  const idx = content.indexOf(`${key}:`);
  if (idx < 0) return undefined;
  const braceStart = content.indexOf("{", idx);
  if (braceStart < 0) return undefined;

  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      return content.slice(braceStart, i + 1);
    }
  }
  return undefined;
}

function extractArrayBlock(content: string, key: string): string | undefined {
  const idx = content.indexOf(`${key}:`);
  if (idx < 0) return undefined;
  const arrStart = content.indexOf("[", idx);
  if (arrStart < 0) return undefined;

  let depth = 0;
  for (let i = arrStart; i < content.length; i++) {
    const ch = content[i];
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (depth === 0) {
      return content.slice(arrStart, i + 1);
    }
  }
  return undefined;
}

function parseLaunchArgs(useBlock?: string): string[] | undefined {
  if (!useBlock) return undefined;
  const launchBlock = extractBlock(useBlock, "launchOptions");
  if (!launchBlock) return undefined;

  // args: ['--a','--b']
  const m = launchBlock.match(/\bargs\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return undefined;

  const inside = m[1];
  const args = [...inside.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  return args.length ? args : undefined;
}

function parseReporters(content: string): Array<{ name: string; details?: Record<string, any> }> | undefined {
  // We only need to detect common reporters + key fields.
  // Find occurrences like ['html', { outputFolder: 'playwright-report', open: 'never' }]
  const reporters: Array<{ name: string; details?: Record<string, any> }> = [];

  // html
  const htmlMatches = [...content.matchAll(/\[\s*['"`]html['"`]\s*,\s*\{([\s\S]*?)\}\s*\]/g)];
  for (const m of htmlMatches) {
    const block = m[1];
    const outputFolder = matchFirst(block, /\boutputFolder\s*:\s*['"`]([^'"`]+)['"`]/);
    const open = matchFirst(block, /\bopen\s*:\s*['"`]([^'"`]+)['"`]/);
    reporters.push({ name: "html", details: { outputFolder, open } });
  }

  // junit
  const junitMatches = [...content.matchAll(/\[\s*['"`]junit['"`]\s*,\s*\{([\s\S]*?)\}\s*\]/g)];
  for (const m of junitMatches) {
    const block = m[1];
    const outputFile = matchFirst(block, /\boutputFile\s*:\s*['"`]([^'"`]+)['"`]/);
    reporters.push({ name: "junit", details: { outputFile } });
  }

  // list
  if (/\[\s*['"`]list['"`]\s*\]/.test(content) || /['"`]list['"`]/.test(content)) {
    reporters.push({ name: "list" });
  }

  // azure reporter
  if (/@alex_neo\/playwright-azure-reporter/.test(content)) {
    const orgUrl = matchFirst(content, /\borgUrl\s*:\s*['"`]([^'"`]+)['"`]/);
    const projectName = matchFirst(content, /\bprojectName\s*:\s*['"`]([^'"`]+)['"`]/);
    const uploadAttachments = /uploadAttachments\s*:\s*true/.test(content);
    const attachmentsType = [...content.matchAll(/\battachmentsType\s*:\s*\[([\s\S]*?)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]));
    reporters.push({
      name: "@alex_neo/playwright-azure-reporter",
      details: {
        orgUrl,
        projectName,
        uploadAttachments,
        attachmentsType: attachmentsType.length ? attachmentsType : undefined,
      },
    });
  }

  return reporters.length ? reporters : undefined;
}

function parseProjects(projectsBlock?: string): PlaywrightConfigSummary["projects"] | undefined {
  if (!projectsBlock) return undefined;
  const projects: NonNullable<PlaywrightConfigSummary["projects"]> = [];

  // very lightweight: find "name: '...'" occurrences and nearby grep/browserName/isMobile text
  const entries = projectsBlock.split(/\}\s*,\s*\{/g).map((s) => s.replace(/^\[/, "{").replace(/\]$/, "}"));
  for (const entry of entries) {
    const name = matchFirst(entry, /\bname\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!name) continue;

    const grep = matchFirst(entry, /\bgrep\s*:\s*(\/[^\/]+\/[gimsuy]*)/);
    const browserName = matchFirst(entry, /\bbrowserName\s*:\s*['"`]([^'"`]+)['"`]/);
    const isMobile = /\bisMobile\s*:\s*true/.test(entry) ? true : /\bisMobile\s*:\s*false/.test(entry) ? false : undefined;

    projects.push({ name, grep, browserName, isMobile });
  }

  return projects.length ? projects : undefined;
}

export async function extractPlaywrightConfig(
  repoPath: string,
  /** Optional direct path to the config file (skips root-level search). */
  configFilePath?: string,
): Promise<PlaywrightConfigSummary | undefined> {
  // Find config file — prefer the explicitly provided path, then search repo root
  let configPath: string | undefined = configFilePath;

  if (!configPath) {
    const candidates = [
      path.join(repoPath, "playwright.config.ts"),
      path.join(repoPath, "playwright.config.js"),
      path.join(repoPath, "playwright.config.mjs"),
      path.join(repoPath, "playwright.config.cjs"),
    ];

    for (const c of candidates) {
      try {
        await fs.access(c);
        configPath = c;
        break;
      } catch {
        // ignore
      }
    }
  }

  if (!configPath) return undefined;

  const content = await fs.readFile(configPath, "utf8");

  // ── Strategy 1: AST-based parsing (handles computed values, spreads, etc.) ──
  const astResult = parseConfigWithAst(configPath, content);
  if (astResult) {
    // Augment with env hints (regex-based, cheap, and AST doesn't do these)
    astResult.envHints = {
      headlessEnvVar: content.includes("HEADLESS_MODE") ? "HEADLESS_MODE" : undefined,
      workersEnvVar: content.includes("process.env.WORKERS") ? "WORKERS" : undefined,
      ciEnvVar: content.includes("process.env.CI") ? "CI" : undefined,
      azureTokenEnvVar: content.includes("AZURE_TOKEN") ? "AZURE_TOKEN" : undefined,
      planIdEnvVar: content.includes("PLAN_ID") ? "PLAN_ID" : undefined,
    };
    // Augment with reporters if AST didn't capture them well (complex array syntax)
    if (!astResult.reporters?.length) {
      astResult.reporters = parseReporters(content);
    }
    return astResult;
  }

  // ── Strategy 2: Regex fallback (legacy, handles simpler configs) ──
  const summary: PlaywrightConfigSummary = { configPath };

  // top-level
  summary.testDir = matchFirst(content, /\btestDir\s*:\s*['"`]([^'"`]+)['"`]/);

  // Timeout: extract the raw expression after `timeout:` and evaluate it.
  // Supports: 60000, 60_000, 6e4, 60 * 1000, 1000 * 60, 2 * 60 * 1000.
  const rawTimeout = matchFirst(content, /(?<![.\w])timeout\s*:\s*([^,\n{}]+)/);
  summary.timeoutMs = evaluateNumericExpression(rawTimeout);

  // expect.timeout (often written as 20 * 1000)
  const expectBlock = extractBlock(content, "expect");
  if (expectBlock) {
    const rawExpectTimeout = matchFirst(expectBlock, /\btimeout\s*:\s*([^,\n{}]+)/);
    summary.expectTimeoutMs = evaluateNumericExpression(rawExpectTimeout);
  }

  summary.workers = matchFirst(content, /\bworkers\s*:\s*([^,\n]+)/)?.trim();
  summary.retries = matchFirst(content, /\bretries\s*:\s*([^,\n]+)/)?.trim();
  summary.globalSetup = matchFirst(content, /\bglobalSetup\s*:\s*require\.resolve\(\s*['"`]([^'"`]+)['"`]\s*\)/);

  // use block
  const useBlock = extractBlock(content, "use");
  if (useBlock) {
    const headlessExpr = matchFirst(useBlock, /\bheadless\s*:\s*([^,\n]+)/)?.trim();
    const rawActionTimeout = matchFirst(useBlock, /\bactionTimeout\s*:\s*([^,\n{}]+)/);
    const traceExpr = matchFirst(useBlock, /\btrace\s*:\s*([^,\n]+)/)?.trim();
    const videoExpr = matchFirst(useBlock, /\bvideo\s*:\s*['"`]([^'"`]+)['"`]/);
    const screenshotExpr = matchFirst(useBlock, /\bscreenshot\s*:\s*['"`]([^'"`]+)['"`]/);
    const ignoreHttps = /\bignoreHTTPSErrors\s*:\s*true/.test(useBlock) ? true : /\bignoreHTTPSErrors\s*:\s*false/.test(useBlock) ? false : undefined;
    const launchArgs = parseLaunchArgs(useBlock);
    const baseURLExpr = matchFirst(useBlock, /\bbaseURL\s*:\s*(['"`][^'"`]+['"`]|[^,\n]+)/)?.trim();

    summary.use = {
      headless: headlessExpr,
      actionTimeoutMs: evaluateNumericExpression(rawActionTimeout),
      trace: traceExpr,
      video: videoExpr,
      screenshot: screenshotExpr,
      ignoreHTTPSErrors: ignoreHttps,
      launchArgs,
      baseURL: baseURLExpr,
    };
  }

  // reporters + projects
  summary.reporters = parseReporters(content);
  summary.projects = parseProjects(extractArrayBlock(content, "projects"));

  // env hinting (we can detect usage by simple matches)
  summary.envHints = {
    headlessEnvVar: content.includes("HEADLESS_MODE") ? "HEADLESS_MODE" : undefined,
    workersEnvVar: content.includes("process.env.WORKERS") ? "WORKERS" : undefined,
    ciEnvVar: content.includes("process.env.CI") ? "CI" : undefined,
    azureTokenEnvVar: content.includes("AZURE_TOKEN") ? "AZURE_TOKEN" : undefined,
    planIdEnvVar: content.includes("PLAN_ID") ? "PLAN_ID" : undefined,
  };

  return summary;
}
