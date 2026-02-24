import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import https from "https";
import { extractPlaywrightConfig } from "./configExtractor";
import type { PlaywrightConfigSummary } from "./configExtractor";
import { extractCiSummary } from "./ciExtractor";
import type { CiSummary } from "./ciExtractor";
import { extractCypressConfig } from "./cypressExtractor";
import type { CypressConfigSummary } from "./cypressExtractor";
import { getGitInfo } from "./diffTracker";
import type { AuditConfig } from "./auditConfig";
import { isRuleDisabled, getEffectiveSeverity } from "./auditConfig";

export type Evidence = { file: string; line: number; snippet: string };

export type Finding = {
  findingId: string;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  recommendation: string;
  evidence: Evidence[];
};

export type Inventory = {
  totalFiles: number;
  testFiles: number;
  hasPlaywrightConfig: boolean;
  /** All discovered Playwright config file paths (relative to repoPath). */
  playwrightConfigPaths?: string[];
  playwrightVersion: string | null;
  playwrightConfigSummary?: PlaywrightConfigSummary;
  ciSummary?: CiSummary;
  detectedFrameworks: string[];
  cypressConfigSummary?: CypressConfigSummary;
  cypressTestFiles?: number;
  seleniumTestFiles?: number;
};

export type ScanResults = {
  repoPath: string;
  inventory: Inventory;
  findings: Finding[];
  /** Git branch at time of scan */
  gitBranch?: string;
  /** Git commit SHA at time of scan */
  gitCommit?: string;
};

export type ScanOptions = {
  checkOutdatedDependencies?: boolean;
  auditConfig?: AuditConfig;
};

type SimpleVersion = { major: number; minor: number; patch: number };

function parseSemverFromText(text?: string): SimpleVersion | undefined {
  if (!text) return undefined;
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return undefined;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (![major, minor, patch].every((n) => Number.isFinite(n))) return undefined;
  return { major, minor, patch };
}

function compareSemver(a: SimpleVersion, b: SimpleVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isPinnedVersionRange(range: string): boolean {
  const r = range.trim();
  // Treat exact versions (e.g. 1.2.3) as pinned.
  // Caret/tilde ranges generally float within the major/minor, so we keep alerts conservative.
  return /^\d+\.\d+\.\d+/.test(r) || /^=\s*\d+\.\d+\.\d+/.test(r);
}

async function fetchJson(url: string, timeoutMs = 4500): Promise<any> {
  return await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "accept": "application/json",
          "user-agent": "repo-audit-agent",
        },
      },
      (res) => {
        const { statusCode } = res;
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${statusCode ?? "(unknown)"} for ${url}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
    });
  });
}

interface NpmPackageInfo {
  latest: string | undefined;
  deprecated: string | undefined;
}

const npmInfoCache = new Map<string, NpmPackageInfo>();

async function getNpmPackageInfo(packageName: string): Promise<NpmPackageInfo> {
  if (npmInfoCache.has(packageName)) return npmInfoCache.get(packageName)!;

  // npm registry expects scoped packages as %40scope%2Fname
  const encoded = encodeURIComponent(packageName);
  const url = `https://registry.npmjs.org/${encoded}`;

  try {
    const json = await fetchJson(url);
    const latest = json?.["dist-tags"]?.latest;
    let deprecated: string | undefined;
    if (typeof latest === "string" && json?.versions?.[latest]?.deprecated) {
      deprecated = String(json.versions[latest].deprecated);
    }
    const out: NpmPackageInfo = {
      latest: typeof latest === "string" ? latest : undefined,
      deprecated,
    };
    npmInfoCache.set(packageName, out);
    return out;
  } catch {
    const fallback: NpmPackageInfo = { latest: undefined, deprecated: undefined };
    npmInfoCache.set(packageName, fallback);
    return fallback;
  }
}

function pickPlaywrightRelatedPackages(pkg: any, pwConfig?: PlaywrightConfigSummary): Array<{ name: string; range: string }> {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  const candidates = new Map<string, string>();

  // Always consider these if present.
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    const r = deps[name];
    if (typeof r === "string" && r.trim()) candidates.set(name, r);
  }

  // Add anything that looks like a Playwright plugin/reporter dependency.
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range !== "string" || !range.trim()) continue;
    if (/playwright/i.test(name) && !candidates.has(name)) candidates.set(name, range);
  }

  // Reporter packages detected in config (if the package is declared).
  for (const rep of pwConfig?.reporters ?? []) {
    const name = rep.name;
    if (typeof name === "string" && name.startsWith("@") && deps[name] && !candidates.has(name)) {
      candidates.set(name, deps[name]);
    }
  }

  return [...candidates.entries()].map(([name, range]) => ({ name, range }));
}

async function maybeAddOutdatedDependencyFinding(params: {
  repoPath: string;
  pkgPath?: string;
  pkg?: any;
  pwConfig?: PlaywrightConfigSummary;
  findings: Finding[];
  enabled: boolean;
}) {
  const { pkg, pkgPath, pwConfig, findings, enabled } = params;
  if (!enabled) return;
  if (!pkg || !pkgPath) return;

  const packages = pickPlaywrightRelatedPackages(pkg, pwConfig);
  if (!packages.length) return;

  const outdatedEvidence: Evidence[] = [];
  const deprecatedEvidence: Evidence[] = [];
  let worstSeverity: Finding["severity"] = "low";

  for (const p of packages) {
    const info = await getNpmPackageInfo(p.name);

    // ── DEP-002: npm-deprecated package ──
    if (info.deprecated) {
      const snippet = `${p.name}: DEPRECATED — ${info.deprecated}`;
      deprecatedEvidence.push({ file: normalize(pkgPath), line: 1, snippet });
    }

    // ── DEP-001: outdated version check ──
    if (!info.latest) continue;

    const latestV = parseSemverFromText(info.latest);
    const currentV = parseSemverFromText(p.range);
    if (!latestV || !currentV) continue;

    // Conservative: if you use ^ or ~, only alert on major bumps.
    const pinned = isPinnedVersionRange(p.range);
    const majorBehind = latestV.major > currentV.major;
    const minorBehind = latestV.major === currentV.major && latestV.minor > currentV.minor;

    if (!majorBehind && !(pinned && minorBehind)) continue;

    const sev: Finding["severity"] = majorBehind ? "medium" : "low";
    if (sev === "medium") worstSeverity = "medium";

    const snippet = `${p.name}: specified '${p.range}' vs latest '${info.latest}'`;
    outdatedEvidence.push({ file: normalize(pkgPath), line: 1, snippet });
  }

  // ── Emit DEP-001 if outdated deps found ──
  if (outdatedEvidence.length) {
    const evidence = outdatedEvidence.slice(0, 25);
    findings.push({
      findingId: "DEP-001",
      severity: worstSeverity,
      title: "Outdated Playwright plugins/dependencies detected",
      description:
        "Some Playwright-related dependencies appear behind the latest published versions. Staying current helps reduce flakiness, improves performance, and avoids known bugs.",
      recommendation:
        "Review the packages listed and consider upgrading to the latest stable versions. If you intentionally pin versions, document the rationale and schedule periodic upgrade windows.",
      evidence,
    });
  }

  // ── Emit DEP-002 if deprecated packages found ──
  if (deprecatedEvidence.length) {
    findings.push({
      findingId: "DEP-002",
      severity: "high",
      title: "Deprecated npm package detected",
      description:
        "One or more Playwright-related dependencies are marked as deprecated on npm. Deprecated packages may be unmaintained, contain known vulnerabilities, or have an official replacement.",
      recommendation:
        "Check the npm deprecation notice for each package and migrate to the recommended replacement. Remove deprecated packages from your dependency tree as soon as possible.",
      evidence: deprecatedEvidence.slice(0, 25),
    });
  }
}

type Rule = {
  id: string;
  title: string;
  severity: Finding["severity"];
  description: string;
  recommendation: string;
  patterns: RegExp[];
  fileGlobs: string[];
  maxEvidence?: number;
  /** When set, this rule only runs if the framework is in inventory.detectedFrameworks */
  framework?: string;
};

const RULES: Rule[] = [
  {
    id: "PW-FLAKE-001",
    title: "Hard waits detected (waitForTimeout / setTimeout)",
    severity: "high",
    description:
      "Hard waits increase flakiness and slow tests. Prefer condition-based waits.",
    recommendation:
      "Replace hard waits with Playwright auto-waiting + explicit expect(). Use locator waits and targeted network waits.\nhttps://playwright.dev/docs/api/class-page#page-wait-for-timeout",
    patterns: [
      /waitForTimeout\s*\(/g,
      /\bsetTimeout\s*\(/g,
      /new\s+Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
      /new\s+Promise\s*\(\s*r\s*=>\s*setTimeout/g,
    ],
    // Focus on test files and POMs - exclude helper utilities where delays may be legitimate
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/fixtures/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-FLAKE-002",
    title: "Force-click usage detected",
    severity: "medium",
    description: "Force clicks can hide real UI issues and timing problems.",
    recommendation:
      "Investigate why the element isn’t actionable. Prefer expect(locator).toBeVisible()/toBeEnabled() and stable locators.",
    patterns: [/force\s*:\s*true/g],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/fixtures/**/*.ts"],
    maxEvidence: 25,
    framework: "playwright",
  },
  {
    id: "PW-LOC-001",
    title: "XPath selectors detected (locator('//...'))",
    severity: "medium",
    description:
      "XPath selectors tend to be brittle and harder to maintain vs role/label/testid locators.",
    recommendation:
      "Prefer getByRole/getByLabel/getByTestId and scoped locators. Introduce data-testid where needed. Focus refactoring on frequently-changed test files first. \nhttps://playwright.dev/docs/locators#quick-guide",
    patterns: [
      /\blocator\s*\(\s*['"`]\s*\/\/[^'"`]+['"`]\s*\)/g,
      /\bpage\.locator\s*\(\s*['"`]\s*\/\/[^'"`]+['"`]\s*\)/g,
      /\bxpath\s*=\s*['"`][^'"`]+['"`]/g,
    ],
    fileGlobs: ["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx"],
    maxEvidence: 25,
  },
  {
    id: "PW-PERF-001",
    title: "page.goto() using unreliable 'networkidle' wait strategy",
    severity: "medium",
    description:
      "page.goto() defaults to waitUntil: 'load', which is reliable and sufficient for most use cases. Using waitUntil: 'networkidle' is explicitly discouraged by Playwright — it waits for zero network activity for 500 ms, which is unreliable in modern SPAs with background requests, analytics, and websockets.",
    recommendation:
      "Remove the waitUntil: 'networkidle' option from page.goto() calls and rely on the default ('load'), or use 'domcontentloaded' if you need faster navigation. Better: use page.waitForResponse() to wait for specific API calls, or expect(locator).toBeVisible() for specific UI elements.\nhttps://playwright.dev/docs/api/class-page#page-goto",
    patterns: [
      // Match page.goto() calls that explicitly use networkidle.
      // [\s\S]{0,200}? caps how far ahead we look so the regex doesn't span
      // across multiple unrelated page.goto() calls.
      /page\.goto\s*\([\s\S]{0,200}?waitUntil\s*:\s*['"`]networkidle['"`]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-PERF-002",
    title: "Hardcoded URLs detected in tests",
    severity: "medium",
    description:
      "Tests contain hardcoded URLs (http://, https://). This makes it difficult to run tests against different environments (dev, staging, production) and violates the DRY principle.",
    recommendation:
      "Configure baseURL in playwright.config.ts and use relative paths in tests (e.g., page.goto('/login') instead of page.goto('https://example.com/login')). Use environment variables for environment-specific configuration.",
    patterns: [
      /page\.goto\s*\(\s*['"`]https?:\/\/[^'"`]+['"`]/g,
      /(?:const|let|var)\s+\w+\s*=\s*['"`]https?:\/\/[^'"`]+['"`]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-FLAKE-003",
    title: "test.only() or test.skip() left in codebase",
    severity: "high" as const,
    description:
      "test.only() silently runs only one test — CI pass rates become meaningless. test.skip() permanently disables tests without visibility. Both erode suite coverage.",
    recommendation:
      "Remove test.only() before merging. Replace test.skip() with test.fixme() (appears in reports) or use grep/tag-based filtering for selective execution.\nhttps://playwright.dev/docs/test-annotations#skip-a-test",
    patterns: [
      /\btest\.only\s*\(/g,
      /\btest\.describe\.only\s*\(/g,
      /\btest\.skip\s*\(\s*['"`]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-FLAKE-004",
    title: "page.waitForLoadState('networkidle') usage",
    severity: "high" as const,
    description:
      "Playwright docs explicitly discourage 'networkidle'. It waits for zero network activity for 500 ms, which is unreliable in modern SPAs with background requests, analytics, and websockets.",
    recommendation:
      "Replace with specific waits: page.waitForResponse() for API calls, expect(locator).toBeVisible() for UI elements, or waitForLoadState('domcontentloaded').\nhttps://playwright.dev/docs/api/class-page#page-wait-for-load-state",
    patterns: [
      /waitForLoadState\s*\(\s*['"`]networkidle['"`]\s*\)/g,
      /waitUntil\s*:\s*['"`]networkidle['"`]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-LOC-003",
    title: "Index-based selectors (nth, first, last)",
    severity: "medium" as const,
    description:
      "Index-based selectors like .nth(3), .first(), .last() are order-dependent and fragile. DOM order changes (new elements, reordering) silently break tests without clear diagnostics.",
    recommendation:
      "Replace index-based selectors with semantic locators: getByRole, getByText, getByTestId, or .filter({ hasText: ... }) for specificity.\nhttps://playwright.dev/docs/locators#filtering-locators",
    patterns: [
      /\.nth\s*\(\s*\d+\s*\)/g,
      /\.first\s*\(\s*\)/g,
      /\.last\s*\(\s*\)/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },

  // ── Deprecated API Rules ─────────────────────────────────────────────
  {
    id: "PW-DEPREC-001",
    title: "Deprecated selector engine methods ($, $$, $eval, $$eval)",
    severity: "medium",
    description:
      "page.$(), page.$$(), page.$eval(), page.$$eval() — and their ElementHandle equivalents — are deprecated. These methods return ElementHandle objects, which are the legacy way to interact with DOM elements. Locators are the modern, auto-waiting replacement.",
    recommendation:
      "Replace all $/$$ usage with page.locator():\n" +
      "  page.$('selector')  → page.locator('selector')\n" +
      "  page.$$('selector') → page.locator('selector').all()\n" +
      "  page.$eval(sel, fn) → page.locator(sel).evaluate(fn)\n" +
      "  page.$$eval(sel, fn) → page.locator(sel).evaluateAll(fn)\n" +
      "Deprecated Page methods: https://playwright.dev/docs/api/class-page#page-query-selector\n" +
      "Deprecated ElementHandle: https://playwright.dev/docs/next/api/class-elementhandle#deprecated",
    patterns: [
      /\.\$\(/g,
      /\.\$\$\(/g,
      /\.\$eval\s*\(/g,
      /\.\$\$eval\s*\(/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-002",
    title: "Deprecated page.action(selector) convenience methods",
    severity: "medium",
    description:
      "Deprecated Page methods that accept a selector string as the first argument have been detected. In modern Playwright, use page.locator(selector) to create a Locator, then call the action method on it. The Locator API provides auto-waiting, actionability checks, and better error messages.",
    recommendation:
      "Refactor page.action('selector') → page.locator('selector').action():\n" +
      "  page.click('sel')         → page.locator('sel').click()\n" +
      "  page.fill('sel', 'val')   → page.locator('sel').fill('val')\n" +
      "  page.type('sel', 'text')  → page.locator('sel').pressSequentially('text')\n" +
      "  page.hover('sel')         → page.locator('sel').hover()\n" +
      "  page.check('sel')         → page.locator('sel').check()\n" +
      "  page.selectOption('sel')  → page.locator('sel').selectOption()\n" +
      "  page.getAttribute('sel')  → page.locator('sel').getAttribute()\n" +
      "  page.textContent('sel')   → page.locator('sel').textContent()\n" +
      "  page.isVisible('sel')     → page.locator('sel').isVisible()\n" +
      "Full list: https://playwright.dev/docs/api/class-page#page-click\n" +
      "Migration guide: https://playwright.dev/docs/locators",
    patterns: [
      /\bpage\.(click|dblclick|fill|focus|hover|check|uncheck|tap|type|press|selectOption|setChecked|setInputFiles|dispatchEvent|getAttribute|innerHTML|innerText|inputValue|textContent|isChecked|isDisabled|isEditable|isEnabled|isHidden|isVisible|screenshot)\s*\(\s*['"]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-003",
    title: "Deprecated page.waitForNavigation() / page.waitForSelector()",
    severity: "medium",
    description:
      "page.waitForNavigation() and page.waitForSelector() are deprecated. These are legacy wait mechanisms with race-condition risks (the event may fire before the wait is registered).",
    recommendation:
      "Replace with modern equivalents:\n" +
      "  page.waitForNavigation()   → page.waitForURL('**/expected-path')\n" +
      "  page.waitForSelector(sel)  → page.locator(sel).waitFor()\n" +
      "Note: page.waitForTimeout() is also deprecated (flagged separately by PW-FLAKE-001).\n" +
      "waitForNavigation: https://playwright.dev/docs/api/class-page#page-wait-for-navigation\n" +
      "waitForSelector: https://playwright.dev/docs/api/class-page#page-wait-for-selector",
    patterns: [
      /\bpage\.waitForNavigation\s*\(/g,
      /\.waitForNavigation\s*\(/g,
      /\bpage\.waitForSelector\s*\(/g,
      /\.waitForSelector\s*\(\s*['"]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-004",
    title: "test.describe.serial usage (isolation risk)",
    severity: "medium",
    description:
      "test.describe.serial() creates sequential test dependencies — if one test fails, subsequent tests in the group are skipped. The Playwright docs state: 'Using serial is not recommended. It is usually better to make your tests isolated.' Note: test.describe.parallel() and test.describe.serial() are not deprecated but the modern equivalent is test.describe.configure({ mode: 'parallel' | 'serial' }).",
    recommendation:
      "Refactor serial test groups to be fully isolated so each test can run independently. If you need serial mode for a legitimate reason (e.g. multi-step wizard), prefer test.describe.configure({ mode: 'serial' }) which is the modern syntax.\nhttps://playwright.dev/docs/test-retries#serial-mode\nhttps://playwright.dev/docs/test-parallel",
    patterns: [
      /\btest\.describe\.serial\b/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-005",
    title: "Deprecated snapshotDir config option",
    severity: "low",
    description:
      "The snapshotDir option in playwright.config.ts is deprecated. It was replaced by the more flexible snapshotPathTemplate option which provides greater control over snapshot file paths.",
    recommendation:
      "Replace snapshotDir with snapshotPathTemplate:\n" +
      "  // Before (deprecated):\n" +
      "  snapshotDir: './snapshots'\n" +
      "  // After:\n" +
      "  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}'\n" +
      "https://playwright.dev/docs/api/class-testconfig#test-config-snapshot-dir",
    patterns: [
      /\bsnapshotDir\s*[=:]/g,
    ],
    fileGlobs: [
      "playwright.config.ts", "playwright.config.js",
      "**/playwright.config.ts", "**/playwright.config.js",
      "**/playwright*.config.ts", "**/playwright*.config.js",
    ],
    maxEvidence: 5,
  },
  {
    id: "PW-DEPREC-006",
    title: "Deprecated BrowserContext methods (setHTTPCredentials, backgroundPages)",
    severity: "low",
    description:
      "Deprecated BrowserContext methods detected: setHTTPCredentials() was replaced by httpCredentials in browser.newContext(). backgroundPages() and the 'backgroundpage' event are deprecated (Chromium-only, use service workers instead).",
    recommendation:
      "Replace deprecated BrowserContext methods:\n" +
      "  browserContext.setHTTPCredentials({...})  → browser.newContext({ httpCredentials: {...} })\n" +
      "  browserContext.backgroundPages()          → (use service workers or Chrome DevTools Protocol)\n" +
      "  browserContext.on('backgroundpage', ...)   → (use service workers or Chrome DevTools Protocol)\n" +
      "setHTTPCredentials: https://playwright.dev/docs/next/api/class-browsercontext#browser-context-set-http-credentials\n" +
      "backgroundPages: https://playwright.dev/docs/next/api/class-browsercontext#browser-context-background-pages\n" +
      "on('backgroundpage'): https://playwright.dev/docs/next/api/class-browsercontext#browser-context-event-background-page",
    patterns: [
      /\.setHTTPCredentials\s*\(/g,
      /\.backgroundPages\s*\(/g,
      /\.on\s*\(\s*['"]backgroundpage['"]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts"],
    maxEvidence: 15,
  },

  // ── New rules from Playwright docs audit (2026-02-14) ────────────────
  {
    id: "PW-FLAKE-005",
    title: "Non-retrying assertions used (manual await + toBe instead of web-first assertion)",
    severity: "high",
    description:
      "Using non-retrying assertions like expect(await locator.isVisible()).toBe(true) can lead to flaky tests. Playwright docs explicitly warn: 'using non-retrying assertions can lead to a flaky test.' Web-first assertions (e.g., await expect(locator).toBeVisible()) automatically retry until the condition is met.",
    recommendation:
      "Replace manual await + toBe patterns with web-first assertions:\n" +
      "  expect(await locator.isVisible()).toBe(true)    → await expect(locator).toBeVisible()\n" +
      "  expect(await locator.textContent()).toBe(...)    → await expect(locator).toHaveText(...)\n" +
      "  expect(await locator.getAttribute(...)).toBe(..) → await expect(locator).toHaveAttribute(...)\n" +
      "  expect(await page.title()).toBe(...)             → await expect(page).toHaveTitle(...)\n" +
      "  expect(await page.url()).toBe(...)               → await expect(page).toHaveURL(...)\n" +
      "  expect(await locator.inputValue()).toBe(...)     → await expect(locator).toHaveValue(...)\n" +
      "  expect(await locator.isEnabled()).toBe(true)     → await expect(locator).toBeEnabled()\n" +
      "https://playwright.dev/docs/test-assertions#auto-retrying-assertions",
    patterns: [
      /expect\s*\(\s*await\s+.+?\.isVisible\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.isEnabled\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.isDisabled\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.isChecked\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.isHidden\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.textContent\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.innerText\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.inputValue\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.getAttribute\s*\(/g,
      /expect\s*\(\s*await\s+.+?\.title\s*\(\s*\)\s*\)/g,
      /expect\s*\(\s*await\s+.+?\.url\s*\(\s*\)\s*\)/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-FLAKE-006",
    title: "test.fixme() markers indicate deferred broken tests",
    severity: "low",
    description:
      "test.fixme() marks a test as 'known to fail' so Playwright skips it. While better than test.skip() for visibility, accumulated fixme markers indicate growing technical debt in the test suite.",
    recommendation:
      "Track test.fixme() tests in your backlog and aim to fix or remove them periodically. If a test has been test.fixme'd for a long time, consider whether it's still relevant.\nhttps://playwright.dev/docs/api/class-test#test-fixme-1",
    patterns: [
      /\btest\.fixme\s*\(/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-007",
    title: "Deprecated page.type() / locator.type() usage",
    severity: "medium",
    description:
      "page.type(), frame.type(), locator.type(), and elementHandle.type() were deprecated in Playwright v1.39. Use locator.fill() for setting input values (much faster) or locator.pressSequentially() when character-by-character typing is needed.",
    recommendation:
      "Replace .type() calls with locator.fill() for setting input values:\n" +
      "  await page.type('#input', 'text')           → await page.locator('#input').fill('text')\n" +
      "  await locator.type('text')                   → await locator.fill('text')\n" +
      "Use locator.pressSequentially() only if the page has special keyboard handling.\nhttps://playwright.dev/docs/input#type-characters",
    patterns: [
      /\bpage\.type\s*\(/g,
      /\bframe\.type\s*\(/g,
      /\.type\s*\(\s*['"`]/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts"],
    maxEvidence: 25,
  },
  {
    id: "PW-DEPREC-008",
    title: "Deprecated layout selectors (:left-of, :right-of, :above, :below, :near)",
    severity: "medium",
    description:
      "Layout pseudo-class selectors (:left-of, :right-of, :above, :below, :near) are deprecated per the Playwright docs and may be removed in a future version.",
    recommendation:
      "Replace layout selectors with semantic locators (getByRole, getByLabel, getByTestId) or use locator.filter() with hasText/has options for relative positioning.\nhttps://playwright.dev/docs/other-locators#css-matching-elements-based-on-layout",
    patterns: [
      /:left-of\s*\(/g,
      /:right-of\s*\(/g,
      /:above\s*\(/g,
      /:below\s*\(/g,
      /:near\s*\(/g,
    ],
    fileGlobs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/POMs/**/*.ts", "**/pages/**/*.ts"],
    maxEvidence: 25,
  },

  // ── Cypress Rules ────────────────────────────────────────────────────
  {
    id: "CY-FLAKE-001",
    framework: "cypress",
    title: "Hard waits detected in Cypress tests (cy.wait with numeric ms)",
    severity: "high",
    description:
      "cy.wait() with a numeric argument introduces brittle hard waits identical to Playwright's waitForTimeout. These slow tests and mask real timing issues.",
    recommendation:
      "Replace cy.wait(ms) with cy.intercept() + cy.wait('@alias') to wait for specific network requests, or use cy.get().should() assertions that auto-retry. Hard waits should never be used for synchronization.\nhttps://docs.cypress.io/guides/references/best-practices#Unnecessary-Waiting",
    patterns: [
      /\bcy\.wait\s*\(\s*\d+\s*\)/g,
      /\bcy\.wait\s*\(\s*\d+\s*,/g,
    ],
    fileGlobs: [
      "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
      "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
      "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
    ],
    maxEvidence: 25,
  },
  {
    id: "CY-FLAKE-002",
    framework: "cypress",
    title: "Fragile CSS selectors in Cypress tests (missing data-cy / data-testid)",
    severity: "medium",
    description:
      "cy.get() calls use CSS class or tag selectors that are tightly coupled to styling and DOM structure. These break when CSS or markup changes, even if the feature works correctly.",
    recommendation:
      "Use dedicated test attributes: cy.get('[data-cy=\"submit-btn\"]') or cy.get('[data-testid=\"submit-btn\"]'). Add data-cy attributes to your application markup.\nhttps://docs.cypress.io/guides/references/best-practices#Selecting-Elements",
    patterns: [
      // cy.get('.class-name') or cy.get('tag') without data- attributes
      /\bcy\.get\s*\(\s*['"`]\.[\w-]+['"`]\s*\)/g,
      /\bcy\.get\s*\(\s*['"`]#[\w-]+['"`]\s*\)/g,
    ],
    fileGlobs: [
      "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
      "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
      "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
    ],
    maxEvidence: 25,
  },
  {
    id: "CY-FLAKE-003",
    framework: "cypress",
    title: "Force-click usage detected in Cypress tests",
    severity: "medium",
    description:
      "Cypress commands using { force: true } bypass actionability checks (visibility, disability, cover). This hides genuine UI issues such as overlapping elements, disabled buttons, or elements rendered off-screen.",
    recommendation:
      "Investigate why the element isn't actionable. Fix the underlying DOM/CSS issue rather than forcing clicks. If the element is in a scrollable container, Cypress auto-scrolls — force should rarely be needed.\nhttps://docs.cypress.io/guides/core-concepts/interacting-with-elements#Forcing",
    patterns: [/force\s*:\s*true/g],
    fileGlobs: [
      "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
      "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
      "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
    ],
    maxEvidence: 25,
  },
  {
    id: "CY-LOC-001",
    framework: "cypress",
    title: "XPath selectors detected in Cypress tests",
    severity: "low",
    description:
      "Cypress tests use cy.xpath() or XPath expressions. XPath selectors are brittle, hard to read, and not natively supported by Cypress (requires cypress-xpath plugin).",
    recommendation:
      "Replace XPath selectors with cy.get('[data-cy=\"...\"]') or cy.contains(). Cypress's built-in commands with data-cy attributes are faster and more maintainable.\nhttps://docs.cypress.io/guides/references/best-practices#Selecting-Elements",
    patterns: [
      /\bcy\.xpath\s*\(/g,
      /\bcy\.get\s*\(\s*['"`]\/\/[^'"`]+['"`]\s*\)/g,
    ],
    fileGlobs: [
      "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
      "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
      "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
    ],
    maxEvidence: 25,
  },

  // ── Selenium Rules ───────────────────────────────────────────────────
  {
    id: "SE-FLAKE-001",
    framework: "selenium",
    title: "Hard waits detected in Selenium tests (Thread.sleep / time.sleep)",
    severity: "high",
    description:
      "Thread.sleep() (Java), time.sleep() (Python), or driver.sleep() (JS) in Selenium tests introduce non-deterministic waits that slow execution and mask timing bugs.",
    recommendation:
      "Replace hard sleeps with explicit waits: WebDriverWait (Python/Java), driver.wait() (JS). Wait for specific conditions (element visible, clickable, text present) rather than arbitrary durations.\nhttps://www.selenium.dev/documentation/webdriver/waits/",
    patterns: [
      /\bThread\.sleep\s*\(/g,
      /\btime\.sleep\s*\(/g,
      /\bdriver\.sleep\s*\(/g,
    ],
    fileGlobs: ["**/*.py", "**/*.java", "**/*.ts", "**/*.js"],
    maxEvidence: 25,
  },
  {
    id: "SE-FLAKE-002",
    framework: "selenium",
    title: "Implicit waits detected in Selenium tests",
    severity: "medium",
    description:
      "implicitly_wait() / implicitlyWait() sets a global timeout for all element lookups. Mixing implicit and explicit waits causes unpredictable wait behavior and doubles timeout durations.",
    recommendation:
      "Remove implicit waits entirely and use explicit waits (WebDriverWait / driver.wait) for each interaction. Explicit waits are more predictable and allow waiting for specific conditions.\nhttps://www.selenium.dev/documentation/webdriver/waits/#implicit-waits",
    patterns: [
      /\.implicitly_wait\s*\(/g,
      /\.implicitlyWait\s*\(/g,
      /implicitly_wait\s*\(\s*\d+/g,
    ],
    fileGlobs: ["**/*.py", "**/*.java", "**/*.ts", "**/*.js"],
    maxEvidence: 25,
  },
  {
    id: "SE-LOC-001",
    framework: "selenium",
    title: "XPath selectors detected in Selenium tests",
    severity: "low",
    description:
      "Selenium tests use By.xpath() or find_element(By.XPATH, ...) selectors. XPath expressions are verbose, fragile to DOM changes, and often slower than CSS-based alternatives.",
    recommendation:
      "Prefer By.css_selector / By.CSS_SELECTOR, By.id, By.name, or data-testid attributes. CSS selectors are faster, more readable, and less sensitive to DOM structure changes.\nhttps://www.selenium.dev/documentation/webdriver/elements/locators/",
    patterns: [
      /By\.xpath\s*\(/g,
      /By\.XPATH\s*,/g,
      /find_element\s*\(\s*By\.XPATH/g,
      /find_elements?\s*\(\s*['"]xpath['"]\s*,/g,
    ],
    fileGlobs: ["**/*.py", "**/*.java", "**/*.ts", "**/*.js"],
    maxEvidence: 25,
  },
];

function normalize(p: string) {
  return p.replace(/\\/g, "/");
}

function isIgnored(filePath: string) {
  const p = normalize(filePath).toLowerCase();
  return (
    p.includes("/node_modules/") ||
    p.includes("/dist/") ||
    p.includes("/build/") ||
    p.includes("/.git/") ||
    p.includes("/playwright-report/") ||
    p.includes("/test-results/") ||
    p.includes("/coverage/") ||
    p.includes("/.next/") ||
    p.includes("/.cache/") ||
    p.endsWith(".lock") ||
    p.endsWith(".png") ||
    p.endsWith(".jpg") ||
    p.endsWith(".jpeg") ||
    p.endsWith(".webp") ||
    p.endsWith(".mp4") ||
    p.endsWith(".zip")
  );
}

function lineNumberAtIndex(text: string, idx: number) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function snippetAroundLine(lines: string[], lineIdx: number) {
  const line = lines[lineIdx] ?? "";
  return line.trim().slice(0, 220);
}

// Check if a line is likely a comment or contains contextual false-positive indicators
function isLikelyFalsePositive(lines: string[], lineIdx: number, ruleId: string): boolean {
  const line = (lines[lineIdx] ?? "").trim();
  
  // Skip commented-out code
  if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
    return true;
  }
  
  // PW-FLAKE-001: Tightened retry/polling context exclusion.
  // Only suppress when the matched line ±1 is *inside an actual loop structure*
  // (while/for/do) AND mentions retry/polling. Previously, any file mentioning
  // "retry" anywhere would suppress all findings.
  if (ruleId === "PW-FLAKE-001") {
    const start = Math.max(0, lineIdx - 1);
    const end = Math.min(lines.length - 1, lineIdx + 1);
    const nearContext = lines.slice(start, end + 1).join("\n").toLowerCase();

    const hasLoopStructure = /\b(while|for|do)\b/.test(nearContext);
    const hasRetryIntent =
      nearContext.includes("retry") ||
      nearContext.includes("attempt") ||
      nearContext.includes("polling") ||
      nearContext.includes("backoff") ||
      nearContext.includes("reconnect");

    if (hasLoopStructure && hasRetryIntent) {
      return true;
    }
  }

  // PW-FLAKE-003: Don't flag test.skip() when used as conditional skip
  // (test.skip(condition) is OK — it's the permanent test.skip('name',...) that's bad)
  if (ruleId === "PW-FLAKE-003") {
    // test.skip() as a method call inside test body (conditional) is fine
    if (/test\.skip\s*\(\s*\)/.test(line)) return true;
    // test.skip(boolean_expression) inside a test body
    if (/test\.skip\s*\(\s*(?:true|false|!|process|env)/.test(line)) return true;
  }

  // PW-DEPREC-001: Suppress $/$$ inside page.evaluate() / page.evaluateHandle()
  // where $ may be jQuery or a native browser API, not Playwright's deprecated method.
  if (ruleId === "PW-DEPREC-001") {
    // Check surrounding 3 lines for evaluate context
    const start = Math.max(0, lineIdx - 3);
    const context = lines.slice(start, lineIdx + 1).join("\n");
    if (/\.(evaluate|evaluateHandle|evaluateAll)\s*\(/.test(context)) return true;
    // Also skip if it looks like a CSS selector string referencing $ (e.g., 'input[value$="..."]')
    if (/\[[\w-]+\$=/.test(line)) return true;
  }

  // PW-DEPREC-003: Suppress waitForSelector inside page.evaluate() or when followed by
  // a comment indicating intentional legacy usage
  if (ruleId === "PW-DEPREC-003") {
    const start = Math.max(0, lineIdx - 3);
    const context = lines.slice(start, lineIdx + 1).join("\n");
    if (/\.(evaluate|evaluateHandle)\s*\(/.test(context)) return true;
  }
  
  return false;
}

async function collectEvidence(
  file: string,
  content: string,
  patterns: RegExp[],
  maxEvidence: number,
  ruleId?: string
) {
  const evidence: Evidence[] = [];
  const lines = content.split(/\r?\n/);

  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const line = lineNumberAtIndex(content, m.index);
      
      // Skip false positives based on context
      if (ruleId && isLikelyFalsePositive(lines, line - 1, ruleId)) {
        if (m.index === pat.lastIndex) pat.lastIndex++;
        continue;
      }
      
      evidence.push({
        file,
        line,
        snippet: snippetAroundLine(lines, line - 1),
      });
      if (evidence.length >= maxEvidence) return evidence;
      if (m.index === pat.lastIndex) pat.lastIndex++;
    }
  }

  return evidence;
}

function hasFinding(findings: Finding[], id: string) {
  return findings.some((f) => f.findingId === id && f.evidence.length > 0);
}

function retriesLikelyEnabled(retriesExpr?: string) {
  if (!retriesExpr) return false;
  if (/^\s*0\s*$/.test(retriesExpr)) return false;
  if (retriesExpr.includes("?") && retriesExpr.includes(":")) return true;

  const nums = [...retriesExpr.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
  if (nums.some((n) => Number.isFinite(n) && n > 0)) return true;

  return true;
}

type TestFileAnalysis = {
  testCount: number;
  describeCount: number;
  hasBeforeEach: boolean;
  hasAfterEach: boolean;
  hasBeforeAll: boolean;
  hasAfterAll: boolean;
  usesFixtures: boolean;
  usesPageFixture: boolean;
};

function analyzeTestFile(content: string): TestFileAnalysis {
  // Count test() and test.only() calls
  const testMatches = content.match(/\btest\s*\(/g) || [];
  const testOnlyMatches = content.match(/\btest\.only\s*\(/g) || [];
  const testCount = testMatches.length + testOnlyMatches.length;

  // Count describe() and test.describe() blocks
  const describeMatches = content.match(/\b(?:test\.)?describe\s*\(/g) || [];
  const describeCount = describeMatches.length;

  // Check for lifecycle hooks
  const hasBeforeEach = /\btest\.beforeEach\s*\(|\bbeforeEach\s*\(/i.test(content);
  const hasAfterEach = /\btest\.afterEach\s*\(|\bafterEach\s*\(/i.test(content);
  const hasBeforeAll = /\btest\.beforeAll\s*\(|\bbeforeAll\s*\(/i.test(content);
  const hasAfterAll = /\btest\.afterAll\s*\(|\bafterAll\s*\(/i.test(content);
  
  // Check for Playwright fixtures usage (test.extend or importing extended test)
  const usesFixtures = /\btest\.extend\s*</.test(content) || 
                       /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"][^'"]*fixtures/.test(content) ||
                       /import\s+\{[^}]*test[^}]*\}\s+from\s+['"]\.\.?\//.test(content);
  
  // Check if test function signature includes { page } destructuring (indicates fixture usage)
  const usesPageFixture = /test\s*\([^)]*,\s*async\s*\(\s*\{[^}]*\bpage\b/.test(content);

  return {
    testCount,
    describeCount,
    hasBeforeEach,
    hasAfterEach,
    hasBeforeAll,
    hasAfterAll,
    usesFixtures,
    usesPageFixture,
  };
}

// ============================================
// ARCHITECTURAL ANALYSIS FUNCTIONS
// ============================================

type PomAnalysis = {
  file: string;
  className: string;
  extendsClass: string | null;
  hasPublicLocators: boolean;
  publicLocatorCount: number;
  locatorExamples: string[];
};

function analyzePomFile(filePath: string, content: string): PomAnalysis | null {
  // Check if this looks like a POM file
  const classMatch = content.match(/(?:export\s+)?class\s+(\w+(?:Page|Tab|Modal|Component|Section)?)\s*(?:extends\s+(\w+))?\s*\{/);
  if (!classMatch) return null;
  
  const className = classMatch[1];
  const extendsClass = classMatch[2] || null;
  
  // Check for public locators (this.xxx = page.locator/getBy without private/protected)
  const publicLocatorPatterns = [
    /this\.(\w+)\s*=\s*(?:this\.)?page\.(?:locator|getBy\w+)/g,
    /public\s+(?:readonly\s+)?(\w+)\s*[=:]/g,
  ];
  
  const locatorExamples: string[] = [];
  let publicLocatorCount = 0;
  
  for (const pattern of publicLocatorPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      publicLocatorCount++;
      if (locatorExamples.length < 3) {
        locatorExamples.push(match[1]);
      }
    }
  }
  
  // Check if locators are exposed without encapsulation
  const hasPublicLocators = publicLocatorCount > 5 && !content.includes('private') && !content.includes('protected');
  
  return {
    file: filePath,
    className,
    extendsClass,
    hasPublicLocators,
    publicLocatorCount,
    locatorExamples,
  };
}

type TestCouplingAnalysis = {
  file: string;
  importsFromTestFiles: string[];
};

function analyzeTestCoupling(filePath: string, content: string): TestCouplingAnalysis {
  const importsFromTestFiles: string[] = [];
  
  // Find imports from .spec.ts or .test.ts files
  const importMatches = content.matchAll(/import\s+.*\s+from\s+['"]([^'"]+\.(?:spec|test)(?:\.ts)?)['"]/g);
  for (const match of importMatches) {
    importsFromTestFiles.push(match[1]);
  }
  
  // Also check for require statements
  const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+\.(?:spec|test)(?:\.ts)?)['"]\s*\)/g);
  for (const match of requireMatches) {
    importsFromTestFiles.push(match[1]);
  }
  
  return {
    file: filePath,
    importsFromTestFiles,
  };
}

type HardcodedDataMatch = {
  file: string;
  line: number;
  type: 'email' | 'password' | 'api_key' | 'url' | 'phone' | 'ssn';
  snippet: string;
};

function findHardcodedData(filePath: string, content: string): HardcodedDataMatch[] {
  const matches: HardcodedDataMatch[] = [];
  const lines = content.split(/\r?\n/);
  
  const patterns: Array<{ type: HardcodedDataMatch['type']; regex: RegExp }> = [
    // Email addresses (but not example.com or test domains)
    { type: 'email', regex: /['"`][\w.+-]+@(?!example\.com|test\.com|localhost)[\w.-]+\.[a-z]{2,}['"`]/gi },
    // Passwords in assignments
    { type: 'password', regex: /(?:password|passwd|pwd)\s*[=:]\s*['"`](?!process\.env)[^'"`]{4,}['"`]/gi },
    // API keys (common patterns)
    { type: 'api_key', regex: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[=:]\s*['"`](?!process\.env)[A-Za-z0-9_-]{16,}['"`]/gi },
    // Hardcoded URLs with credentials
    { type: 'url', regex: /['"`]https?:\/\/[^:]+:[^@]+@[^'"`]+['"`]/gi },
    // Phone numbers — only flag when variable name suggests phone/tel/mobile
    // (plain digit strings produce too many false positives: IDs, zip codes, etc.)
    { type: 'phone', regex: /(?:phone|tel|mobile|fax)\s*[=:]\s*['"`]\+?\d[\d\s().-]{6,}['"`]/gi },
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    
    for (const { type, regex } of patterns) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        // Additional filtering for false positives
        if (type === 'email' && (line.includes('@example') || line.includes('@test') || line.includes('faker'))) continue;
        if (type === 'password' && line.includes('process.env')) continue;
        
        matches.push({
          file: filePath,
          line: i + 1,
          type,
          snippet: line.trim().slice(0, 150),
        });
      }
    }
  }
  
  return matches.slice(0, 20); // Limit to 20 matches per file
}

type FixtureTypingAnalysis = {
  file: string;
  hasAnyTypes: boolean;
  anyTypeCount: number;
  hasProperTyping: boolean;
};

function analyzeFixtureTyping(filePath: string, content: string): FixtureTypingAnalysis {
  // Check for 'any' type usage
  const anyMatches = content.match(/:\s*any\b/g) || [];
  const anyTypeCount = anyMatches.length;
  
  // Check for proper fixture typing (test.extend<{...}>)
  const hasProperTyping = /test\.extend\s*<\s*\{/.test(content);
  
  return {
    file: filePath,
    hasAnyTypes: anyTypeCount > 0,
    anyTypeCount,
    hasProperTyping,
  };
}

type ApiMockingAnalysis = {
  hasRouteMocking: boolean;
  hasRequestInterception: boolean;
  mockingFiles: string[];
};

function analyzeApiMocking(files: string[], contents: Map<string, string>): ApiMockingAnalysis {
  const mockingFiles: string[] = [];
  let hasRouteMocking = false;
  let hasRequestInterception = false;
  
  for (const file of files) {
    const content = contents.get(file);
    if (!content) continue;
    
    // Check for route mocking
    if (/page\.route\s*\(/.test(content) || /context\.route\s*\(/.test(content)) {
      hasRouteMocking = true;
      mockingFiles.push(file);
    }
    
    // Check for request interception
    if (/page\.on\s*\(\s*['"]request['"]/.test(content) || /page\.on\s*\(\s*['"]response['"]/.test(content)) {
      hasRequestInterception = true;
      if (!mockingFiles.includes(file)) mockingFiles.push(file);
    }
  }
  
  return {
    hasRouteMocking,
    hasRequestInterception,
    mockingFiles,
  };
}

type ErrorHandlingAnalysis = {
  file: string;
  hasGenericThrows: boolean;
  genericThrowCount: number;
  hasCustomErrors: boolean;
};

function analyzeErrorHandling(filePath: string, content: string): ErrorHandlingAnalysis {
  // Check for generic throws (throw new Error without custom class)
  const genericThrowMatches = content.match(/throw\s+new\s+Error\s*\(/g) || [];
  const genericThrowCount = genericThrowMatches.length;
  
  // Check for custom error classes
  const hasCustomErrors = /class\s+\w+Error\s+extends\s+Error/.test(content) ||
                         /throw\s+new\s+(?!Error\b)\w+Error\s*\(/.test(content);
  
  return {
    file: filePath,
    hasGenericThrows: genericThrowCount > 0,
    genericThrowCount,
    hasCustomErrors,
  };
}

// ── Resource Leak Detection ─────────────────────────────────────────

type ResourceLeakResult = {
  file: string;
  creationPatterns: string[];
  line: number;
};

function findBrowserResourceLeaks(filePath: string, content: string): ResourceLeakResult[] {
  const results: ResourceLeakResult[] = [];

  // Skip files that only use fixture destructuring (auto-cleanup)
  if (/test\s*\([^)]*,\s*async\s*\(\s*\{[^}]*\b(?:page|browser|context)\b/.test(content) &&
      !/chromium\.launch|firefox\.launch|webkit\.launch|browser\.newContext\(|browser\.newPage\(|context\.newPage\(/.test(content)) {
    return results;
  }

  const creationPatterns = [
    /\b(?:chromium|firefox|webkit)\.launch\s*\(/g,
    /\bbrowser\.newContext\s*\(/g,
    /\bbrowser\.newPage\s*\(/g,
    /\bcontext\.newPage\s*\(/g,
  ];

  const cleanupPatterns = [
    /\bbrowser\.close\s*\(/,
    /\bcontext\.close\s*\(/,
    /\bpage\.close\s*\(/,
  ];

  const hookPattern = /\b(?:afterEach|afterAll|test\.afterEach|test\.afterAll)\s*\(/;

  const lines = content.split(/\r?\n/);
  const foundCreations: Array<{ pattern: string; line: number }> = [];

  for (const re of creationPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const lineNum = lineNumberAtIndex(content, m.index);
      const lineText = lines[lineNum - 1]?.trim() ?? "";
      if (!lineText.startsWith("//") && !lineText.startsWith("*")) {
        foundCreations.push({ pattern: m[0], line: lineNum });
      }
    }
  }

  if (foundCreations.length === 0) return results;

  // Check if cleanup exists in an afterEach/afterAll hook
  const hasCleanup = cleanupPatterns.some((p) => p.test(content));
  const hasHook = hookPattern.test(content);
  const cleanupInHook = hasCleanup && hasHook;

  if (!cleanupInHook) {
    results.push({
      file: filePath,
      creationPatterns: foundCreations.map((c) => c.pattern),
      line: foundCreations[0].line,
    });
  }

  return results;
}

function findSeleniumResourceLeaks(filePath: string, content: string): ResourceLeakResult[] {
  const results: ResourceLeakResult[] = [];

  const creationPatterns = [
    /\bwebdriver\.Chrome\s*\(/g,
    /\bwebdriver\.Firefox\s*\(/g,
    /\bwebdriver\.Edge\s*\(/g,
    /\bwebdriver\.Safari\s*\(/g,
    /\bwebdriver\.Remote\s*\(/g,
    /\bnew\s+ChromeDriver\s*\(/g,
    /\bnew\s+FirefoxDriver\s*\(/g,
    /\bnew\s+RemoteWebDriver\s*\(/g,
  ];

  const cleanupPattern = /\.quit\s*\(/;
  const teardownPattern = /\bteardown_method\b|\btearDown\b|\b@After\b|\bafterEach\b|\bafterAll\b/;

  const lines = content.split(/\r?\n/);
  const foundCreations: Array<{ pattern: string; line: number }> = [];

  for (const re of creationPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const lineNum = lineNumberAtIndex(content, m.index);
      const lineText = lines[lineNum - 1]?.trim() ?? "";
      if (!lineText.startsWith("#") && !lineText.startsWith("//") && !lineText.startsWith("*")) {
        foundCreations.push({ pattern: m[0], line: lineNum });
      }
    }
  }

  if (foundCreations.length === 0) return results;

  const hasCleanup = cleanupPattern.test(content);
  const hasTeardown = teardownPattern.test(content);
  const cleanupInTeardown = hasCleanup && hasTeardown;

  if (!cleanupInTeardown) {
    results.push({
      file: filePath,
      creationPatterns: foundCreations.map((c) => c.pattern),
      line: foundCreations[0].line,
    });
  }

  return results;
}

// ── Over-Assertion Detection ────────────────────────────────────────

type OverAssertedTest = {
  file: string;
  testName: string;
  assertionCount: number;
  line: number;
};

function findOverAssertedTests(filePath: string, content: string): OverAssertedTest[] {
  const results: OverAssertedTest[] = [];

  // Find test boundaries using test( or test.only(
  const testStartRe = /\btest(?:\.only)?\s*\(\s*(['"`])((?:(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;

  while ((m = testStartRe.exec(content)) !== null) {
    const testName = m[2];
    const testLine = lineNumberAtIndex(content, m.index);

    // Find the arrow function body opening brace (=> {), skipping destructuring braces
    const afterMatch = content.slice(m.index + m[0].length);
    const arrowMatch = afterMatch.match(/=>\s*\{/);
    if (!arrowMatch || arrowMatch.index === undefined) continue;
    let braceStart = m.index + m[0].length + arrowMatch.index + arrowMatch[0].length - 1;

    // Extract test body using brace-depth counting
    let depth = 1;
    let i = braceStart + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }

    if (depth !== 0) continue;

    const testBody = content.slice(braceStart, i);

    // Skip tests with data-driven loops wrapping assertions
    if (/\bfor\s*\(/.test(testBody) || /\.forEach\s*\(/.test(testBody)) continue;

    // Count expect() / expect.soft() / expect.poll() calls
    const assertionMatches = testBody.match(/\bexpect\s*(?:\.(?:soft|poll)\s*)?\(/g);
    const assertionCount = assertionMatches ? assertionMatches.length : 0;

    if (assertionCount > 5) {
      results.push({
        file: filePath,
        testName,
        assertionCount,
        line: testLine,
      });
    }
  }

  return results;
}

// ── Inline Test Data Detection ──────────────────────────────────────

type InlineTestDataMatch = {
  file: string;
  line: number;
  snippet: string;
  type: string;
};

function findInlineTestDataInFile(filePath: string, content: string): InlineTestDataMatch[] {
  const matches: InlineTestDataMatch[] = [];
  const lines = content.split(/\r?\n/);

  // Variable-name-anchored patterns
  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /\b(?:username|userName|user_name)\s*=\s*['"`]/i, type: "username" },
    { re: /\b(?:firstName|first_name|lastname|last_name)\s*=\s*['"`]/i, type: "name" },
    { re: /\b(?:address|street|streetAddress|street_address)\s*=\s*['"`]/i, type: "address" },
    { re: /\b(?:zipCode|zip_code|postalCode|postal_code)\s*=\s*['"`]\d/i, type: "zipCode" },
    { re: /\b(?:birthDate|birth_date|dob|dateOfBirth)\s*=\s*['"`]\d/i, type: "date" },
    { re: /\b(?:cardNumber|card_number|creditCard|credit_card)\s*=\s*['"`]\d/i, type: "creditCard" },
    { re: /\b(?:price|amount|cost)\s*=\s*['"`]\$?\d/i, type: "price" },
    { re: /\b(?:phoneNumber|phone_number|phone)\s*=\s*['"`]\+?\d/i, type: "phone" },
    { re: /\b(?:city|town)\s*=\s*['"`][A-Z]/i, type: "city" },
  ];

  // Skip patterns — environment variables, faker, fixtures, comments
  const skipPatterns = /process\.env|Cypress\.env|os\.environ|\bfaker\b|\bfixture\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("*") || line.startsWith("/*")) continue;

    // Skip lines with env/faker/fixture patterns
    if (skipPatterns.test(line)) continue;

    for (const { re, type } of patterns) {
      if (re.test(line)) {
        matches.push({
          file: filePath,
          line: i + 1,
          snippet: line.slice(0, 120),
          type,
        });
        break; // One match per line is enough
      }
    }
  }

  return matches;
}

export async function scanRepo(repoPath: string, options: ScanOptions = {}): Promise<ScanResults> {
  if (!existsSync(repoPath)) {
    console.warn(`[audit] Repo path does not exist: ${repoPath} — producing empty scan result.`);
    const repoName = path.basename(path.resolve(repoPath));
    return {
      repoPath,
      inventory: {
        totalFiles: 0,
        testFiles: 0,
        hasPlaywrightConfig: false,
        playwrightVersion: null,
        detectedFrameworks: [],
      },
      findings: [
        {
          findingId: "SCAN-MISSING-REPO",
          severity: "high",
          title: "Repository path not found",
          description: `The target repository path "${repoPath}" does not exist. This may indicate the repo was moved or deleted. No files were scanned.`,
          recommendation: "Verify that the repository path is correct and accessible, then re-run the audit.",
          evidence: [],
        },
      ],
      gitBranch: undefined,
      gitCommit: undefined,
    };
  }

  const git = getGitInfo(repoPath);

  const allFiles = (await fg(["**/*"], {
    cwd: repoPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })) as string[];

  const files = allFiles.filter((f) => !isIgnored(f));

  // Match standard AND variant Playwright config names:
  //   playwright.config.ts, playwright-ci.config.ts, playwright-local.config.js,
  //   playwright-mobile.config.js, playwright.ct.config.ts, etc.
  const PW_CONFIG_RE = /playwright[-.]?[\w.-]*\.config\.(ts|js|mjs|cjs)$/i;

  const allConfigFiles = files.filter((f) => PW_CONFIG_RE.test(path.basename(f)));

  const inventory: Inventory = {
    totalFiles: files.length,
    testFiles: files.filter((f) =>
      /\.(spec|test)\.(ts|js|tsx|jsx)$/.test(f)
    ).length,
    hasPlaywrightConfig: allConfigFiles.length > 0,
    playwrightConfigPaths: allConfigFiles.length
      ? allConfigFiles.map((f) => path.relative(repoPath, f).replace(/\\/g, "/"))
      : undefined,
    playwrightVersion: null,
    detectedFrameworks: [],
  };

  const findings: Finding[] = [];

  // ── Locate package.json ────────────────────────────────────────────
  // Prefer root-level package.json (same directory as repoPath).
  // fast-glob does not guarantee ordering, so files.find() may return
  // a nested package.json first.  Explicitly check the root first.
  const allPkgJsonPaths = files.filter((f) => path.basename(f) === "package.json");
  const rootPkgPath = allPkgJsonPaths.find(
    (f) => normalize(path.dirname(f)) === normalize(path.resolve(repoPath)),
  );
  let pkgPath = rootPkgPath || allPkgJsonPaths[0];

  let pkgJson: any | undefined;
  if (pkgPath) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
      pkgJson = pkg;
      inventory.playwrightVersion =
        pkg.devDependencies?.["@playwright/test"] ||
        pkg.dependencies?.["@playwright/test"] ||
        null;
    } catch {
      inventory.playwrightVersion = null;
    }
  }

  // If the root package.json didn't contain @playwright/test, look for it
  // in the package.json co-located with the Playwright config, then in any
  // other package.json across the repo.
  if (!inventory.playwrightVersion && allPkgJsonPaths.length > 1) {
    // 1. Check package.json next to the Playwright config
    const configDir = allConfigFiles.length
      ? normalize(path.dirname(allConfigFiles[0]))
      : null;
    const configPkgPath = configDir
      ? allPkgJsonPaths.find(
          (f) => normalize(path.dirname(f)) === configDir && f !== pkgPath,
        )
      : undefined;

    // 2. Collect candidates: config-adjacent first, then everything else
    const candidates = [
      ...(configPkgPath ? [configPkgPath] : []),
      ...allPkgJsonPaths.filter((f) => f !== pkgPath && f !== configPkgPath),
    ];

    for (const candidatePath of candidates) {
      try {
        const pkg = JSON.parse(await fs.readFile(candidatePath, "utf8"));
        const ver =
          pkg.devDependencies?.["@playwright/test"] ||
          pkg.dependencies?.["@playwright/test"] ||
          null;
        if (ver) {
          inventory.playwrightVersion = ver;
          // Update pkgJson + pkgPath so downstream dep checks use the right package.json
          pkgJson = pkg;
          pkgPath = candidatePath;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  try {
    // Pick the "primary" config for deep extraction:
    //   1. Prefer the standard name (playwright.config.{ts,js,...}) at repo root
    //   2. Then standard name anywhere
    //   3. Then first variant found
    const isStandardName = (f: string) =>
      /^playwright\.config\.(ts|js|mjs|cjs)$/.test(path.basename(f));
    const primaryConfig =
      allConfigFiles.find((f) => isStandardName(f) && path.dirname(f) === repoPath) ||
      allConfigFiles.find((f) => isStandardName(f)) ||
      allConfigFiles[0];
    const pwConfig = primaryConfig
      ? await extractPlaywrightConfig(repoPath, primaryConfig)
      : undefined;
    if (pwConfig) inventory.playwrightConfigSummary = pwConfig;
  } catch {
    inventory.playwrightConfigSummary = undefined;
  }

  await maybeAddOutdatedDependencyFinding({
    repoPath,
    pkgPath,
    pkg: pkgJson,
    pwConfig: inventory.playwrightConfigSummary,
    findings,
    enabled: Boolean(options.checkOutdatedDependencies),
  });

  try {
    const ciSummary = await extractCiSummary(repoPath);
    inventory.ciSummary = ciSummary;
  } catch (e) {
    inventory.ciSummary = {
      files: [],
      detectedAzurePipelines: false,
      detectedGitHubActions: false,
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
      notes: [`CI extraction failed: ${String(e)}`],
    };
  }

  // ============================================
  // Framework detection: Playwright, Cypress, Selenium
  // ============================================
  if (inventory.hasPlaywrightConfig || inventory.playwrightVersion) {
    inventory.detectedFrameworks.push("playwright");
  }

  // Cypress detection
  try {
    const cypressConfig = await extractCypressConfig(repoPath);
    if (cypressConfig) {
      inventory.detectedFrameworks.push("cypress");
      inventory.cypressConfigSummary = cypressConfig;
      // Count Cypress test files
      const cypressTestGlobs = [
        "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
        "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
        "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
      ];
      const cypressTestFiles = (await fg(cypressTestGlobs, {
        cwd: repoPath,
        absolute: true,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
      })) as string[];
      inventory.cypressTestFiles = cypressTestFiles.filter((f) => !isIgnored(f)).length;
    }
  } catch {
    // Cypress detection failed silently
  }

  // Selenium detection (scan for selenium imports/dependencies)
  try {
    const seleniumIndicators: string[] = [];
    // Check package.json for selenium-webdriver
    if (pkgJson) {
      const allDeps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
      if (allDeps["selenium-webdriver"] || allDeps["webdriverio"] || allDeps["nightwatch"]) {
        seleniumIndicators.push("npm");
      }
    }
    // Check for requirements.txt with selenium
    const reqTxt = files.find((f) => path.basename(f) === "requirements.txt");
    if (reqTxt) {
      const reqContent = await fs.readFile(reqTxt, "utf8");
      if (/\bselenium\b/i.test(reqContent)) seleniumIndicators.push("pip");
    }
    // Check for pom.xml with selenium
    const pomXml = files.find((f) => path.basename(f) === "pom.xml");
    if (pomXml) {
      const pomContent = await fs.readFile(pomXml, "utf8");
      if (/selenium/i.test(pomContent)) seleniumIndicators.push("maven");
    }
    // Quick scan: look for Selenium imports in source files
    if (!seleniumIndicators.length) {
      const seleniumFileGlobs = ["**/*.py", "**/*.java", "**/*.ts", "**/*.js"];
      const candidateFiles = (await fg(seleniumFileGlobs, {
        cwd: repoPath,
        absolute: true,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
      })) as string[];
      const filtered = candidateFiles.filter((f) => !isIgnored(f)).slice(0, 50);
      let seTestCount = 0;
      for (const f of filtered) {
        try {
          const content = await fs.readFile(f, "utf8");
          if (
            /from\s+selenium\b/.test(content) ||
            /import\s+org\.openqa\.selenium/.test(content) ||
            /require\s*\(\s*['"]selenium-webdriver['"]/.test(content) ||
            /from\s+['"]selenium-webdriver['"]/.test(content)
          ) {
            seTestCount++;
          }
        } catch { /* skip */ }
      }
      if (seTestCount > 0) {
        seleniumIndicators.push("imports");
        inventory.seleniumTestFiles = seTestCount;
      }
    }
    if (seleniumIndicators.length > 0) {
      inventory.detectedFrameworks.push("selenium");
    }
  } catch {
    // Selenium detection failed silently
  }

  for (const rule of RULES) {
    // Skip framework-specific rules when that framework isn't detected
    if (rule.framework && !inventory.detectedFrameworks.includes(rule.framework)) {
      continue;
    }

    const targetFiles = (await fg(rule.fileGlobs, {
      cwd: repoPath,
      absolute: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    })) as string[];

    const scopedFiles = targetFiles.filter((f) => !isIgnored(f));
    let evidence: Evidence[] = [];
    const max = rule.maxEvidence ?? 20;

    for (const f of scopedFiles) {
      if (evidence.length >= max) break;
      const content = await fs.readFile(f, "utf8");
      const ev = await collectEvidence(
        normalize(f),
        content,
        rule.patterns,
        max - evidence.length,
        rule.id
      );
      evidence = evidence.concat(ev);
    }

    if (evidence.length) {
      findings.push({
        findingId: rule.id,
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation,
        evidence,
      });
    }
  }

  // Get retry configuration early (needed for correlation checks)
  const retriesExpr = inventory.playwrightConfigSummary?.retries;
  const retriesEnabled = retriesLikelyEnabled(retriesExpr);

  // ============================================
  // Cypress-specific config-based findings
  // ============================================
  if (inventory.cypressConfigSummary) {
    const cyConfig = inventory.cypressConfigSummary;

    // CY-PERF-001: Missing baseUrl
    if (!cyConfig.baseUrl) {
      findings.push({
        findingId: "CY-PERF-001",
        severity: "medium",
        title: "Missing baseUrl in Cypress configuration",
        description:
          "Cypress config does not define a baseUrl. Without baseUrl, every cy.visit() must use a full URL, making it hard to switch between environments (dev, staging, prod) and violating DRY.",
        recommendation:
          "Add baseUrl to your cypress.config.ts e2e block: baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3000'. Then use cy.visit('/path') instead of cy.visit('http://localhost:3000/path').\nhttps://docs.cypress.io/guides/references/best-practices#Setting-a-Global-baseUrl",
        evidence: [{
          file: normalize(cyConfig.configPath),
          line: 1,
          snippet: "baseUrl not configured in Cypress config",
        }],
      });
    }

    // CY-PERF-002: Default command timeout too high
    if (cyConfig.defaultCommandTimeout && cyConfig.defaultCommandTimeout > 30000) {
      findings.push({
        findingId: "CY-PERF-002",
        severity: "medium",
        title: `Excessive defaultCommandTimeout (${cyConfig.defaultCommandTimeout}ms)`,
        description:
          `Cypress defaultCommandTimeout is set to ${cyConfig.defaultCommandTimeout}ms (${Math.round(cyConfig.defaultCommandTimeout / 1000)}s). High timeouts mask slow application responses and make failing tests hang for too long.`,
        recommendation:
          "Set defaultCommandTimeout to 10-15s maximum. If specific commands need longer, use cy.get(selector, { timeout: 30000 }) for those specific cases.\nhttps://docs.cypress.io/guides/references/configuration#Timeouts",
        evidence: [{
          file: normalize(cyConfig.configPath),
          line: 1,
          snippet: `defaultCommandTimeout: ${cyConfig.defaultCommandTimeout}`,
        }],
      });
    }

    // CY-STABILITY-001: No cy.intercept() in test files (no network mocking)
    if (inventory.cypressTestFiles && inventory.cypressTestFiles >= 5) {
      const cypressTestGlobs = [
        "**/*.cy.ts", "**/*.cy.js", "**/*.cy.tsx", "**/*.cy.jsx",
        "cypress/e2e/**/*.ts", "cypress/e2e/**/*.js",
        "cypress/integration/**/*.ts", "cypress/integration/**/*.js",
      ];
      const cyTestFiles = (await fg(cypressTestGlobs, {
        cwd: repoPath,
        absolute: true,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
      })) as string[];
      const filteredCyTests = cyTestFiles.filter((f) => !isIgnored(f));
      let hasIntercept = false;
      for (const f of filteredCyTests.slice(0, 100)) {
        try {
          const content = await fs.readFile(f, "utf8");
          if (/\bcy\.intercept\s*\(/.test(content)) {
            hasIntercept = true;
            break;
          }
        } catch { /* skip */ }
      }
      if (!hasIntercept) {
        findings.push({
          findingId: "CY-STABILITY-001",
          severity: "low",
          title: "No cy.intercept() usage detected in Cypress tests",
          description:
            `No cy.intercept() patterns found across ${filteredCyTests.length} Cypress test files. Network interception enables faster, more reliable tests by mocking API responses and controlling network behavior.`,
          recommendation:
            "Use cy.intercept() to mock API responses for faster, deterministic tests. This allows testing error states, slow responses, and edge cases without backend dependencies.\nhttps://docs.cypress.io/api/commands/intercept",
          evidence: [{
            file: normalize(cyConfig.configPath),
            line: 1,
            snippet: `${filteredCyTests.length} Cypress test files; no cy.intercept() found`,
          }],
        });
      }
    }
  }

  // Test file structure analysis for stability checks
  const testFiles = (await fg(["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"], {
    cwd: repoPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })) as string[];

  const filteredTestFiles = testFiles.filter((f) => !isIgnored(f));

  // PW-STABILITY-001: Shared state / missing cleanup hooks
  // Categorize files by risk level
  const filesNoHooksAtAll: Array<{file: string; testCount: number; analysis: TestFileAnalysis}> = [];
  const filesOnlyBeforeAfterAll: Array<{file: string; testCount: number; analysis: TestFileAnalysis}> = [];
  
  // PW-STABILITY-002: Missing organization
  const filesWithoutOrganization: Array<{file: string; testCount: number}> = [];

  // PW-STABILITY-003: Using page fixture in beforeAll (shared state risk)
  const beforeAllUsesPage: Evidence[] = [];
  const beforeAllUsesPagePatterns: RegExp[] = [
    /\btest\.beforeAll\s*\(\s*(?:async\s*)?\(\s*\{\s*[^}]*\bpage\b[^}]*\}\s*\)\s*=>/gi,
    /\bbeforeAll\s*\(\s*(?:async\s*)?\(\s*\{\s*[^}]*\bpage\b[^}]*\}\s*\)\s*=>/gi,
  ];

  for (const testFile of filteredTestFiles) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const analysis = analyzeTestFile(content);

      // STABILITY-003: Flag any beforeAll using the Playwright page fixture
      // This commonly causes shared browser state and flaky cascades.
      const beforeAllPageEvidence = await collectEvidence(
        normalize(testFile),
        content,
        beforeAllUsesPagePatterns,
        1,
        "PW-STABILITY-003"
      );
      if (beforeAllPageEvidence.length > 0) {
        beforeAllUsesPage.push(beforeAllPageEvidence[0]);
      }

      // STABILITY-001: Multiple tests without per-test cleanup hooks
      // Skip files that use Playwright fixtures (they handle state via fixture lifecycle)
      if (!analysis.usesFixtures && analysis.testCount >= 3 && !analysis.hasBeforeEach && !analysis.hasAfterEach) {
        const hasAnyAllHooks = analysis.hasBeforeAll || analysis.hasAfterAll;
        
        if (hasAnyAllHooks) {
          // Has beforeAll/afterAll but no beforeEach/afterEach
          // This is less risky - only flag if many tests (5+) since beforeAll/afterAll 
          // indicates intentional shared setup (e.g., login once, run multiple tests)
          if (analysis.testCount >= 5) {
            filesOnlyBeforeAfterAll.push({ 
              file: normalize(testFile), 
              testCount: analysis.testCount,
              analysis 
            });
          }
        } else {
          // No hooks at all - higher risk
          filesNoHooksAtAll.push({ 
            file: normalize(testFile), 
            testCount: analysis.testCount,
            analysis 
          });
        }
      }

      // STABILITY-002: 10+ tests without describe blocks
      if (analysis.testCount >= 10 && analysis.describeCount === 0) {
        filesWithoutOrganization.push({ 
          file: normalize(testFile), 
          testCount: analysis.testCount 
        });
      }
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  // STABILITY-003 finding
  if (beforeAllUsesPage.length > 0) {
    findings.push({
      findingId: "PW-STABILITY-003",
      severity: "high",
      title: "Test isolation risk: page fixture used in beforeAll",
      description:
        `${beforeAllUsesPage.length} test file(s) use the Playwright page fixture inside beforeAll. This pattern often creates shared browser state across tests, leading to hard-to-debug flakiness and cascading failures (especially under retries or parallel execution).`,
      recommendation:
        "Move UI setup and navigation that relies on the test 'page' into test.beforeEach(). Reserve test.beforeAll() for external setup that does not depend on the page fixture (e.g., API calls). If you truly need one-time UI setup, create your own context/page via the 'browser' fixture in beforeAll and close it in afterAll. \nhttps://playwright.dev/docs/api/class-test#test-before-all",
      evidence: beforeAllUsesPage.slice(0, 25),
    });
  }

  // STABILITY-001 finding - split into two severity levels
  const totalFilesWithIssues = filesNoHooksAtAll.length + filesOnlyBeforeAfterAll.length;
  
  if (totalFilesWithIssues > 0) {
    // High-risk: files with NO hooks at all
    if (filesNoHooksAtAll.length > 0) {
      const topFiles = filesNoHooksAtAll
        .sort((a, b) => b.testCount - a.testCount)
        .slice(0, 20);

      const severity = retriesEnabled ? "high" : "medium";
      
      findings.push({
        findingId: "PW-STABILITY-001",
        severity,
        title: retriesEnabled 
          ? "Shared state detected (no lifecycle hooks + retries enabled)"
          : "Shared state risk (no lifecycle hooks)",
        description: retriesEnabled
          ? `${filesNoHooksAtAll.length} test file(s) contain multiple tests but have NO lifecycle hooks (beforeEach/afterEach/beforeAll/afterAll). Playwright gives each test its own BrowserContext automatically, but custom state (global variables, API sessions, database records) still needs explicit cleanup. Combined with retries, leftover state from a first attempt can affect retries.`
          : `${filesNoHooksAtAll.length} test file(s) contain multiple tests but have NO lifecycle hooks. Playwright isolates each test with its own BrowserContext, but custom state (global variables, external services, database records) may still leak without explicit cleanup hooks.`,
        recommendation:
          "Add lifecycle hooks (beforeEach/afterEach) for custom state cleanup (API sessions, databases, global variables). Note: Playwright's built-in page/context fixtures already handle browser isolation automatically — hooks are needed for non-browser state. \nhttps://playwright.dev/docs/test-fixtures\nhttps://playwright.dev/docs/api/class-test#test-before-each",
        evidence: topFiles.map(({ file, testCount }) => ({
          file,
          line: 1,
          snippet: `${testCount} tests, no lifecycle hooks at all`,
        })),
      });
    }
    
    // Medium-risk: files with beforeAll/afterAll but no beforeEach/afterEach (only if many such files)
    if (filesOnlyBeforeAfterAll.length >= 3) {
      const topFiles = filesOnlyBeforeAfterAll
        .sort((a, b) => b.testCount - a.testCount)
        .slice(0, 15);

      findings.push({
        findingId: "PW-STABILITY-001a",
        severity: "low",
        title: "Test isolation could be improved (beforeAll/afterAll only)",
        description:
          `${filesOnlyBeforeAfterAll.length} test file(s) use beforeAll/afterAll for shared setup but lack beforeEach/afterEach for per-test cleanup. While shared setup is valid for performance, per-test cleanup helps ensure test independence and easier debugging.`,
        recommendation:
          "Consider adding test.beforeEach() for state that should be fresh per test (e.g., clearing localStorage, resetting mocks). Keep beforeAll for expensive one-time setup (login, data seeding). This is lower priority than files with no hooks at all.  \nhttps://playwright.dev/docs/api/class-test#test-before-each",
        evidence: topFiles.map(({ file, testCount }) => ({
          file,
          line: 1,
          snippet: `${testCount} tests with beforeAll/afterAll only`,
        })),
      });
    }
  }

  // STABILITY-002 finding
  if (filesWithoutOrganization.length > 0) {
    const topFiles = filesWithoutOrganization
      .sort((a, b) => b.testCount - a.testCount)
      .slice(0, 25);

    findings.push({
      findingId: "PW-STABILITY-002",
      severity: "medium",
      title: "Poor test organization (large files without describe blocks)",
      description:
        `${filesWithoutOrganization.length} test file(s) contain 10+ tests but have no test.describe() blocks for organization. This makes test failures harder to categorize, impacts reporting clarity, and increases maintenance burden.`,
      recommendation:
        "Organize tests into logical groups using test.describe() blocks. Group related tests (e.g., 'Login flow', 'User profile', 'Error handling'). This improves test reports, makes failures easier to understand, and helps with targeted test execution using --grep.",
      evidence: topFiles.map(({ file, testCount }) => ({
        file,
        line: 1,
        snippet: `${testCount} tests with no test.describe() organization`,
      })),
    });
  }

  // ============================================
  // PW-STABILITY-004: Tests without assertions
  // ============================================
  const testsWithoutAssertions: Array<{ file: string; testCount: number; assertionCount: number }> = [];

  for (const testFile of filteredTestFiles) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const analysis = analyzeTestFile(content);
      if (analysis.testCount === 0) continue;

      // Count assertions by counting expect() / expect.soft() / expect.poll() calls.
      // Previously this also counted individual matchers (.toBeVisible, .toHaveText, etc.)
      // which double-counted: `expect(loc).toBeVisible()` matched BOTH expect( AND .toBeVisible(,
      // inflating the count ~2x and making the threshold too forgiving.
      // Every Playwright assertion chains off one of these entry points, so they are
      // the single reliable anchors.
      const assertionPattern = /\bexpect\s*(?:\.(?:soft|poll)\s*)?\(/g;
      const assertionMatches = content.match(assertionPattern);
      const assertionCount = assertionMatches ? assertionMatches.length : 0;

      // Flag files where assertion count is very low relative to test count
      // Heuristic: fewer than 1 assertion (expect call) per test indicates likely missing checks
      if (analysis.testCount >= 2 && assertionCount < analysis.testCount) {
        testsWithoutAssertions.push({
          file: normalize(testFile),
          testCount: analysis.testCount,
          assertionCount,
        });
      }
    } catch {
      continue;
    }
  }

  if (testsWithoutAssertions.length > 0) {
    const sorted = testsWithoutAssertions.sort((a, b) => b.testCount - a.testCount);
    findings.push({
      findingId: "PW-STABILITY-004",
      severity: "high",
      title: "Tests without assertions (expect()) detected",
      description:
        `${testsWithoutAssertions.length} test file(s) contain tests but have very few or no assertions. Tests that navigate but never assert are 'green noise', they always pass and provide zero quality signal.`,
      recommendation:
        "Every test should contain at least one expect() assertion that verifies observable behavior. Add assertions for page content, URLs, API responses, or element states. Focus on the most critical user flows first.",
      evidence: sorted.slice(0, 20).map(({ file, testCount, assertionCount }) => ({
        file,
        line: 1,
        snippet: `${testCount} tests but only ${assertionCount} assertion(s)`,
      })),
    });
  }

  // ============================================
  // PW-STABILITY-005: Browser resource leak risk
  // ============================================
  const resourceLeakEvidence: ResourceLeakResult[] = [];

  for (const testFile of filteredTestFiles) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const leaks = findBrowserResourceLeaks(normalize(testFile), content);
      resourceLeakEvidence.push(...leaks);
    } catch {
      continue;
    }
  }

  if (resourceLeakEvidence.length > 0) {
    findings.push({
      findingId: "PW-STABILITY-005",
      severity: "medium",
      title: "Browser resource leak risk",
      description:
        `${resourceLeakEvidence.length} test file(s) manually create browser/context/page resources without proper cleanup in afterEach/afterAll hooks. This can leak browser processes, cause memory pressure, and leave zombie processes on CI runners.`,
      recommendation:
        "Either use Playwright's built-in fixtures (({ page }) => ...) which auto-cleanup, or add explicit browser.close()/context.close()/page.close() calls inside afterEach/afterAll hooks.",
      evidence: resourceLeakEvidence.slice(0, 10).map((r) => ({
        file: r.file,
        line: r.line,
        snippet: `Manual resource creation: ${r.creationPatterns.join(", ")} — no cleanup in afterEach/afterAll`,
      })),
    });
  }

  // ============================================
  // SE-STABILITY-001: WebDriver resource leak risk
  // ============================================
  if (inventory.detectedFrameworks.includes("selenium")) {
    const seleniumLeakEvidence: ResourceLeakResult[] = [];

    const seleniumFileGlobs = ["**/*.py", "**/*.java", "**/*.ts", "**/*.js"];
    const seleniumCandidateFiles = (await fg(seleniumFileGlobs, {
      cwd: repoPath,
      absolute: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    })) as string[];

    const filteredSeleniumFiles = seleniumCandidateFiles.filter((f) => !isIgnored(f)).slice(0, 100);

    for (const f of filteredSeleniumFiles) {
      try {
        const content = await fs.readFile(f, "utf8");
        // Only check files with selenium imports
        if (
          /from\s+selenium\b/.test(content) ||
          /import\s+org\.openqa\.selenium/.test(content) ||
          /require\s*\(\s*['"]selenium-webdriver['"]/.test(content) ||
          /from\s+['"]selenium-webdriver['"]/.test(content)
        ) {
          const leaks = findSeleniumResourceLeaks(normalize(f), content);
          seleniumLeakEvidence.push(...leaks);
        }
      } catch {
        continue;
      }
    }

    if (seleniumLeakEvidence.length > 0) {
      findings.push({
        findingId: "SE-STABILITY-001",
        severity: "medium",
        title: "WebDriver resource leak risk",
        description:
          `${seleniumLeakEvidence.length} Selenium test file(s) create WebDriver instances without driver.quit() in a teardown hook. Unlike Playwright, Selenium has no auto-cleanup — missing quit() leaks browser processes.`,
        recommendation:
          "Add driver.quit() in a teardown hook (teardown_method for Python, @After/@AfterEach for Java/JS). This ensures cleanup even when tests fail.",
        evidence: seleniumLeakEvidence.slice(0, 10).map((r) => ({
          file: r.file,
          line: r.line,
          snippet: `WebDriver creation: ${r.creationPatterns.join(", ")} — no quit() in teardown`,
        })),
      });
    }
  }

  // ============================================
  // PW-STABILITY-006: Too many assertions per test
  // ============================================
  const allOverAsserted: OverAssertedTest[] = [];

  for (const testFile of filteredTestFiles) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const analysis = analyzeTestFile(content);
      // Only scan files with ≥2 tests
      if (analysis.testCount < 2) continue;
      const overAsserted = findOverAssertedTests(normalize(testFile), content);
      allOverAsserted.push(...overAsserted);
    } catch {
      continue;
    }
  }

  // Only emit if ≥3 tests are over-asserted (don't flag a single outlier)
  if (allOverAsserted.length >= 3) {
    const sorted = allOverAsserted.sort((a, b) => b.assertionCount - a.assertionCount);
    findings.push({
      findingId: "PW-STABILITY-006",
      severity: "low",
      title: "Too many assertions per test",
      description:
        `${allOverAsserted.length} test(s) have more than 5 expect() assertions each. Tests that verify too many behaviors at once are harder to debug when they fail and indicate the test may be doing too much.`,
      recommendation:
        "Split over-asserted tests into focused tests that each verify one behavior. Use test.describe() to group related assertions. Consider page object methods that encapsulate multiple checks.",
      evidence: sorted.slice(0, 10).map((t) => ({
        file: t.file,
        line: t.line,
        snippet: `"${t.testName}" — ${t.assertionCount} assertions (threshold: 5)`,
      })),
    });
  }

  // ============================================
  // PW-LOC-002: CSS selector nesting depth > 3
  // ============================================
  const deepCssEvidence: Evidence[] = [];

  for (const testFile of filteredTestFiles.slice(0, 100)) {
    if (deepCssEvidence.length >= 25) break;
    try {
      const content = await fs.readFile(testFile, "utf8");
      const lines = content.split(/\r?\n/);

      // Find locator('css-selector') calls
      const locatorArgRegex = /\blocator\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = locatorArgRegex.exec(content)) !== null) {
        const selector = m[1];
        // Count combinators: >, space (descendant), +, ~ indicate nesting
        const combinators = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
        if (combinators.length > 3) {
          const lineNum = lineNumberAtIndex(content, m.index);
          const lineText = (lines[lineNum - 1] ?? "").trim();
          if (!lineText.startsWith("//") && !lineText.startsWith("*")) {
            deepCssEvidence.push({
              file: normalize(testFile),
              line: lineNum,
              snippet: lineText.slice(0, 150),
            });
          }
        }
        if (deepCssEvidence.length >= 25) break;
      }
    } catch {
      continue;
    }
  }

  if (deepCssEvidence.length > 0) {
    findings.push({
      findingId: "PW-LOC-002",
      severity: "low",
      title: "Deeply nested CSS selectors (>3 levels)",
      description:
        `${deepCssEvidence.length} instance(s) of deeply nested CSS selectors detected. Selectors like 'div > span > .foo > .bar > input' are fragile and break when DOM structure changes, even if the target element is unchanged.`,
      recommendation:
        "Replace deep CSS selectors with semantic locators: getByRole(), getByTestId(), getByLabel(). If you must use CSS, keep selectors to 1-2 levels. Add data-testid attributes where needed.\nhttps://playwright.dev/docs/locators#quick-guide",
      evidence: deepCssEvidence,
    });
  }

  // ============================================
  // ARCH-008: Large inline test data
  // ============================================
  const largeInlineDataFiles: Array<{ file: string; largestBlock: number }> = [];

  for (const testFile of filteredTestFiles.slice(0, 100)) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const lines = content.split(/\r?\n/);

      // Detect large array/object literals (heuristic: find [ or { and count lines until close)
      let maxBlockSize = 0;
      let depth = 0;
      let blockStart = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === "{" || ch === "[") {
            if (depth === 0) blockStart = i;
            depth++;
          }
          if (ch === "}" || ch === "]") {
            depth--;
            if (depth === 0 && blockStart >= 0) {
              const size = i - blockStart + 1;
              if (size > maxBlockSize) maxBlockSize = size;
              blockStart = -1;
            }
          }
        }
      }

      // Only flag if a single inline data block exceeds 50 lines
      if (maxBlockSize >= 50) {
        largeInlineDataFiles.push({ file: normalize(testFile), largestBlock: maxBlockSize });
      }
    } catch {
      continue;
    }
  }

  if (largeInlineDataFiles.length >= 2) {
    findings.push({
      findingId: "ARCH-008",
      severity: "medium",
      title: "Large inline test data detected",
      description:
        `${largeInlineDataFiles.length} test file(s) contain large inline data blocks (50+ lines). Embedding test data in test files reduces readability, makes data reuse difficult, and bloats test files.`,
      recommendation:
        "Extract large data into separate fixture files (e.g., /fixtures/testData.json or /data/ folder). Use test.use() or custom fixtures to load data. This improves readability and enables data sharing across tests.",
      evidence: largeInlineDataFiles.slice(0, 10).map(({ file, largestBlock }) => ({
        file,
        line: 1,
        snippet: `Largest inline data block: ${largestBlock} lines`,
      })),
    });
  }

  // ============================================
  // ARCH-009: Missing test.use() for project-specific overrides
  // ============================================
  const inlineConfigOverrides: Evidence[] = [];

  for (const testFile of filteredTestFiles.slice(0, 100)) {
    if (inlineConfigOverrides.length >= 20) break;
    try {
      const content = await fs.readFile(testFile, "utf8");
      const lines = content.split(/\r?\n/);

      // Detect inline overrides like { timeout: N } or { retries: N } in test() calls
      // but NOT in test.use() blocks (those are fine)
      const inlineOverrideRegex = /\btest\s*\(\s*['"`][^'"`]+['"`]\s*,\s*\{[^}]*(timeout|retries)\s*:/g;
      let match: RegExpExecArray | null;
      while ((match = inlineOverrideRegex.exec(content)) !== null) {
        const lineNum = lineNumberAtIndex(content, match.index);
        const lineText = (lines[lineNum - 1] ?? "").trim();
        if (!lineText.startsWith("//")) {
          inlineConfigOverrides.push({
            file: normalize(testFile),
            line: lineNum,
            snippet: lineText.slice(0, 150),
          });
        }
        if (inlineConfigOverrides.length >= 20) break;
      }
    } catch {
      continue;
    }
  }

  if (inlineConfigOverrides.length >= 3) {
    findings.push({
      findingId: "ARCH-009",
      severity: "low",
      title: "Inline test configuration overrides (consider test.use())",
      description:
        `${inlineConfigOverrides.length} test(s) override configuration (timeout/retries) inline. This scatters config across test files instead of centralizing it in playwright.config.ts or test.use() blocks.`,
      recommendation:
        "Use test.describe(() => { test.use({ ... }) }) to set config for groups of tests, or configure per-project settings in playwright.config.ts. Reserve inline overrides for genuinely exceptional cases.\nhttps://playwright.dev/docs/test-use-options",
      evidence: inlineConfigOverrides.slice(0, 10),
    });
  }

  // ============================================
  // ARCHITECTURAL ANALYSIS (ARCH-*)
  // ============================================

  // Collect POM files for analysis
  const pomFiles = (await fg(["**/POMs/**/*.ts", "**/pages/**/*.ts", "**/page-objects/**/*.ts", "**/*Page.ts", "**/*Page.js"], {
    cwd: repoPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })) as string[];

  const filteredPomFiles = pomFiles.filter((f) => !isIgnored(f) && !f.includes('.spec.') && !f.includes('.test.'));

  // Analyze POM architecture
  const pomAnalyses: PomAnalysis[] = [];
  const pomContentsMap = new Map<string, string>();
  
  for (const pomFile of filteredPomFiles) {
    try {
      const content = await fs.readFile(pomFile, "utf8");
      pomContentsMap.set(pomFile, content);
      const analysis = analyzePomFile(pomFile, content);
      if (analysis) {
        pomAnalyses.push(analysis);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // ARCH-001: Missing BasePage pattern
  const pomsWithoutBase = pomAnalyses.filter(p => !p.extendsClass);
  
  if (pomsWithoutBase.length >= 3 && pomAnalyses.length >= 5) {
    // Check if there's a clear BasePage pattern (some POMs extend a common class)
    const baseClasses = pomAnalyses.filter(p => p.extendsClass).map(p => p.extendsClass);
    const hasEstablishedBasePattern = new Set(baseClasses).size <= 2 && baseClasses.length >= 2;
    
    if (hasEstablishedBasePattern || pomsWithoutBase.length > pomAnalyses.length * 0.5) {
      findings.push({
        findingId: "ARCH-001",
        severity: "low",
        title: "No shared base pattern across Page Objects",
        description:
          `${pomsWithoutBase.length} of ${pomAnalyses.length} Page Object classes don't extend a common base class. A shared base can provide common helper methods and consistent initialization. Note: Playwright's fixture model is the primary composition mechanism — consider fixtures for shared setup logic rather than requiring class inheritance.`,
        recommendation:
          "Consider using Playwright fixtures for shared setup logic (recommended approach). If using class inheritance, create a BasePage with common helpers. Either approach ensures consistency — fixtures are preferred per Playwright docs.\nhttps://playwright.dev/docs/test-fixtures\nhttps://playwright.dev/docs/pom",
        evidence: pomsWithoutBase.slice(0, 10).map(p => ({
          file: normalize(p.file),
          line: 1,
          snippet: `class ${p.className} (no base class)`,
        })),
      });
    }
  }

  // ARCH-002: Public locators (poor encapsulation)
  const pomsWithPublicLocators = pomAnalyses.filter(p => p.hasPublicLocators);
  
  if (pomsWithPublicLocators.length >= 2) {
    findings.push({
      findingId: "ARCH-002",
      severity: "low",
      title: "Consider encapsulating complex locator interactions",
      description:
        `${pomsWithPublicLocators.length} Page Object(s) expose locators as public properties. Note: Playwright's official POM example uses public readonly locators, which is an acceptable pattern. However, for complex multi-step interactions, wrapping locators in semantic action methods improves readability and maintenance.`,
      recommendation:
        "Public readonly locators are acceptable per Playwright docs. For complex interactions, consider wrapping multi-step operations in action methods (e.g., 'async login(user, pass) { ... }') while keeping simple locators public for flexibility.\nhttps://playwright.dev/docs/pom",
      evidence: pomsWithPublicLocators.slice(0, 10).map(p => ({
        file: normalize(p.file),
        line: 1,
        snippet: `${p.publicLocatorCount} public locators${p.locatorExamples.length ? `: ${p.locatorExamples.join(', ')}` : ''}`,
      })),
    });
  }

  // ARCH-003: Test coupling (tests importing from other tests)
  const testCouplingIssues: TestCouplingAnalysis[] = [];
  
  for (const testFile of filteredTestFiles) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      const analysis = analyzeTestCoupling(testFile, content);
      if (analysis.importsFromTestFiles.length > 0) {
        testCouplingIssues.push(analysis);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (testCouplingIssues.length > 0) {
    findings.push({
      findingId: "ARCH-003",
      severity: "high",
      title: "Test coupling detected (tests importing from other tests)",
      description:
        `${testCouplingIssues.length} test file(s) import from other test files (.spec.ts/.test.ts). This creates tight coupling between tests, makes them harder to run in isolation, and can cause confusing failures when the imported test changes.`,
      recommendation:
        "Extract shared test utilities, fixtures, and helpers into dedicated utility files (e.g., /utils, /helpers, /fixtures folders). Tests should only import from non-test modules. This improves test isolation and makes the test suite more maintainable.",
      evidence: testCouplingIssues.slice(0, 10).map(c => ({
        file: normalize(c.file),
        line: 1,
        snippet: `imports: ${c.importsFromTestFiles.join(', ')}`,
      })),
    });
  }

  // ARCH-004: Missing fixture typing (any types in fixtures)
  const fixtureFiles = (await fg(["**/fixtures/**/*.ts", "**/fixtures.ts", "**/*.fixtures.ts"], {
    cwd: repoPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })) as string[];

  const filteredFixtureFiles = fixtureFiles.filter((f) => !isIgnored(f));
  const fixturesWithAnyType: FixtureTypingAnalysis[] = [];

  for (const fixtureFile of filteredFixtureFiles) {
    try {
      const content = await fs.readFile(fixtureFile, "utf8");
      const analysis = analyzeFixtureTyping(fixtureFile, content);
      if (analysis.hasAnyTypes && analysis.anyTypeCount >= 2) {
        fixturesWithAnyType.push(analysis);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (fixturesWithAnyType.length > 0) {
    const totalAnyCount = fixturesWithAnyType.reduce((sum, f) => sum + f.anyTypeCount, 0);
    
    findings.push({
      findingId: "ARCH-004",
      severity: "medium",
      title: "Missing fixture typing (any types in fixtures)",
      description:
        `${fixturesWithAnyType.length} fixture file(s) contain 'any' type annotations (${totalAnyCount} total). Untyped fixtures lose TypeScript's type safety benefits, making it easy to pass incorrect data to tests and harder to catch errors at compile time.`,
      recommendation:
        "Define explicit types for all fixtures using test.extend<{ myFixture: MyType }>. Create interfaces for complex fixture data. This enables IDE autocomplete, catches type errors early, and serves as documentation for fixture contracts.",
      evidence: fixturesWithAnyType.slice(0, 10).map(f => ({
        file: normalize(f.file),
        line: 1,
        snippet: `${f.anyTypeCount} 'any' type(s)${f.hasProperTyping ? ' (has some proper typing)' : ' (no test.extend<> typing)'}`,
      })),
    });
  }

  // ARCH-005: Hardcoded test data (credentials, emails, etc.)
  const allHardcodedData: HardcodedDataMatch[] = [];
  const allTestAndPomFiles = [...filteredTestFiles, ...filteredPomFiles];
  
  for (const file of allTestAndPomFiles.slice(0, 100)) { // Limit to avoid performance issues
    try {
      const content = await fs.readFile(file, "utf8");
      const matches = findHardcodedData(file, content);
      allHardcodedData.push(...matches);
    } catch {
      // Skip files that can't be read
    }
  }

  // Group by type and only report if significant
  const dataByType = new Map<string, HardcodedDataMatch[]>();
  for (const match of allHardcodedData) {
    const existing = dataByType.get(match.type) || [];
    existing.push(match);
    dataByType.set(match.type, existing);
  }

  // Only report if we find passwords, API keys, or multiple email patterns
  const sensitiveData = [...(dataByType.get('password') || []), ...(dataByType.get('api_key') || [])];
  const emailData = dataByType.get('email') || [];

  if (sensitiveData.length > 0) {
    findings.push({
      findingId: "ARCH-005",
      severity: "high",
      title: "Hardcoded credentials or API keys detected",
      description:
        `${sensitiveData.length} instance(s) of hardcoded passwords or API keys found in test code. Hardcoded credentials are a security risk, make environment switching difficult, and can leak sensitive data in version control.`,
      recommendation:
        "Move all credentials to environment variables or a secure secrets manager. Use process.env.TEST_PASSWORD, Azure Key Vault, or similar. For test data, consider using a data factory pattern or test data generators.",
      evidence: sensitiveData.slice(0, 10).map(d => ({
        file: normalize(d.file),
        line: d.line,
        snippet: d.snippet.replace(/(['"`])(?=.*(?:password|secret|key|token))([^'"`]+)\1/gi, '$1[REDACTED]$1'),
      })),
    });
  }

  if (emailData.length >= 5) {
    findings.push({
      findingId: "ARCH-005a",
      severity: "low",
      title: "Hardcoded email addresses in tests",
      description:
        `${emailData.length} hardcoded email addresses found in test code. While not a security risk, hardcoded emails make it harder to run tests in different environments and can cause conflicts in parallel test runs.`,
      recommendation:
        "Use a test data factory or faker library to generate unique email addresses per test run. For example: 'test-${Date.now()}@example.com' or use @faker-js/faker. This prevents test data conflicts and makes tests more robust.",
      evidence: emailData.slice(0, 10).map(d => ({
        file: normalize(d.file),
        line: d.line,
        snippet: d.snippet,
      })),
    });
  }

  // ============================================
  // ARCH-010: Hardcoded inline test data
  // ============================================
  {
    const inlineDataFiles: Array<{ file: string; matches: InlineTestDataMatch[] }> = [];

    // Scope 1: Playwright test files (already have filteredTestFiles + filteredPomFiles)
    for (const file of [...filteredTestFiles, ...filteredPomFiles].slice(0, 100)) {
      // Skip files in fixtures/data/testdata directories (use repo-relative path to avoid
      // false matches on parent directories like tests/fixtures/bad-repo)
      const normalized = normalize(file);
      const relPath = normalize(path.relative(repoPath, file));
      if (/(?:^|[/\\])(?:fixtures|data|testdata)[/\\]/i.test(relPath)) continue;
      try {
        const content = await fs.readFile(file, "utf8");
        const matches = findInlineTestDataInFile(normalized, content);
        if (matches.length >= 3) {
          inlineDataFiles.push({ file: normalized, matches });
        }
      } catch { continue; }
    }

    // Scope 2: Cypress test files (if detected)
    if (inventory.detectedFrameworks.includes("cypress")) {
      const cypressGlobs = ["**/cypress/e2e/**/*.{ts,js,tsx,jsx}", "**/*.cy.{ts,js,tsx,jsx}"];
      const cypressFiles = (await fg(cypressGlobs, {
        cwd: repoPath, absolute: true, dot: true, onlyFiles: true, followSymbolicLinks: false,
      })) as string[];
      const filteredCypressFiles = cypressFiles.filter((f) => !isIgnored(f));
      for (const file of filteredCypressFiles.slice(0, 50)) {
        const normalized = normalize(file);
        const relPath = normalize(path.relative(repoPath, file));
        if (/(?:^|[/\\])(?:fixtures|data|testdata)[/\\]/i.test(relPath)) continue;
        // Avoid double-counting files already scanned
        if (inlineDataFiles.some((d) => d.file === normalized)) continue;
        try {
          const content = await fs.readFile(file, "utf8");
          const matches = findInlineTestDataInFile(normalized, content);
          if (matches.length >= 3) {
            inlineDataFiles.push({ file: normalized, matches });
          }
        } catch { continue; }
      }
    }

    // Scope 3: Selenium test files (if detected)
    if (inventory.detectedFrameworks.includes("selenium")) {
      const seGlobs = ["**/*.py", "**/*.java"];
      const seFiles = (await fg(seGlobs, {
        cwd: repoPath, absolute: true, dot: true, onlyFiles: true, followSymbolicLinks: false,
      })) as string[];
      const filteredSeFiles = seFiles.filter((f) => !isIgnored(f));
      for (const file of filteredSeFiles.slice(0, 50)) {
        const normalized = normalize(file);
        const relPath = normalize(path.relative(repoPath, file));
        if (/(?:^|[/\\])(?:fixtures|data|testdata)[/\\]/i.test(relPath)) continue;
        if (inlineDataFiles.some((d) => d.file === normalized)) continue;
        try {
          const content = await fs.readFile(file, "utf8");
          // Only check selenium files
          if (!/from\s+selenium\b|import\s+org\.openqa\.selenium|require\s*\(\s*['"]selenium-webdriver['"]/.test(content)) continue;
          const matches = findInlineTestDataInFile(normalized, content);
          if (matches.length >= 3) {
            inlineDataFiles.push({ file: normalized, matches });
          }
        } catch { continue; }
      }
    }

    // Require ≥2 files with matches before emitting
    if (inlineDataFiles.length >= 2) {
      const totalMatches = inlineDataFiles.reduce((sum, f) => sum + f.matches.length, 0);
      const allMatches = inlineDataFiles.flatMap((f) => f.matches);
      findings.push({
        findingId: "ARCH-010",
        severity: "low",
        title: "Hardcoded inline test data",
        description:
          `${totalMatches} inline test data values found across ${inlineDataFiles.length} test file(s). Hardcoded usernames, addresses, dates, prices, and other test data makes tests brittle and harder to maintain. Extract to fixture files or use data factories.`,
        recommendation:
          "Move hardcoded test data to JSON fixture files, TypeScript data factories, or use a library like @faker-js/faker to generate test data. This makes data reusable, easier to update, and supports parameterized testing.",
        evidence: allMatches.slice(0, 15).map((m) => ({
          file: m.file,
          line: m.line,
          snippet: m.snippet,
        })),
      });
    }
  }

  // ARCH-006: Missing API mocking capability
  const mockingAnalysis = analyzeApiMocking([...filteredTestFiles, ...filteredPomFiles], pomContentsMap);

  // Also check test files
  for (const testFile of filteredTestFiles.slice(0, 50)) {
    try {
      const content = await fs.readFile(testFile, "utf8");
      pomContentsMap.set(testFile, content);
    } catch {
      // Skip
    }
  }
  
  const fullMockingAnalysis = analyzeApiMocking([...filteredTestFiles, ...filteredPomFiles], pomContentsMap);
  
  // Only flag if we have a meaningful number of test files but no mocking
  if (filteredTestFiles.length >= 10 && !fullMockingAnalysis.hasRouteMocking && !fullMockingAnalysis.hasRequestInterception) {
    findings.push({
      findingId: "ARCH-006",
      severity: "low",
      title: "No API mocking detected",
      description:
        `No page.route() or request interception patterns found across ${filteredTestFiles.length} test files. While not always necessary, API mocking enables faster tests, better isolation from backend changes, and easier testing of error scenarios.`,
      recommendation:
        "Consider using Playwright's page.route() for API mocking in integration tests. This allows testing error states, slow responses, and edge cases without backend dependencies. Create a helper function for common mock patterns. See: https://playwright.dev/docs/mock",
      evidence: [
        {
          file: `${repoPath} (analysis summary)`,
          line: 1,
          snippet: `${filteredTestFiles.length} test files analyzed, no route mocking found`,
        },
      ],
    });
  }

  // ARCH-007: No custom error types
  const errorAnalyses: ErrorHandlingAnalysis[] = [];
  
  for (const pomFile of filteredPomFiles.slice(0, 50)) {
    try {
      const content = pomContentsMap.get(pomFile) || await fs.readFile(pomFile, "utf8");
      const analysis = analyzeErrorHandling(pomFile, content);
      if (analysis.genericThrowCount >= 2 && !analysis.hasCustomErrors) {
        errorAnalyses.push(analysis);
      }
    } catch {
      // Skip
    }
  }

  if (errorAnalyses.length >= 3) {
    const totalGenericThrows = errorAnalyses.reduce((sum, e) => sum + e.genericThrowCount, 0);
    
    findings.push({
      findingId: "ARCH-007",
      severity: "low",
      title: "No custom error types (generic Error throws)",
      description:
        `${errorAnalyses.length} Page Object(s) use generic 'throw new Error()' (${totalGenericThrows} total instances) without custom error classes. Custom error types enable better error categorization, easier debugging, and programmatic error handling in tests.`,
      recommendation:
        "Create custom error classes that extend Error for different failure scenarios (e.g., ElementNotFoundError, NavigationError, ValidationError). This makes test failures more descriptive and enables better error handling in helper functions.",
      evidence: errorAnalyses.slice(0, 10).map(e => ({
        file: normalize(e.file),
        line: 1,
        snippet: `${e.genericThrowCount} generic throw(s), no custom error types`,
      })),
    });
  }

  // ============================================
  // END ARCHITECTURAL ANALYSIS
  // ============================================

  // Derived premium insight
  const hardWaits = hasFinding(findings, "PW-FLAKE-001");
  const forceClicks = hasFinding(findings, "PW-FLAKE-002");

  if (retriesEnabled && hardWaits && forceClicks) {
    findings.push({
      findingId: "PW-INSIGHT-001",
      severity: "high",
      title: "Masked flakiness risk (retries + hard waits + force clicks)",
      description:
        "Retries are enabled while the codebase also contains hard waits and force clicks. This combination often indicates timing instability being masked rather than fixed, which can inflate CI time and make failures harder to reproduce.",
      recommendation:
        "Prioritize removing hard waits and force-click patterns in the top hotspot files first. Then re-evaluate retry policy (keep retries minimal and rely on trace/video artifacts for diagnosis).",
      evidence: [
        {
          file:
            inventory.playwrightConfigSummary?.configPath ?? "playwright.config",
          line: 1,
          snippet: `retries: ${retriesExpr ?? "unknown"}; detected PW-FLAKE-001 + PW-FLAKE-002`,
        },
      ],
    });
  }

  // INSIGHT-002: Missing or risky timeout configuration
  const pw = inventory.playwrightConfigSummary;
  const testTimeoutMs = pw?.timeoutMs;
  const expectTimeoutMs = pw?.expectTimeoutMs;
  const actionTimeoutMs = pw?.use?.actionTimeoutMs;

  if (testTimeoutMs && testTimeoutMs > 120000) {
    findings.push({
      findingId: "PW-INSIGHT-002",
      severity: "medium",
      title: "Excessively high test timeout detected",
      description:
        `Test timeout is set to ${testTimeoutMs}ms (${Math.round(testTimeoutMs / 1000)}s). Very high timeouts can hide performance issues and make failing tests hang for too long.`,
      recommendation:
        "Review whether tests genuinely need such long timeouts. Consider setting appropriate expect/action timeouts instead of relying on the global test timeout. Aim for 30-60s test timeouts unless you have specific heavy integration tests.",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: `timeout: ${testTimeoutMs} ms`,
        },
      ],
    });
  }

  const isPlaywright = inventory.detectedFrameworks.includes("playwright");

  if (isPlaywright && !expectTimeoutMs && !actionTimeoutMs) {
    findings.push({
      findingId: "PW-INSIGHT-003",
      severity: "low",
      title: "No explicit expect or action timeout configured",
      description:
        "Neither expect.timeout nor use.actionTimeout are explicitly configured. This relies on Playwright defaults (5s for expect, 0 for actions which means they use test timeout). Explicit timeouts improve test clarity.",
      recommendation:
        "Set expect.timeout (e.g., 10-20s) and use.actionTimeout (e.g., 30s) explicitly in playwright.config.ts to make timeout behavior predictable and easier to tune.",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: "expect.timeout and use.actionTimeout not explicitly set",
        },
      ],
    });
  }

  // INSIGHT-004: Excessive retries
  if (retriesEnabled && retriesExpr) {
    const retriesMatch = retriesExpr.match(/\b(\d+)\b/g);
    const maxRetries = retriesMatch ? Math.max(...retriesMatch.map(Number)) : 0;
    
    if (maxRetries > 2) {
      findings.push({
        findingId: "PW-INSIGHT-004",
        severity: "medium",
        title: `Excessive retry count detected (${maxRetries} retries)`,
        description:
          `Retries are set to ${maxRetries}, which is higher than the recommended maximum (2). Excessive retries can mask underlying flakiness and make CI runs significantly longer.`,
        recommendation:
          "Reduce retries to 1-2 maximum. Use retries to handle rare environmental flakiness, not to work around test instability. Prioritize fixing the root cause of flaky tests.",
        evidence: [
          {
            file: pw?.configPath ?? "playwright.config",
            line: 1,
            snippet: `retries: ${retriesExpr}`,
          },
        ],
      });
    }
  }

  // INSIGHT-005: Missing trace/video on failure
  const trace = pw?.use?.trace;
  const video = pw?.use?.video;
  
  if (isPlaywright && (!trace || trace === "off")) {
    findings.push({
      findingId: "PW-INSIGHT-005",
      severity: "high",
      title: "Trace capture not configured or disabled",
      description:
        "Playwright trace is not enabled or is set to 'off'. The Playwright team explicitly recommends 'trace: on-first-retry' as a best practice. Traces are the primary debugging mechanism for CI failures, providing DOM snapshots, network logs, and action timeline.",
      recommendation:
        "Enable traces with 'on-first-retry' (recommended by Playwright best practices) or 'retain-on-failure' in playwright.config.ts. This provides rich debugging context with minimal storage overhead.\nhttps://playwright.dev/docs/trace-viewer-intro",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: trace ? `trace: ${trace}` : "trace not configured",
        },
      ],
    });
  }

  if (isPlaywright && (!video || video === "off")) {
    findings.push({
      findingId: "PW-INSIGHT-006",
      severity: "low",
      title: "Video capture not configured or disabled",
      description:
        "Video recording is not enabled or is set to 'off'. Videos can be helpful for debugging, though less comprehensive than traces.",
      recommendation:
        "Consider enabling video with 'on-first-retry' or 'retain-on-failure'. Note that traces are more useful for debugging, so if storage is a concern, prioritize traces over videos.",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: video ? `video: ${video}` : "video not configured",
        },
      ],
    });
  }

  // INSIGHT-007: High parallelism without env tuning
  const workers = pw?.workers;
  if (workers && /^\d+$/.test(workers) && parseInt(workers) > 8) {
    findings.push({
      findingId: "PW-INSIGHT-007",
      severity: "low",
      title: `High fixed worker count detected (${workers} workers)`,
      description:
        `Worker count is hardcoded to ${workers}. High parallelism can cause resource contention and may not be suitable for all environments (e.g., CI, developer laptops).`,
      recommendation:
        "Make workers environment-aware (e.g., process.env.WORKERS or process.env.CI ? 4 : 2). This allows tuning parallelism per environment and prevents resource exhaustion.",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: `workers: ${workers}`,
        },
      ],
    });
  }

  // ── New config-based insights (from Playwright docs audit) ────────────

  // INSIGHT-014: forbidOnly not configured (per best-practices doc)
  if (pw && inventory.ciSummary?.files?.length) {
    // Read the config file to check for forbidOnly
    try {
      const configContent = pw.configPath
        ? await fs.readFile(pw.configPath, "utf8")
        : "";
      if (!configContent.includes("forbidOnly")) {
        findings.push({
          findingId: "PW-INSIGHT-014",
          severity: "high",
          title: "Missing forbidOnly in Playwright config (test.only can leak to CI)",
          description:
            "The Playwright config does not include forbidOnly. Without this guard, a test.only() accidentally left in committed code will silently run only one test in CI, making pass rates meaningless. The Playwright docs recommend 'forbidOnly: !!process.env.CI' as a best practice.",
          recommendation:
            "Add forbidOnly to your playwright.config.ts:\n  forbidOnly: !!process.env.CI\nThis will cause CI runs to fail immediately if test.only() is found.\nhttps://playwright.dev/docs/api/class-testconfig#test-config-forbid-only",
          evidence: [{
            file: pw.configPath,
            line: 1,
            snippet: "forbidOnly not found in config",
          }],
        });
      }
    } catch {
      // Skip if config can't be read
    }
  }

  // INSIGHT-015: Retries not CI-conditional (per test-configuration doc)
  if (pw && retriesEnabled && retriesExpr && !/process\.env/.test(retriesExpr)) {
    findings.push({
      findingId: "PW-INSIGHT-015",
      severity: "medium",
      title: "Retries are always on (not CI-conditional)",
      description:
        `Retries are set to a fixed value (${retriesExpr}) rather than being conditional on CI. The Playwright docs recommend 'retries: process.env.CI ? 2 : 0' so that retries are only enabled in CI — locally, developers see failures immediately without retry masking.`,
      recommendation:
        "Make retries CI-conditional:\n  retries: process.env.CI ? 2 : 0\nThis helps developers catch flakiness locally while still having CI resilience.\nhttps://playwright.dev/docs/test-configuration",
      evidence: [{
        file: pw?.configPath ?? "playwright.config",
        line: 1,
        snippet: `retries: ${retriesExpr}`,
      }],
    });
  }

  // CI findings
  const ci = inventory.ciSummary!;

  if (!ci.files.length) {
    findings.push({
      findingId: "CI-001",
      severity: "medium",
      title: "No CI pipeline YAML detected",
      description:
        "No Azure Pipelines or GitHub Actions workflow YAML files were detected. CI signal checks (artifact publishing, caching, workers env wiring) could not be validated.",
      recommendation:
        "If CI exists elsewhere, point the audit tool at the repository that contains the pipeline YAML. Otherwise, add a CI workflow that runs Playwright and publishes artifacts.",
      evidence: [{ file: repoPath, line: 1, snippet: "No pipeline YAML files found." }],
    });

    return { repoPath, inventory, findings, gitBranch: git.branch, gitCommit: git.commit };
  }

  // CI-002
  if (!ci.publishesPlaywrightReport) {
    findings.push({
      findingId: "CI-002",
      severity: "high",
      title: "CI may not publish Playwright HTML report artifacts",
      description:
        "Pipeline YAML was detected but there is no strong evidence that the Playwright HTML report folder (playwright-report) is uploaded as a build artifact. This reduces debuggability on failures.",
      recommendation:
        "Upload the playwright-report folder as a pipeline artifact (ADO: PublishPipelineArtifact; GHA: actions/upload-artifact).",
      evidence: ci.files.slice(0, 3).map((f) => ({
        file: f.file,
        line: 1,
        snippet: `Detected CI file (${f.kind}); playwright-report publish not confirmed.`,
      })),
    });
  }

  // CI-003
  if (!ci.publishesJUnit) {
    findings.push({
      findingId: "CI-003",
      severity: "medium",
      title: "CI may not publish JUnit test results",
      description:
        "Playwright is configured to output JUnit (test-results.xml) in CI, but the pipeline YAML does not clearly publish test results. This makes test reporting and trend tracking harder.",
      recommendation:
        "Publish test-results.xml as test results (ADO: PublishTestResults task; GHA: upload artifact + test reporter integration if used).",
      evidence: ci.files.slice(0, 3).map((f) => ({
        file: f.file,
        line: 1,
        snippet: `Detected CI file (${f.kind}); JUnit publish not confirmed.`,
      })),
    });
  }

  // CI-004
  const pwWorkersExpr = inventory.playwrightConfigSummary?.workers ?? "";
  const envHints = inventory.playwrightConfigSummary?.envHints ?? {};
const hintedWorkers = Boolean(envHints.workersEnvVar);
const pwUsesWorkersEnv =
  hintedWorkers || /process\.env\.WORKERS|\bWORKERS\b/.test(pwWorkersExpr);
;

  if (pwUsesWorkersEnv && !ci.setsWorkersEnv) {
    findings.push({
      findingId: "CI-004",
      severity: "medium",
      title: "Playwright workers appear env-driven but CI does not set WORKERS",
      description:
        "Playwright config suggests workers are controlled via an environment variable (WORKERS), but the pipeline YAML does not clearly set WORKERS. This can lead to unexpected default parallelism.",
      recommendation:
        "Explicitly set WORKERS in the pipeline YAML (and consider per-environment tuning).",
      evidence: [
        {
          file: inventory.playwrightConfigSummary?.configPath ?? "playwright.config",
          line: 1,
          snippet: `workers: ${pwWorkersExpr || "unknown"}`,
        },
        ...ci.files.slice(0, 2).map((f) => ({
          file: f.file,
          line: 1,
          snippet: "WORKERS not detected in pipeline YAML.",
        })),
      ],
    });
  }

    // CI-006 — inconsistent WORKERS usage across pipelines
  const totalCiFiles = ci.files.length;
  const workersFilesCount = ci.workersEnvFiles.length;

  if (
    pwUsesWorkersEnv &&
    totalCiFiles > 1 &&
    workersFilesCount > 0 &&
    workersFilesCount < totalCiFiles
  ) {
    // Normalize for comparison
    const workersSet = new Set(ci.workersEnvFiles.map((f) => normalize(f).toLowerCase()));

    const allCiFiles = ci.files.map((f) => normalize(f.file));
    const missingWorkersFiles = allCiFiles.filter(
      (file) => !workersSet.has(file.toLowerCase())
    );

    // Dynamic severity based on both pipeline count AND coverage percentage
    const coveragePercent = (workersFilesCount / totalCiFiles) * 100;
    let severity: "low" | "medium" | "high";
    
    // High severity if: many pipelines AND low coverage (<40%)
    // Medium severity if: moderate inconsistency 
    // Low severity if: mostly consistent (>70% coverage) or few pipelines
    if (totalCiFiles >= 5 && coveragePercent < 40) {
      severity = "high"; // Majority of pipelines missing WORKERS
    } else if (totalCiFiles >= 4 || coveragePercent < 60) {
      severity = "medium";
    } else {
      severity = "low";
    }

    findings.push({
      findingId: "CI-006",
      severity,
      title: "WORKERS env is set inconsistently across CI pipelines",
      description:
        `Some pipeline YAML files set WORKERS (${Math.round(coveragePercent)}% coverage), while others rely on Playwright defaults. This can cause inconsistent parallelism, execution time, and stability between pipelines.`,
      recommendation:
        "Standardize WORKERS across all pipelines (or explicitly document per-pipeline intent). If different parallelism is desired, set WORKERS in every pipeline so behavior is intentional.",
      evidence: [
        {
          file: `${repoPath} (CI summary)`,
          line: 1,
          snippet: `WORKERS referenced in ${workersFilesCount}/${totalCiFiles} pipeline file(s); missing in ${missingWorkersFiles.length}/${totalCiFiles}.`,
        },

        // Files that DO set WORKERS
        ...ci.workersEnvFiles.slice(0, 8).map((file) => ({
          file,
          line: 1,
          snippet: "WORKERS referenced here.",
        })),

        // Files that DO NOT set WORKERS
        ...missingWorkersFiles.slice(0, 8).map((file) => ({
          file,
          line: 1,
          snippet: "WORKERS NOT set in this pipeline file.",
        })),

        ...(missingWorkersFiles.length > 8
          ? [
              {
                file: `${repoPath} (CI summary)`,
                line: 1,
                snippet: `...and ${missingWorkersFiles.length - 8} more pipeline file(s) without WORKERS.`,
              },
            ]
          : []),
      ],
    });
  }


  // CI-005
  if (!ci.usesCache) {
    const isMicrosoftHosted =
      ci.usesMicrosoftHostedPool && !ci.usesSelfHostedPool;

    findings.push({
      findingId: "CI-005",
      severity: isMicrosoftHosted ? "medium" : "low",
      title: isMicrosoftHosted
        ? "No dependency caching detected in CI (Microsoft-hosted agents)"
        : "No dependency caching detected in CI (may be optional on self-hosted agents)",
      description: isMicrosoftHosted
        ? "No dependency caching was detected (node_modules, npm cache). On Microsoft-hosted agents this increases CI duration and cost because each run starts from a clean machine. Note: Playwright docs recommend NOT caching browser binaries — download time is comparable to cache restore time."
        : "No dependency caching was detected (node_modules, npm cache). On self-hosted/on-prem agents this may be less critical if dependencies are already present, but caching can still reduce install time and variability. Note: Playwright docs recommend NOT caching browser binaries.",
      recommendation: ci.mentionsBrowsersPreinstalled
        ? "Consider caching node_modules via ADO Cache@2 or actions/cache. Do NOT cache Playwright browser binaries — per Playwright docs, download time is comparable to cache restore time.\nhttps://playwright.dev/docs/ci#caching-browsers"
        : "Add caching for node_modules / npm cache (ADO Cache@2 or actions/cache). Do NOT cache Playwright browser binaries — per Playwright docs, download time is comparable to cache restore time.\nhttps://playwright.dev/docs/ci#caching-browsers",
      evidence: [
        {
          file: `${repoPath} (CI summary)`,
          line: 1,
          snippet: `No Cache@2 / actions/cache detected across ${ci.files.length} pipeline YAML file(s).`,
        },
        ...ci.files.slice(0, 8).map((f) => ({
          file: f.file,
          line: 1,
          snippet: "No cache detected in this pipeline file.",
        })),
      ],
    });
  }
  
  // CI-007: Missing sharding for large test suites
  const testFileCount = inventory.testFiles;
  if (testFileCount > 100 && !ci.usesSharding) {
    // Estimate time savings with sharding
    // Assume ~30s average per test file (conservative), and 4-shard parallelism
    const estimatedCurrentMinutes = Math.round((testFileCount * 30) / 60);
    const recommendedShards = testFileCount > 500 ? 8 : testFileCount > 200 ? 4 : 2;
    const estimatedShardedMinutes = Math.round(estimatedCurrentMinutes / recommendedShards);
    const timeSavingsPercent = Math.round((1 - (1 / recommendedShards)) * 100);
    
    findings.push({
      findingId: "CI-007",
      severity: testFileCount > 500 ? "high" : "medium",
      title: `Large test suite (${testFileCount} test files) without sharding`,
      description:
        `This repository has ${testFileCount} test files but CI pipelines don't appear to use sharding (--shard=). Without sharding, all tests run in a single job, leading to long CI times. **Estimated impact:** With ${recommendedShards}-way sharding, CI time could reduce from ~${estimatedCurrentMinutes} min to ~${estimatedShardedMinutes} min (${timeSavingsPercent}% faster).`,
      recommendation:
        `Implement test sharding in CI by running ${recommendedShards} parallel jobs with --shard=1/${recommendedShards}, --shard=2/${recommendedShards}, etc. This distributes tests across multiple machines/containers for faster feedback. In Azure Pipelines, use a matrix strategy; in GitHub Actions, use a matrix with shard indices.  https://playwright.dev/docs/test-sharding#introduction`,
      evidence: [
        {
          file: `${repoPath} (CI summary)`,
          line: 1,
          snippet: `${testFileCount} test files; estimated ${estimatedCurrentMinutes} min → ${estimatedShardedMinutes} min with ${recommendedShards} shards`,
        },
      ],
    });
  }
  
  // CI-008: Playwright install without --with-deps
  if (ci.mentionsPlaywrightInstall && ci.playwrightInstallMethod === "npx playwright install") {
    const isMicrosoftHosted = ci.usesMicrosoftHostedPool && !ci.usesSelfHostedPool;
    
    if (isMicrosoftHosted) {
      findings.push({
        findingId: "CI-008",
        severity: "medium",
        title: "Playwright browsers installed without system dependencies (--with-deps)",
        description:
          "CI uses 'npx playwright install' without the --with-deps flag. On Microsoft-hosted agents, this may result in missing system dependencies for browsers, causing cryptic failures.",
        recommendation:
          "Use 'npx playwright install --with-deps' to ensure all required system dependencies are installed. This is especially important on clean Microsoft-hosted agents.  https://playwright.dev/docs/ci-intro#introduction",
        evidence: ci.files.filter(f => {
          // Filter to files that likely contain the install command
          return true; // Simplified for now
        }).slice(0, 3).map((f) => ({
          file: f.file,
          line: 1,
          snippet: "Uses 'npx playwright install' (consider adding --with-deps)",
        })),
      });
    }
  }

  // CI-009: Retries enabled but test-results/traces not published on failure
  if (retriesEnabled && ci.files.length > 0) {
    const publishesTraces = ci.publishesTracesOrTestResultsDir;
    const publishesOnFailure = ci.publishesArtifactsOnFailure;
    
    // Only trigger if artifacts aren't published, OR if they're published but not on failure condition
    if (!publishesTraces) {
      findings.push({
        findingId: "CI-009",
        severity: "high",
        title: "Retries enabled but test artifacts not published on failure",
        description:
          `Playwright is configured to retry failed tests (retries: ${retriesExpr}), but CI pipelines don't appear to publish test-results directories or trace files. When retried tests eventually fail, you have no artifacts to debug why.`,
        recommendation:
          "Publish the test-results folder (which contains traces, videos, screenshots) as a build artifact. In Azure Pipelines, use PublishPipelineArtifact@1 with PathtoPublish: 'test-results'. In GitHub Actions, use actions/upload-artifact@v3. Configure to run even on failure (condition: always() or failed()).",
        evidence: [
          {
            file: pw?.configPath ?? "playwright.config",
            line: 1,
            snippet: `retries: ${retriesExpr}; trace: ${trace ?? 'not set'}`,
          },
          {
            file: `${repoPath} (CI summary)`,
            line: 1,
            snippet: `${ci.files.length} CI pipeline(s) detected; no test-results artifact publishing found`,
          },
          ...ci.files.slice(0, 3).map((f) => ({
            file: f.file,
            line: 1,
            snippet: "No test-results or trace artifact publishing detected",
          })),
        ],
      });
    } else if (publishesTraces && !publishesOnFailure) {
      // Artifacts are published but may not run on failure
      findings.push({
        findingId: "CI-010",
        severity: "medium",
        title: "Test artifacts may not publish on test failure",
        description:
          `Playwright is configured to retry failed tests (retries: ${retriesExpr}) and CI appears to publish test artifacts, but no 'always()' or 'failed()' condition was detected. If the artifact publishing step only runs on success, you won't have debug artifacts when tests fail.`,
        recommendation:
          "Ensure artifact publishing runs even when tests fail. In Azure Pipelines, add 'condition: always()' or 'condition: failed()' to the PublishPipelineArtifact step. In GitHub Actions, add 'if: always()' or 'if: failure()' to the upload-artifact step.",
        evidence: [
          {
            file: pw?.configPath ?? "playwright.config",
            line: 1,
            snippet: `retries: ${retriesExpr}`,
          },
          {
            file: `${repoPath} (CI summary)`,
            line: 1,
            snippet: `Artifacts published but no 'always()' or 'failed()' condition detected`,
          },
        ],
      });
    }
  }

  // CI-011: Missing `npx playwright install` entirely
  if (ci.files.length > 0 && !ci.mentionsPlaywrightInstall && !ci.mentionsBrowsersPreinstalled) {
    findings.push({
      findingId: "CI-011",
      severity: "medium",
      title: "No 'npx playwright install' detected in CI pipelines",
      description:
        "CI pipeline YAML was found but there is no evidence that Playwright browsers are installed (npx playwright install). Unless browsers are pre-baked into the agent image, tests will fail with missing browser errors.",
      recommendation:
        "Add 'npx playwright install --with-deps' (or 'npx playwright install chromium --with-deps' for a single browser) to your CI pipeline before running tests. If browsers are pre-installed on agents, add a comment to document this.",
      evidence: ci.files.slice(0, 3).map((f) => ({
        file: f.file,
        line: 1,
        snippet: "No playwright install command found in this pipeline",
      })),
    });
  }

  // CI-012: CI env variable mismatch — config uses process.env.CI but pipeline doesn't set it
  const pwRetries = inventory.playwrightConfigSummary?.retries ?? "";
  const pwUsesEnvCI = inventory.playwrightConfigSummary?.envHints?.ciEnvVar === "CI"
    || pwRetries.includes("process.env.CI")
    || (inventory.playwrightConfigSummary?.workers ?? "").includes("process.env.CI");

  if (pwUsesEnvCI && !ci.setsCiEnvTrue && ci.files.length > 0) {
    // Only flag for Azure Pipelines (GitHub Actions sets CI=true automatically)
    const hasOnlyAzure = ci.detectedAzurePipelines && !ci.detectedGitHubActions;
    if (hasOnlyAzure) {
      findings.push({
        findingId: "CI-012",
        severity: "medium",
        title: "Playwright config depends on CI env var, but pipelines may not set it",
        description:
          `Playwright config references process.env.CI (e.g., retries: process.env.CI ? 2 : 0) but Azure Pipelines do not set CI=true by default. This means CI-specific configuration (retries, workers, headless) may not activate, causing behavior to differ between local and CI runs.`,
        recommendation:
          "Add 'CI: true' to the environment variables section of your Azure Pipeline YAML. GitHub Actions sets CI=true automatically. Verify with a pipeline run that process.env.CI evaluates truthy.",
        evidence: [
          {
            file: pw?.configPath ?? "playwright.config",
            line: 1,
            snippet: `retries: ${pwRetries || "(uses process.env.CI)"}`,
          },
          ...ci.files.slice(0, 3).map((f) => ({
            file: f.file,
            line: 1,
            snippet: "CI env var not explicitly set in this pipeline",
          })),
        ],
      });
    }
  }

  // CI-013: Pipeline timeout not set or too generous
  if (ci.files.length > 0 && !ci.hasPipelineTimeout) {
    findings.push({
      findingId: "CI-013",
      severity: "low",
      title: "No pipeline timeout guard detected",
      description:
        "CI pipelines don't appear to set a job/step timeout (timeoutInMinutes for Azure, timeout-minutes for GitHub Actions). Without a timeout, a stuck test run can consume CI agent time indefinitely.",
      recommendation:
        "Set a timeout on the test job: timeoutInMinutes: 60 (Azure Pipelines) or timeout-minutes: 60 (GitHub Actions). Adjust based on your expected suite duration with a reasonable buffer.",
      evidence: ci.files.slice(0, 3).map((f) => ({
        file: f.file,
        line: 1,
        snippet: "No timeout guard detected in this pipeline",
      })),
    });
  } else if (ci.hasPipelineTimeout && ci.pipelineTimeoutMinutes && ci.pipelineTimeoutMinutes > 120) {
    findings.push({
      findingId: "CI-013",
      severity: "low",
      title: `Pipeline timeout is very generous (${ci.pipelineTimeoutMinutes} min)`,
      description:
        `The CI pipeline timeout is set to ${ci.pipelineTimeoutMinutes} minutes. Very long timeouts can waste CI resources when tests are stuck. Most Playwright suites should complete within 30-60 minutes even for large repos.`,
      recommendation:
        "Review whether the timeout aligns with your actual suite duration. Set it to expected_duration + 50% buffer. If tests genuinely need this long, consider sharding to reduce per-job duration.",
      evidence: ci.files.slice(0, 3).map((f) => ({
        file: f.file,
        line: 1,
        snippet: `Pipeline timeout: ${ci.pipelineTimeoutMinutes} minutes`,
      })),
    });
  }

  // CI-014: No --reporter override in CI command
  if (ci.files.length > 0 && !ci.hasReporterInPlaywrightCommand) {
    // Only flag if there are multiple reporters in config (suggesting differentiation is intended)
    const reporters = inventory.playwrightConfigSummary?.reporters;
    const hasMultipleReporters = reporters && reporters.length > 1;

    if (!hasMultipleReporters) {
      findings.push({
        findingId: "CI-014",
        severity: "medium",
        title: "No --reporter override in CI playwright test command",
        description:
          "The CI pipeline runs Playwright tests without specifying a reporter override (--reporter). Playwright best-practices docs recommend CI-conditional reporters — CI environments typically benefit from machine-readable reporters (junit, html) that differ from local development preferences (list, line).",
        recommendation:
          "Add --reporter=html,junit to your CI test command, or configure reporters conditionally in playwright.config.ts using process.env.CI. This ensures CI produces both human-readable and machine-parseable output.\nhttps://playwright.dev/docs/best-practices",
        evidence: ci.files.slice(0, 3).map((f) => ({
          file: f.file,
          line: 1,
          snippet: "No --reporter flag in playwright test command",
        })),
      });
    }
  }

  // INSIGHT-008: The "Debugging Black Hole" - comprehensive retry debugging gap
  if (retriesEnabled) {
    const hasTraceConfig = trace && trace !== "off";
    const hasVideoConfig = video && video !== "off";
    const publishesArtifacts = ci.publishesTracesOrTestResultsDir;
    
    // Calculate severity based on how many debugging mechanisms are missing
    let debuggingGaps = 0;
    const gaps: string[] = [];
    
    if (!hasTraceConfig) {
      debuggingGaps++;
      gaps.push("trace not enabled");
    }
    if (!hasVideoConfig) {
      debuggingGaps++;
      gaps.push("video not enabled");
    }
    if (!publishesArtifacts && ci.files.length > 0) {
      debuggingGaps++;
      gaps.push("artifacts not published in CI");
    }
    
    // Only trigger if at least 2 debugging mechanisms are missing
    if (debuggingGaps >= 2) {
      const severity = debuggingGaps === 3 ? "high" : "medium";
      
      findings.push({
        findingId: "PW-INSIGHT-008",
        severity,
        title: "Debugging black hole detected (retries enabled without debug artifacts)",
        description:
          `Tests are configured to retry on failure (retries: ${retriesExpr}), but critical debugging mechanisms are missing: ${gaps.join(", ")}. When tests fail after retries, you'll have no way to understand what went wrong. This creates a "debugging black hole" where flaky tests are invisible until they become blocking incidents.`,
        recommendation:
          "Enable the full debugging stack: (1) Set trace: 'retain-on-failure' or 'on-first-retry' in playwright.config.ts; (2) Set video: 'on-first-retry'; (3) Publish the test-results folder as a CI artifact (use condition: always() so it runs even on failure). This ensures every retry failure is debuggable.",
        evidence: [
          {
            file: pw?.configPath ?? "playwright.config",
            line: 1,
            snippet: `retries: ${retriesExpr}; debugging gaps: ${gaps.join(", ")}`,
          },
          ...(!hasTraceConfig
            ? [
                {
                  file: pw?.configPath ?? "playwright.config",
                  line: 1,
                  snippet: trace ? `trace: ${trace} (insufficient)` : "trace: not configured",
                },
              ]
            : []),
          ...(!publishesArtifacts && ci.files.length > 0
            ? [
                {
                  file: `${repoPath} (CI summary)`,
                  line: 1,
                  snippet: "No test-results artifact publishing found in CI pipelines",
                },
              ]
            : []),
        ],
      });
    }
  }

  // PERF-001 Insight: Correlate missing network waits with hard waits
  const networkIdleGoto = hasFinding(findings, "PW-PERF-001");
  
  if (networkIdleGoto && hardWaits) {
    findings.push({
      findingId: "PW-INSIGHT-009",
      severity: "high",
      title: "Unreliable networkidle wait compounded by hard waits",
      description:
        "Tests use page.goto() with waitUntil: 'networkidle' AND contain hard waits (waitForTimeout/setTimeout). The combination of unreliable networkidle detection with arbitrary delays suggests deep timing instabilities that should be resolved with proper wait strategies.",
      recommendation:
        "Remove waitUntil: 'networkidle' from page.goto() calls (the default 'load' is sufficient). Replace hard waits with page.waitForResponse() for specific API calls, or expect(locator).toBeVisible() for UI elements. Remove setTimeout/waitForTimeout delays once proper waits are in place.\nhttps://playwright.dev/docs/api/class-frame#frame-wait-for-url",
      evidence: [
        {
          file: `${repoPath} (correlation analysis)`,
          line: 1,
          snippet: "Detected PW-PERF-001 + PW-FLAKE-001: unreliable waits compounding",
        },
      ],
    });
  }

  // PERF-002 Insight: Correlate hardcoded URLs with missing baseURL and high parallelism
  const hardcodedUrls = hasFinding(findings, "PW-PERF-002");
  const noBaseUrl = !pw?.use?.baseURL;

  // PW-PERF-002 severity downgrade: if baseURL IS configured, hardcoded URLs are less
  // critical (they may be specific API endpoints, not base navigation).
  if (hardcodedUrls && pw?.use?.baseURL) {
    const perfFinding = findings.find(f => f.findingId === "PW-PERF-002");
    if (perfFinding) perfFinding.severity = "low";
  }
  
  if (hardcodedUrls && noBaseUrl) {
    const workersNum = workers && /^\d+$/.test(workers) ? parseInt(workers) : 0;
    const severity = workersNum > 4 ? "high" : "medium";
    
    findings.push({
      findingId: "PW-INSIGHT-010",
      severity,
      title: noBaseUrl
        ? "Hardcoded URLs without baseURL configuration"
        : "Potential environment flexibility issue",
      description: noBaseUrl
        ? `Tests contain hardcoded URLs (http://, https://) but playwright.config.ts does not define baseURL. This makes it difficult to run tests against different environments (dev, staging, production) and violates DRY principles.${workersNum > 4 ? ` With ${workers} workers configured, environment setup becomes even more critical for avoiding test interference.` : ""}`
        : `Tests contain hardcoded URLs. Consider using baseURL for better environment management.`,
      recommendation: noBaseUrl
        ? "Add baseURL to playwright.config.ts use block and refactor tests to use relative paths. For example: baseURL: process.env.BASE_URL || 'https://staging.example.com', then use page.goto('/login') instead of page.goto('https://example.com/login'). This enables easy environment switching via environment variables.  https://playwright.dev/docs/api/class-testoptions#test-options-base-url"
        : "Refactor tests to use baseURL and relative paths for better maintainability.",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: noBaseUrl
            ? `baseURL not configured; hardcoded URLs detected${workersNum > 4 ? `; workers: ${workers}` : ""}`
            : "baseURL present but hardcoded URLs still used",
        },
      ],
    });
  }

  // ============================================
  // PW-PERF-003: networkidle combined with high timeout
  // ============================================
  const hasNetworkIdle = hasFinding(findings, "PW-FLAKE-004");
  if (hasNetworkIdle && testTimeoutMs && testTimeoutMs > 60000) {
    findings.push({
      findingId: "PW-PERF-003",
      severity: "medium",
      title: "networkidle combined with high timeout — hidden slow tests",
      description:
        `Tests use waitForLoadState('networkidle') while the test timeout is set to ${Math.round(testTimeoutMs / 1000)}s. networkidle waits for zero network activity for 500ms, and combined with a generous timeout, tests may silently wait much longer than necessary without failing.`,
      recommendation:
        "Replace networkidle with specific waits (waitForResponse, expect(locator).toBeVisible()). Reduce test timeout to 30-60s to surface slow tests earlier. networkidle is unreliable in SPAs with background requests.\nhttps://playwright.dev/docs/api/class-page#page-wait-for-load-state",
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: `timeout: ${testTimeoutMs}ms + networkidle usage detected`,
        },
      ],
    });
  }

  // ============================================
  // PW-INSIGHT-011: "Green but useless" tests
  // ============================================
  const noAssertions = hasFinding(findings, "PW-STABILITY-004");
  if (noAssertions && retriesEnabled) {
    // Pull evidence from PW-STABILITY-004, then remove it — INSIGHT-011 supersedes it
    const stability004Idx = findings.findIndex((f) => f.findingId === "PW-STABILITY-004");
    const stability004 = stability004Idx >= 0 ? findings[stability004Idx] : undefined;
    const testFileEvidence = (stability004?.evidence ?? []).slice(0, 10).map((e) => ({
      file: e.file,
      line: e.line,
      snippet: e.snippet,
    }));

    // Remove PW-STABILITY-004 — the insight is strictly more informative
    if (stability004Idx >= 0) findings.splice(stability004Idx, 1);

    findings.push({
      findingId: "PW-INSIGHT-011",
      severity: "high",
      title: '"Green but useless" tests (no assertions + retries)',
      description:
        `${stability004 ? stability004.description + " " : ""}Combined with enabled retries, these tests create an illusion of quality, they may never fail, but count toward pass rates. This is worse than having no tests and creates false confidence.`,
      recommendation:
        "Add meaningful expect() assertions to every test. Keep Page Objects focused on actions and state accessors; put assertions in the test (or in small, domain-named assertion helpers) so intent remains explicit. A test without an assertion provides no quality signal. Add a linter rule to require at least one assertion per test",
      evidence: [
        ...testFileEvidence,
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: `retries: ${retriesExpr ?? "unknown"} (amplifies the risk from assertion-free tests above)`,
        },
      ],
    });
  }

  // ============================================
  // PW-INSIGHT-012: Suite scale vs CI parallelism mismatch
  // ============================================
  const testCount = inventory.testFiles;
  const workersValue = pw?.workers;
  const workersNum = workersValue && /^\d+$/.test(workersValue) ? parseInt(workersValue) : undefined;
  const effectiveWorkers = workersNum ?? (pwUsesWorkersEnv && ci.setsWorkersEnv ? undefined : 1);

  if (testCount >= 500 && effectiveWorkers !== undefined && effectiveWorkers <= 2) {
    const estimatedMinutes = Math.round((testCount * 30) / 60 / effectiveWorkers);
    findings.push({
      findingId: "PW-INSIGHT-012",
      severity: "high",
      title: `Suite scale vs. CI parallelism mismatch (${testCount} tests, ${effectiveWorkers} worker${effectiveWorkers > 1 ? "s" : ""})`,
      description:
        `This repository has ${testCount} test files but workers appear to be set to ${effectiveWorkers}. At this scale, tests would take an estimated ~${estimatedMinutes} minutes serially. This is almost certainly too slow for practical CI feedback.`,
      recommendation:
        `Increase workers to at least 4 (or use process.env.WORKERS for environment flexibility). Combined with sharding across ${testCount > 500 ? 4 : 2} CI jobs, this could reduce CI time by 75%+. Use 'workers: process.env.CI ? 4 : 2' for balanced local/CI behavior.`,
      evidence: [
        {
          file: pw?.configPath ?? "playwright.config",
          line: 1,
          snippet: `${testCount} test files; workers: ${workersValue ?? "default (1)"}; estimated ${estimatedMinutes} min`,
        },
      ],
    });
  }

  // ============================================
  // PW-INSIGHT-013: Over-targeted test scope (E2E only)
  // ============================================
  // If all/most tests use page.goto() to full URLs, it suggests an E2E-only strategy
  // with no component-level or API-level testing.
  const gotoFinding = findings.find(f => f.findingId === "PW-PERF-002");
  const gotoEvidenceCount = gotoFinding?.evidence?.length ?? 0;

  if (testCount >= 20 && gotoEvidenceCount >= Math.min(testCount * 0.7, 15) && noBaseUrl) {
    findings.push({
      findingId: "PW-INSIGHT-013",
      severity: "low",
      title: "E2E-only test strategy detected (no component/API test layer)",
      description:
        `Most tests (${gotoEvidenceCount}+ instances) navigate to full URLs, suggesting an end-to-end-only testing strategy. While E2E tests are valuable, they are slow and fragile. A testing pyramid with API-level and component-level tests provides faster feedback and better isolation.`,
      recommendation:
        "Consider adding API-level tests (using request context) for business logic validation and component tests for UI behavior. This creates a testing pyramid: many fast API tests, some component tests, fewer E2E tests. Playwright supports all three.\nhttps://playwright.dev/docs/api-testing",
      evidence: [
        {
          file: `${repoPath} (analysis summary)`,
          line: 1,
          snippet: `${testCount} test files with ${gotoEvidenceCount}+ full-URL navigations; no baseURL configured`,
        },
      ],
    });
  }

  // ============================================
  // POST-PROCESSING: Apply .auditrc.json overrides
  // ============================================
  const auditConfig = options.auditConfig;
  if (auditConfig) {
    const disabled = auditConfig.rules?.disabled ?? [];
    // Remove disabled findings
    for (let i = findings.length - 1; i >= 0; i--) {
      if (disabled.includes(findings[i].findingId)) {
        findings.splice(i, 1);
      }
    }
    // Apply severity overrides
    for (const f of findings) {
      const override = auditConfig.rules?.severityOverrides?.[f.findingId];
      if (override) f.severity = override;
    }
  }

  return { repoPath, inventory, findings, gitBranch: git.branch, gitCommit: git.commit };
}
