# Changelog

## [5.2.0] - 2026-02-24

### Scoring Redesign — Health Score (0–100, higher = better)

- **Breaking change**: The `riskScore` field now contains a 0–100 health score instead of
  unbounded risk points. Higher values mean healthier repos. The field name is unchanged
  to preserve the `ScanResult` contract.
- New scoring formula: `healthScore = round(100 * exp(-riskPoints / 80))` — exponential
  decay maps raw risk points to an intuitive bounded scale.
- New grade thresholds: A (≥80), B (≥50), C (≥30), D (≥15), F (<15).
- New exported helpers: `riskPointsToHealthScore()`, `gradeFromHealthScore()` in `scoring.ts`.
- Default `.auditrc.json` thresholds updated: `{ gradeA: 80, gradeB: 50, gradeC: 30 }`.
- Report hero card now shows `Grade A (92/100)` style with updated footnote.
- Dashboard: all pages updated — trend direction flipped (score up = good), progress bars
  use 0–100 range, labels renamed from "Risk Score" to "Health Score".
- Database migration (`health_score_v1`): existing stored risk_score values automatically
  converted to health scores on first dashboard startup.

---

## [5.1.0] - 2026-02-24

### New Audit Rules — Resource Leaks, Over-Assertion, Inline Test Data

- **PW-STABILITY-005** (Medium) — Detects manual `chromium.launch()` / `browser.newContext()`
  / `browser.newPage()` without corresponding `.close()` in afterEach/afterAll. Skips files
  using Playwright's auto-cleaning `({ page })` fixture pattern.
- **SE-STABILITY-001** (Medium) — Detects Selenium WebDriver creation (`webdriver.Chrome()`,
  `new ChromeDriver()`, etc.) without `driver.quit()` in a teardown hook. Cross-language
  support: Python, Java, TypeScript, JavaScript.
- **PW-STABILITY-006** (Low) — Flags individual tests with >5 `expect()` assertions.
  Tests that verify too many behaviors are harder to debug. Only emits when ≥3 tests exceed
  the threshold. Skips data-driven loops.
- **ARCH-010** (Low) — Cross-framework detection of hardcoded inline test data (usernames,
  addresses, dates, prices, credit cards, zip codes) in test files. Requires variable-name-
  anchored patterns (e.g., `firstName = 'John'`) to avoid false positives. Scans Playwright,
  Cypress, and Selenium test files.

### Report & Scoring

- New findings integrate with existing scoring: ARCH-010 gets the 1.2x architecture multiplier.
- `categorizeFindings()` and `calculateRemediationTime()` updated with effort estimates for
  all 4 new rules.

### Test Fixtures

- New bad-repo fixtures: `resource-leak.spec.ts`, `over-asserted.spec.ts`
- New selenium-repo fixture: `test_checkout.py` (resource leak + inline data)
- New cypress-repo fixture: `checkout.cy.ts` (inline data)
- Modified bad-repo `checkout.spec.ts` with inline data patterns

---

## [5.0.1] - 2026-02-22

### Dashboard — Delete Repository

- **DELETE `/api/repos/[name]`** — New API endpoint that transactionally removes a repository
  and all its scans + findings from the SQLite database.
- **Trash icon on repo cards** — Each card on the `/repos` page now shows a trash-can icon
  (bottom-right, visible on hover) with a "Delete repository" tooltip.
- **Confirmation dialog** — Clicking the icon opens a destructive confirmation dialog
  (`ConfirmDialog` component) before executing the delete.
- **Error handling** — Delete failures surface an inline error toast; the dialog shows
  a loading state ("Deleting…") while the request is in flight.
- **New reusable component** — `dashboard/src/components/ui/confirm-dialog.tsx` — accessible
  confirmation dialog built on the native `<dialog>` element with focus trap, Escape-to-close,
  and backdrop-click dismiss.

---

## [5.0.0] - 2026-02-21

### Multi-Environment Sink Architecture — Local / Hub / Pipeline Support

This release introduces the **sink architecture**: a pluggable result-routing system that
lets the CLI produce a canonical `ScanResult` payload and route it to one or more storage
backends depending on the execution environment.

---

### 🏗️ Canonical `ScanResult` Contract

A new stable result contract (`src/scanResult.ts`) is emitted by every scan. It includes:

| Field | Description |
|-------|-------------|
| `tool` | Always `"scantrix"` |
| `version` | Tool version from `package.json` |
| `runId` | UUID v4 — unique per scan |
| `startedAt` / `completedAt` | ISO-8601 timestamps bracketing the scan |
| `repo` | `{ path, name, branch, commit }` |
| `findings` | Full array of findings with evidence |
| `summary` | `{ total, high, medium, low, riskScore, riskGrade }` |
| `inventory` | Repository inventory snapshot |

All sinks consume this identical shape, ensuring consistent artifacts regardless of where
the scan runs.

- **Added:** `src/scanResult.ts` — `ScanResult` interface + `buildScanResult()` factory

### 🔌 Pluggable Sink System

Three sinks ship out of the box:

| Sink | Module | Purpose |
|------|--------|---------|
| **JSON** | `src/sinks/jsonSink.ts` | Writes `ScanResult` to a file (zero dependencies) |
| **SQLite** | `src/sinks/sqliteSink.ts` | Persists to local SQLite DB (optional `better-sqlite3`) |
| **Hub** | `src/sinks/hubSink.ts` | POSTs `ScanResult` to a central Hub ingestion endpoint |

Sink routing is determined by `SCANTRIX_SINK` (or `--sink`):
- **`local`** (default): optional JSON file + optional SQLite DB
- **`hub`**: optional JSON file + HTTP POST to Hub (requires `SCANTRIX_INGEST_URL` + `SCANTRIX_TOKEN`)

Configuration is validated **before** the scan starts (fail-fast). Missing required
values in hub mode cause an immediate error with a clear message.

- **Added:** `src/sinks/types.ts` — `Sink` interface
- **Added:** `src/sinks/index.ts` — `resolveSinkConfig()`, `buildSinks()`, re-exports
- **Added:** `src/sinks/jsonSink.ts` — JSON file sink
- **Added:** `src/sinks/sqliteSink.ts` — SQLite sink (dynamic import of `better-sqlite3`)
- **Added:** `src/sinks/hubSink.ts` — Hub HTTP POST sink

### ⚙️ New CLI Flags & Environment Variables

| Flag | Env Variable | Description |
|------|-------------|-------------|
| `--sink local\|hub` | `SCANTRIX_SINK` | Sink mode (default: `local`) |
| `--json-path <path>` | `SCANTRIX_JSON_PATH` | Write canonical results JSON to this path |
| `--sqlite-path <path>` | `SCANTRIX_SQLITE_PATH` | Local SQLite DB path (local mode only) |
| `--ingest-url <url>` | `SCANTRIX_INGEST_URL` | Hub ingestion endpoint (hub mode, required) |
| `--token <tok>` | `SCANTRIX_TOKEN` | Bearer token for Hub auth (hub mode, required) |

- **Changed:** `src/cli.ts` — integrated sink routing after scan completion; added
  `startedAt` timestamp tracking, `ScanResult` building, and sequential sink writes with
  per-sink error logging; updated usage text with new flags and env vars

### ✅ Test Suite

- **138 tests** across **11 test files** (up from 117 / 10)
- **Added:** `tests/sinks.test.ts` — 21 tests covering `buildScanResult`, `resolveSinkConfig`,
  `buildSinks`, and `JsonSink` integration (file I/O)

### 📚 Documentation

- **Added:** `docs/CLI_ARCHITECTURE.md` — Full architecture overview, data-flow diagrams,
  environment modes, step-by-step customer setup guide
- **Updated:** `CHANGELOG.md`, `readMe.md`, `PROJECT_CONTEXT.md`, `docs/DEPLOYMENT_GUIDE.md`,
  `docs/CI_INTEGRATION.md`, `repo_audit_agent_project_overview_handoff_guide.md`

---

## [4.3.0] - 2026-02-19

### Bug Fixes & Data Integrity — Missing Repo Handling, Linkified URLs, Aggregate Trend Accuracy
### New Feature — Clickable Scan History → Historical Scan Report

---

### 🔍 Clickable Scan History Dates — Historical Scan Reports

Clicking a date in any Scan History table now opens the **full repo report** for that
specific scan. The existing repo detail page (`/repos/[name]`) is reused with a `?scan=<id>`
query parameter, rendering the same rich view (grade, score, severity breakdown, priority
files, recommended actions, effort estimation, findings with evidence, config overview) —
populated from the selected historical scan instead of the latest.

A yellow banner indicates when viewing a historical scan, with a "View latest →" link.

- **Changed:** `dashboard/src/app/api/repos/[name]/route.ts` — accepts optional `?scan=<id>`
  query param; loads that scan (with repo ownership validation) instead of latest
- **Changed:** `dashboard/src/app/repos/[name]/page.tsx` — reads `scan` search param via
  `useSearchParams()`, passes to API, shows historical scan banner with back-to-latest link
- **Changed:** `dashboard/src/app/trends/page.tsx` — scan history dates link to
  `/repos/[name]?scan=<id>` when viewing a single repo
- **Changed:** `dashboard/src/app/api/trends/route.ts` — per-repo query now includes
  `s.id as scan_id` so the frontend can build scan links
- **Removed:** `dashboard/src/app/scans/[id]/page.tsx` and `dashboard/src/app/api/scans/[id]/route.ts`
  — superseded by the `?scan=` approach

---

### 🛡️ Graceful Handling of Missing Repository Paths

`scanRepo()` no longer throws when the target repository folder has been deleted or moved.
Instead it returns an empty inventory with a single `SCAN-MISSING-REPO` high-severity finding,
allowing the full report/snapshot/push pipeline to proceed. This ensures re-scanning a previously
tracked repo adds a new scan entry to the existing dashboard record rather than crashing.

- **Changed:** `src/scanner.ts` — replaced `throw` with graceful empty result + warning finding
- **Added:** 3 new tests in `tests/scanner.test.ts` covering the missing-repo path

### 🔗 Clickable URLs in Dashboard Findings

Recommendation and description text in the dashboard findings panel now auto-linkifies URLs
(e.g. Playwright doc links) into clickable `<a>` tags that open in a new tab.

- **Changed:** `dashboard/src/app/repos/[name]/page.tsx` — added `linkifyText()` helper,
  applied to recommendation and description fields with `whitespace-pre-line` for proper
  line-break rendering

### 📊 Fixed Aggregate Risk Trend Calculation

The main dashboard "Risk Trend" chart was computing `AVG(risk_score)` only over scans that
occurred on each specific date. When only one repo was scanned on a given day, the aggregate
average reflected only that repo's score — not the portfolio. This caused false spikes/dips
(e.g. a score of 83 when 9 other repos with lower scores were omitted).

**Root cause:** `GROUP BY date(scanned_at)` with `AVG()` ignores repos not scanned that day.

**Fix:** The `/api/trends` aggregate endpoint now computes a **rolling portfolio state** —
processing all scans chronologically, maintaining each repo's latest known score, and
outputting the portfolio-wide average at each date. Re-scanning one repo no longer distorts
the aggregate; all other repos' last-known scores are always included.

- **Changed:** `dashboard/src/app/api/trends/route.ts` — rewrote aggregate branch with
  rolling latest-per-repo logic

### 📅 Fixed Timezone-Shifted Date Labels on Trends Page

X-axis labels and tooltips on the Trends page (Findings Over Time, Resolved vs Introduced,
Risk Score Trajectory, Scan History) were showing dates shifted one day earlier than the
actual scan date when viewed in US timezones.

**Root cause:** Date-only strings like `"2026-02-19"` are parsed by `new Date()` as UTC
midnight. Converting to local time in timezones behind UTC (e.g. EST, PST) shifts the
displayed day back by one (Feb 19 UTC → Feb 18 local).

**Fix:** Date-only strings now have `T12:00:00` appended before parsing, forcing local-noon
interpretation and ensuring the displayed date matches the actual scan date regardless
of timezone.

- **Changed:** `dashboard/src/app/trends/page.tsx` — fixed date parsing in both trend data
  and delta data mapping functions

### 🎨 Per-Segment Risk Trend Chart Coloring

The Risk Trend mini-chart on the main dashboard now colors **each segment independently**
based on whether the risk score improved or worsened between consecutive scans:

- **Green** segments — score decreased (improving)
- **Red** segments — score increased (declining)
- **Blue** segments — score unchanged (flat)

Previously the entire chart used a single color based on overall direction, which meant a
single bad scan would turn the whole chart red even though most of the history was improving.

The trend indicator badge now shows the **latest segment's direction** (last two data points)
so the user sees what just happened rather than an all-time average.

**Implementation:** Two horizontal `<linearGradient>` elements (`riskStrokeGrad`,
`riskFillGrad`) with stop pairs computed from `segmentStops[]`, each pair marking the
start/end percentage of the segment and its direction-based color.

- **Changed:** `dashboard/src/app/page.tsx` — per-segment gradient stops, `latestSegmentDir`
  for badge, removed single-color `trendFillColor`/`trendStrokeColor`
- **Added:** `PROJECT_CONTEXT.md` — "Risk Trend Chart" reference section

---

## [4.2.0] - 2026-02-15

### Dashboard UX Overhaul — Repo Detail Page, Sidebar Navigation & Inventory Pipeline

This release delivers a major dashboard upgrade: a new collapsible sidebar navigation,
a fully-featured repository detail page (replacing the previous 404), and end-to-end
wiring of the repo inventory data through the push pipeline.

---

### 🖥️ Dashboard — New Repository Detail Page

Clicking a repository in the dashboard now opens a rich detail page at `/repos/[name]`
with the following sections:

| Section | Description |
|---------|-------------|
| **Overview Cards** | Grade badge, total findings, high-severity count, total scans |
| **Repository Statistics** | Total files, test files, Playwright version, config file count, detected frameworks, git branch & commit, test-file ratio bar |
| **Severity Breakdown** | Horizontal percentage bars for high / medium / low findings |
| **Priority Files** | Top 8 hotspot files ranked by severity-weighted score with rule badges |
| **Recommended Actions** | Top 5 actionable recommendations derived from highest-severity findings |
| **Findings Table** | Collapsible rows with evidence (file, line, snippet), description, and recommendation |
| **Configuration Overview** | Playwright Config (settings, runtime options, reporters, projects) and CI/CD Config (platform, feature matrix, pipeline files, infrastructure) |
| **Scan History** | Last 20 scans with grade, finding counts, and risk score |

**New files:**
- `dashboard/src/app/repos/[name]/page.tsx` — Client-side detail page (~920 lines)
- `dashboard/src/app/api/repos/[name]/route.ts` — API returning repo metadata, latest scan, findings with evidence, inventory, and scan history

### 🧭 Dashboard — Collapsible Sidebar Navigation

Replaced the top-bar navigation with a modern, sticky sidebar:

| Feature | Detail |
|---------|--------|
| **Icon-driven menu** | Dashboard, Repos, Trends, Compare — each with a lucide-react icon |
| **Collapsible toggle** | Sidebar collapses from 240 px to 68 px with smooth animation |
| **Active route highlighting** | Indigo glow + background for the active page |
| **Responsive layout** | `flex` layout with scrollable `<main>` content area |

**New files:**
- `dashboard/src/components/sidebar.tsx`

**Updated files:**
- `dashboard/src/app/layout.tsx` — replaced top nav header with `<Sidebar />` + flex layout
- `dashboard/src/app/globals.css` — thin scrollbar styling, sidebar glow utility

### 🔌 Inventory Pipeline — Push to Dashboard

Repository inventory data (`repo_inventory.json`) is now pushed through the full pipeline
so the dashboard can render Configuration Overview and Repository Statistics sections.

| Layer | Change |
|-------|--------|
| `src/report.ts` | `repo_inventory.json` now includes `gitBranch` and `gitCommit` from scan results |
| `src/cli.ts` | `push` subcommand reads `repo_inventory.json` alongside `findings.json` |
| `src/pushClient.ts` | Accepts optional `inventory` in `PushOptions`; includes it in POST body |
| `dashboard/src/app/api/scans/route.ts` | Stores inventory as JSON in the `summary_json` column |
| `dashboard/src/app/api/repos/[name]/route.ts` | Parses `summary_json` and returns inventory to the frontend |

### 🎨 Dashboard — UI Refinements

| Change | Detail |
|--------|--------|
| **Stat card icons** | Increased by 50 % — from 20 px (`h-5 w-5`) to 30 px (`h-[30px] w-[30px]`) |

### ✅ Test Suite

- **113 tests** across **10 test files** (up from 104)
- All tests passing, dashboard build compiles cleanly

---

## [4.1.0] - 2026-02-14

### Diff Tracking Accuracy & Git-Aware Snapshots

This release fixes diff tracking accuracy on Windows, adds git metadata to snapshots
and reports, and enriches the trend system with inventory-level change tracking.

---

### � Rule Changes

| Rule | Change | Detail |
|------|--------|--------|
| **PW-PERF-001** | **Redefined** | Previously flagged every `page.goto()` without an explicit `waitUntil` option. Per the [Playwright docs](https://playwright.dev/docs/api/class-page#page-goto), `page.goto()` defaults to `waitUntil: 'load'`, which is reliable and correct. The rule now only fires when `page.goto()` explicitly uses `waitUntil: 'networkidle'`, which is discouraged. Title changed from *"Missing network wait strategies"* → *"page.goto() using unreliable 'networkidle' wait strategy"*. |
| **PW-INSIGHT-009** | **Updated** | Correlation insight updated to reflect PW-PERF-001's new meaning — now titled *"Unreliable networkidle wait compounded by hard waits"*. |
| **PW-INSIGHT-013** | **Narrowed** | E2E-only strategy detection no longer uses PW-PERF-001 evidence (only PW-PERF-002 hardcoded URLs), since PW-PERF-001 no longer represents general `page.goto()` usage. |

### 📚 Playwright Docs Audit — Rule Accuracy & New Detections

Comprehensive review of all rules against the official Playwright documentation (`microsoft-playwright-main/docs/src`). Every change verified against the source docs.

#### Rule Corrections

| Rule | Change | Detail |
|------|--------|--------|
| **PW-DEPREC-004** | **Reclassified** | Was "Deprecated test.describe.parallel/serial". `test.describe.parallel()` is **not deprecated** per Playwright docs. Now only flags `test.describe.serial()` as an isolation risk. Title changed to *"test.describe.serial usage (isolation risk)"*. |
| **ARCH-001** | **Downgraded LOW** | Was MEDIUM. Now recommends fixtures over class inheritance per Playwright's fixture-first philosophy. Title: *"No shared base pattern across Page Objects"*. |
| **ARCH-002** | **Clarified** | Playwright's official POM example uses `public readonly` locators — that's acceptable. Now only suggests encapsulating complex multi-step interactions. |
| **PW-STABILITY-001** | **Clarified** | Updated description to acknowledge Playwright's built-in BrowserContext isolation. Hooks needed for custom state (global vars, API sessions, DB records), not browser state. |

#### Severity Adjustments

| Rule | Old | New | Rationale |
|------|-----|-----|-----------|
| **PW-LOC-001** | LOW | **MEDIUM** | Playwright docs strongly discourage XPath usage |
| **PW-INSIGHT-005** | MEDIUM | **HIGH** | best-practices doc explicitly recommends trace |
| **PW-FLAKE-004** | MEDIUM | **HIGH** | networkidle not mentioned in any of 21 main doc files; strongly discouraged |
| **CI-014** | LOW | **MEDIUM** | best-practices doc recommends CI-conditional reporters |

#### New Rules Added

| Rule | Severity | Description |
|------|----------|-------------|
| **PW-FLAKE-005** | 🔴 HIGH | Non-retrying assertions (`expect(await locator.isVisible()).toBe(true)`) — docs explicitly warn these cause flaky tests. 11 detection patterns. |
| **PW-FLAKE-006** | 🟡 LOW | `test.fixme()` markers indicate deferred broken tests / growing tech debt. |
| **PW-DEPREC-007** | 🟠 MEDIUM | `page.type()` / `locator.type()` deprecated in Playwright v1.39. Use `fill()` or `pressSequentially()`. |
| **PW-DEPREC-008** | 🟠 MEDIUM | Layout selectors (`:left-of`, `:right-of`, `:above`, `:below`, `:near`) deprecated per docs. |
| **PW-INSIGHT-014** | 🔴 HIGH | Missing `forbidOnly` in config — `test.only()` can silently leak to CI. Docs recommend `forbidOnly: !!process.env.CI`. |
| **PW-INSIGHT-015** | 🟠 MEDIUM | Retries not CI-conditional — docs recommend `retries: process.env.CI ? 2 : 0`. |

#### CI-005 Clarification

| Rule | Change | Detail |
|------|--------|--------|
| **CI-005** | **Clarified** | Now specifies npm/node_modules caching only. Explicitly notes Playwright docs say **NOT** to cache browser binaries (download time ≈ restore time). Links to `https://playwright.dev/docs/ci#caching-browsers`. |

### �🐛 Bug Fixes

| Fix | Detail |
|-----|--------|
| **Windows path casing in evidence diffs** | Evidence keys (`file:line`) are now normalized to lowercase with forward slashes before comparison. Previously, `c:/Repo/file.ts:10` vs `C:/Repo/file.ts:10` across runs caused phantom evidence changes or missed real changes. |

### 🆕 Git Metadata in Snapshots & Reports

| Feature | Detail |
|---------|--------|
| **Git branch & commit in snapshots** | `saveSnapshot()` now captures `gitBranch` and `gitCommit` in `meta.json` via `git rev-parse` |
| **Git branch in report header** | The audit summary metadata table now shows the scanned branch (e.g. `main`, `feature/xyz`) |
| **Git branch + commit in appendix** | The Repository Statistics appendix section includes branch and commit SHA |
| **`ScanResults` type expanded** | Added `gitBranch?: string` and `gitCommit?: string` to the `ScanResults` type |
| **`getGitInfo()` exported** | Reusable git metadata helper exported from `diffTracker.ts` |

### 📊 Inventory-Level Trend Tracking

| Feature | Detail |
|---------|--------|
| **Inventory in snapshots** | `meta.json` now includes `totalFiles` and `testFiles` counts |
| **Inventory delta in diffs** | `computeDiff()` accepts `baselineInventory` / `currentInventory` and produces an `inventoryDelta` |
| **Inventory table in diff report** | `formatDiffMarkdown()` renders a "Total files scanned" / "Test files" change table |
| **Inventory in console summary** | `formatDiffConsoleSummary()` appends file count changes (e.g. `(codebase: files 1200→1336, tests 800→981)`) |

### ⚙️ API Changes

**`saveSnapshot()` — new overload:**
```ts
// Old (still supported for backward compat):
saveSnapshot(outDir, findings, riskScore?: number)

// New (preferred):
saveSnapshot(outDir, findings, {
  riskScore?: number,
  inventory?: Inventory,
  repoPath?: string,  // used for git metadata
})
```

**`computeDiff()` — new optional parameter:**
```ts
computeDiff(previous, current, {
  baselineInventory?: { totalFiles?: number; testFiles?: number },
  currentInventory?: { totalFiles?: number; testFiles?: number },
})
```

**New types:**
- `InventoryDelta` — `{ totalFiles: { prev, curr }, testFiles: { prev, curr } }`
- `SaveSnapshotOptions` — `{ riskScore?, inventory?, repoPath? }`
- `ComputeDiffOptions` — `{ baselineInventory?, currentInventory? }`

**`ReportOptions` expanded:**
- Added `baselineMeta?: SnapshotMeta` for passing baseline inventory to the report's diff computation

**`SnapshotMeta` expanded:**
- Added `totalFiles?: number`, `testFiles?: number`, `gitBranch?: string`, `gitCommit?: string`

### ✅ Test Suite

- **104 tests** across **10 test files** (up from 99)
- 5 new tests covering:
  - Windows path casing normalization in evidence diffs
  - Inventory delta computation (with and without baseline)
  - Console summary with inventory changes
  - Snapshot saving with options object (inventory + riskScore)

---

## [4.0.0] - 2026-02-12

###  Phase 2 Complete — Trend Tracking, CI Integration, Web Dashboard

This release delivers the full Phase 2 product features: enhanced trend tracking with
auto-snapshots, a GitHub Action for CI integration, a push client for the Scantrix
dashboard, CLI subcommands (`init`, `push`), and a complete Next.js web dashboard
for historical audit data, trend visualization, and cross-repo comparison.

---

### 🆕 New Modules

| Module | Purpose |
|--------|---------|
| `src/pushClient.ts` | HTTP(S) client for pushing audit findings to the Scantrix dashboard API |
| `dashboard/` | Next.js 14 web dashboard with SQLite backend |
| `action.yml` | GitHub Action (composite) for CI integration |
| `.github/workflows/scantrix-example.yml` | Example workflow for PR + nightly audits |

### 🔄 Enhanced Trend Tracking & Diff Mode

The trend/diff subsystem (`src/diffTracker.ts`) has been substantially expanded:

| Function | Purpose |
|----------|---------|
| `saveSnapshot()` | Saves timestamped `findings.json` + `meta.json` to `<outDir>/snapshots/<ISO-date>/` |
| `listSnapshots()` | Lists all snapshot directories in chronological order |
| `findLatestBaseline()` | Auto-discovers the most recent snapshot as diff baseline |
| `loadTrendHistory()` | Loads all `meta.json` files for dashboard charts |
| `formatDiffConsoleSummary()` | One-line terminal summary (e.g. `[trend] Delta: 2 new, 1 resolved, 5 unchanged.`) |

**New types:**
- `SnapshotMeta` — `{ timestamp, findingsCount, highCount, mediumCount, lowCount, riskScore }`
- `EvidenceChange` — `{ findingId, title, addedEvidence, removedEvidence }`

**Enhanced `computeDiff()`:**
- Now computes **evidence-level deltas** for persistent findings — tracks which specific file:line locations were added or removed even when the rule itself remains active
- `DiffResult` expanded with `baselineTimestamp`, `currentTimestamp`, `evidenceChanges[]`

**Enhanced `formatDiffMarkdown()`:**
- Emoji-prefixed sections: 🆕 New Issues, ✅ Resolved Issues, 🔄 Persistent Issues, 📊 Evidence Changes
- Baseline/current timestamps displayed
- Evidence changes table (added/removed counts per finding)

### ⚡ CLI Subcommands

The CLI (`src/cli.ts`) now supports three modes:

```
scantrix <repoPath> [--out <dir>] [--format ...] [--no-trend]   # Standard scan
scantrix init [dir]                                              # Create starter .auditrc.json
scantrix push [findings.json] [--key <key>] [--url <url>]       # Push to dashboard
```

**Standard scan enhancements:**
- **Auto-baseline detection**: Automatically finds the latest snapshot in `<outDir>/snapshots/` — no more manual `--diff <path>`
- **Auto-snapshot**: Saves a snapshot after every scan (disable with `--no-trend`)
- **Console trend summary**: Prints a one-line diff delta after each scan

**`init` subcommand:**
- Creates a well-documented `.auditrc.json` with `$schema` URL, default exclude globs, threshold defaults, and `_comments` documentation section
- Implemented via `generateDefaultConfig()` in `src/auditConfig.ts`

**`push` subcommand:**
- Reads `findings.json` and POSTs to the dashboard API with Bearer token auth
- Supports `--key`, `--url`, `--repo` flags and `SCANTRIX_API_KEY`, `SCANTRIX_API_URL`, `SCANTRIX_REPO_NAME` env vars
- Auto-infers repo name from `GITHUB_REPOSITORY` (GitHub Actions), `BUILD_REPOSITORY_NAME` (Azure DevOps), or cwd

### 🤖 GitHub Action (CI Integration)

**`action.yml`** — Composite GitHub Action for CI pipelines:

| Feature | Detail |
|---------|--------|
| Type | Composite action (no Docker required) |
| Runtime | Node 20 |
| Inputs | `repo-path`, `output-dir`, `config-path`, `format`, `check-updates`, `post-comment`, `fail-on-high`, `api-key`, `api-url` |
| Outputs | `findings-count`, `high-count`, `medium-count`, `low-count`, `risk-grade`, `report-path` |
| Artifacts | Auto-uploads audit artifacts (30-day retention) |
| PR comments | Posts/updates a summary comment with grade, finding counts, diff delta, and top findings table |
| Dashboard push | Optionally pushes findings to Scantrix dashboard API when `api-key` is provided |
| Quality gate | `fail-on-high: true` fails the workflow if any high-severity findings exist |

**`.github/workflows/scantrix-example.yml`** — Example workflow:
- Triggers on PR to main/master, nightly cron (2 AM UTC), manual dispatch
- Includes optional SARIF upload to GitHub Code Scanning

### 🖥️ Web Dashboard

A complete Next.js 14 web dashboard under `dashboard/`:

**Backend (SQLite + API routes):**

| Component | File | Purpose |
|-----------|------|---------|
| Database | `src/lib/db.ts` | SQLite via better-sqlite3, WAL mode, auto-init schema |
| Types | `src/lib/types.ts` | Shared TypeScript types for repos, scans, findings, trends |
| Push API | `src/app/api/scans/route.ts` | POST (receive CLI push) + GET (list scans) |
| Repos API | `src/app/api/repos/route.ts` | GET repos with latest scan info via LEFT JOIN |
| Trends API | `src/app/api/trends/route.ts` | GET historical severity counts per repo or aggregate |
| Compare API | `src/app/api/compare/route.ts` | GET cross-repo comparison with trend direction |

**Database schema (4 tables):**
- `repos` — id, name, url, created_at, updated_at
- `scans` — id, repo_id, scanned_at, findings_count, high/medium/low counts, risk_score, risk_grade, summary_json
- `findings` — id, scan_id, finding_id, severity, title, description, recommendation, evidence_count, evidence_json
- `api_keys` — id, key_hash, label, active, created_at

**Frontend pages:**

| Route | File | Features |
|-------|------|----------|
| `/` | `page.tsx` | Stat cards (repos, findings, high severity, avg grade), repository table |
| `/repos` | `repos/page.tsx` | Repository cards with grade badge, severity breakdown, risk bar |
| `/trends` | `trends/page.tsx` | Repo selector, stacked severity bar chart, risk score chart, scan history table |
| `/compare` | `compare/page.tsx` | Sortable comparison table, trend indicators (↑↓→), risk score bar chart |

**UI design:**
- Dark theme matching Scantrix indigo-blue brand palette
- Responsive card grid layout
- Grade badges (A–F), severity badges, trend indicators (improving/degrading/stable)
- Nav bar with Scantrix branding

### ✅ Test Suite

- **99 tests** across **10 test files** (up from 74 across 7)
- All tests passing

| New Test File | Tests | Coverage |
|---------------|-------|----------|
| `tests/diffTrackerEnhanced.test.ts` | 14 | `saveSnapshot`, `listSnapshots`, `findLatestBaseline`, `loadTrendHistory`, evidence-level diffs, `formatDiffConsoleSummary`, `formatDiffMarkdown` |
| `tests/auditConfig.test.ts` | 8 | `generateDefaultConfig` — JSON validity, schema, defaults, comments |
| `tests/pushClient.test.ts` | 3 | Real mock HTTP server — auth validation, payload format, error handling |

### 📦 Dependencies

**Main project** — No new runtime dependencies

**Dashboard (`dashboard/package.json`):**
- `next` ^14.2.0
- `react` / `react-dom` ^18.3.0
- `better-sqlite3` ^11.0.0

---

## [3.0.0] - 2026-02-12

### 🚀 Phase 1 Complete — Multi-Framework Support + AST Config Parsing

This release adds Cypress and Selenium framework support (9 new rules), AST-based
config parsing via the TypeScript Compiler API, and automatic framework detection.
The engine now covers 50+ audit rules across 3 frameworks.

---

### 🆕 New Modules

| Module | Purpose |
|--------|---------|
| `src/astConfigParser.ts` | AST-based Playwright config parser using TypeScript Compiler API |
| `src/cypressExtractor.ts` | Cypress project detection and config parser (TS/JS/JSON) |

### 🆕 Cypress Rules (CY-*)

| ID | Title | Severity | Type |
|----|-------|----------|------|
| CY-FLAKE-001 | Hard waits (cy.wait with numeric ms) | 🔴 HIGH | Regex |
| CY-FLAKE-002 | Fragile CSS selectors (missing data-cy) | 🟠 MEDIUM | Regex |
| CY-LOC-001 | XPath selectors in Cypress | 🟡 LOW | Regex |
| CY-PERF-001 | Missing baseUrl in Cypress config | 🟠 MEDIUM | Config analysis |
| CY-PERF-002 | Excessive defaultCommandTimeout (>30s) | 🟠 MEDIUM | Config analysis |
| CY-STABILITY-001 | No cy.intercept() usage detected | 🟡 LOW | Pattern analysis |

### 🆕 Selenium Rules (SE-*)

| ID | Title | Severity | Type |
|----|-------|----------|------|
| SE-FLAKE-001 | Hard waits (Thread.sleep / time.sleep) | 🔴 HIGH | Regex |
| SE-FLAKE-002 | Implicit waits (implicitly_wait) | 🟠 MEDIUM | Regex |
| SE-LOC-001 | XPath selectors in Selenium | 🟡 LOW | Regex |

### ⚙️ AST-Based Config Parsing

- **TypeScript Compiler API** replaces regex-based config parsing as the primary strategy
- Handles computed values: `60 * 1000`, `2 * 60 * 1000`
- Handles variable references: `const TIMEOUT = 60_000; ... timeout: TIMEOUT`
- Handles ternary expressions: `process.env.CI ? 2 : 0` (preserved as raw text)
- Handles `satisfies` keyword (TS 4.9+), `as` expressions, spread operators
- Handles `defineConfig()` and `export default` patterns
- **Falls back to regex** when AST parsing fails (100% backward compatible)

### 🔍 Framework Detection

- **Automatic framework detection** in `scanRepo()`: Playwright, Cypress, Selenium
- Inventory now includes `detectedFrameworks: string[]`
- Cypress detection via cypress.config.ts/js, cypress.json, or cypress/ directory
- Selenium detection via package.json (selenium-webdriver), requirements.txt, pom.xml, or import scanning
- `cypressConfigSummary` and `cypressTestFiles` / `seleniumTestFiles` in inventory

### ✅ Test Suite

- **28 new tests** (63 total, up from 35)
- `tests/astConfigParser.test.ts` — 10 tests for AST parser (computed values, ternaries, satisfies, variables)
- `tests/cypressExtractor.test.ts` — 3 tests for Cypress config extraction
- `tests/frameworks.test.ts` — 15 tests for Cypress/Selenium framework detection + rules
- 4 new fixture repos: `complex-config-repo`, `cypress-repo`, `cypress-nobaseurl-repo`, `selenium-repo`

---

## [2.5.0] - 2026-02-12

### 🚀 Major Release — Enterprise-Grade Audit Engine

This release adds 13 new findings, 7 rule improvements, SARIF output, trend tracking,
custom configuration, and a comprehensive test suite. The engine now covers 40+ audit rules.

---

### 🆕 New Code Pattern Rules

| ID | Title | Severity | Type |
|----|-------|----------|------|
| PW-FLAKE-003 | test.only / test.skip detected | 🔴 HIGH | Regex |
| PW-FLAKE-004 | networkidle usage | 🟠 MEDIUM | Regex |
| PW-LOC-002 | Deep CSS nesting (>3 levels) | 🟠 MEDIUM | Custom analysis |
| PW-LOC-003 | nth/first/last selectors | 🟠 MEDIUM | Regex |
| PW-STABILITY-004 | Tests without assertions | 🟠 MEDIUM | Custom analysis |
| PW-PERF-003 | networkidle + high timeout | 🟠 MEDIUM | Correlation |
| ARCH-008 | Large inline test data (≥50 lines) | 🟡 LOW | Custom analysis |
| ARCH-009 | Inline config overrides | 🟡 LOW | Custom analysis |

### 🆕 New CI Rules

| ID | Title | Severity |
|----|-------|----------|
| CI-011 | Missing `playwright install` in pipeline | 🔴 HIGH |
| CI-012 | CI environment variable mismatch | 🟠 MEDIUM |
| CI-013 | Missing/excessive pipeline timeout | 🟠 MEDIUM |
| CI-014 | No `--reporter` in CI playwright command | 🟡 LOW |

### 🆕 New Correlation Insights

| ID | Title | Triggers |
|----|-------|----------|
| PW-INSIGHT-011 | "Green but useless" tests | No assertions + retries enabled |
| PW-INSIGHT-012 | Scale vs parallelism mismatch | ≥500 tests + workers ≤ 2 |
| PW-INSIGHT-013 | E2E-only test strategy | Most tests use full URLs, no baseURL |

### 🔧 Rule Improvements

- **PW-FLAKE-001**: Tightened false-positive exclusion — now requires actual loop structure (while/for/do) within ±1 line, not just "retry" keyword anywhere in file
- **PW-PERF-001**: Switched to catch-all regex + post-match analysis for multi-line waitUntil detection
- **PW-PERF-002**: Severity auto-downgraded to LOW when `baseURL` is configured
- **PW-FLAKE-003**: Smart filtering — conditional `test.skip(boolean)` inside test bodies is excluded
- **ARCH-005**: Phone number regex now requires variable name containing phone/tel/mobile (eliminates false positives on IDs/zip codes)
- **CI-005**: Replaced overly broad cache regex with specific CI cache task patterns (Cache@2, actions/cache, setup-node cache, npm ci --cache)
- **Risk Score**: Evidence multiplier capped at 3.5× (was 5×); grade thresholds raised to A≤20, B≤50, C≤85

### 🏗️ New Infrastructure

- **SARIF Output** (`--format sarif`): SARIF 2.1.0 output for GitHub Code Scanning / Azure DevOps integration
- **Trend Tracking** (`--diff <baseline>`): Compare current scan against a previous findings.json; produces `audit_diff.md` and `audit_diff.json`
- **Custom Configuration** (`--config` / `.auditrc.json`): Disable rules, override severities, set grade thresholds per-repo
- **CLI Flags**: `--format md,html,json,sarif,email` · `--config path` · `--diff baseline`
- **Test Suite**: 35 vitest tests across 3 test files (configExtractor, diffTracker, scanner integration tests)
- **Test Fixtures**: bad-repo and good-repo fixtures for integration testing

### 📚 New Documentation

- [docs/SECURITY.md](docs/SECURITY.md) — Security considerations for the tool and detected findings
- [docs/CI_INTEGRATION.md](docs/CI_INTEGRATION.md) — CI pipeline integration guide (Azure Pipelines + GitHub Actions)
- [docs/RULES.md](docs/RULES.md) — Complete rule catalog with properties, patterns, and trigger conditions
- [.auditrc.example.json](.auditrc.example.json) — Example configuration file

### 🛠️ Technical Changes

- **configExtractor**: Added `evaluateNumericExpression()` for robust timeout parsing (handles `60*1000`, `60_000`, `6e4`, `2*60*1000`)
- **ciExtractor**: New CiSummary fields: `setsCiEnvTrue`, `hasPipelineTimeout`, `pipelineTimeoutMinutes`, `hasReporterInPlaywrightCommand`
- **report.ts**: Imports SARIF + diff modules; "Performance" category in findings table; new time estimates for all new rules
- **scanner.ts**: Post-processing for `.auditrc.json` (rule disabling + severity overrides); insight/correlation engine expanded

### 📦 Dependencies

- Added: `vitest ^3.0.0` (devDependency)
- No new runtime dependencies

---

## [2.3.0] - 2026-02-01

### ⚡ Network & Performance Checks

#### PW-PERF-001: Missing Network Wait Strategies
- **Severity**: 🟠 MEDIUM
- **Detects**: `page.goto()` calls without explicit `waitUntil` option
- **Why matters**: Relying on Playwright defaults may not match application loading behavior
- **Can cause**: Race conditions and unreliable assertions
- **Recommendation**: Use 'domcontentloaded' or 'load' (avoid 'networkidle' - unreliable). Better: wait for specific API responses or UI elements
- **Pattern detection**:
  - `page.goto('url')` without options
  - `page.goto('url', { timeout: 30000 })` without waitUntil
  - Ignores cases where waitUntil is already specified
- Shows exact line numbers and snippets

#### PW-PERF-002: Hardcoded URLs Detection  
- **Severity**: 🟠 MEDIUM
- **Detects**: Hardcoded URLs (http://, https://) in test files
- **Why matters**: 
  - Difficult to run tests against different environments (dev, staging, prod)
  - Violates DRY principles
  - Makes environment switching cumbersome
- **Pattern detection**:
  - `page.goto('https://...')`
  - URL constants: `const url = 'https://...'`
- Evidence shows all hardcoded URLs found

### 🔗 Performance Correlation Insights

#### PW-INSIGHT-009: Network Timing Masked by Hard Waits
- **Severity**: 🔴 HIGH
- **Triggers**: When both PW-PERF-001 and PW-FLAKE-001 detected
- **Correlation**: Missing `waitUntil` + hard waits (setTimeout/waitForTimeout)
- **Analysis**: Network/loading timing issues masked with arbitrary delays instead of proper strategies
- **Recommendation**: Replace hard waits with specific waits (waitForResponse, waitForSelector) or use 'domcontentloaded'/'load' (avoid 'networkidle')

#### PW-INSIGHT-010: Environment Flexibility Issue
- **Severity**: 🔴 HIGH (>4 workers) or 🟠 MEDIUM
- **Triggers**: When PW-PERF-002 detected AND no baseURL configured
- **Correlation**: Hardcoded URLs + missing baseURL + (optionally) high parallelism
- **Analysis**: Environment management issues, especially critical with high worker counts
- **Recommendation**: Configure baseURL and use relative paths

### 🔧 Technical Improvements

**Enhanced configExtractor**:
- Added `baseURL` extraction from `use` block in playwright.config.ts
- New type field: `use.baseURL?: string`
- Pattern matching: Handles both string literals and expressions

**Rule Patterns**:
- Sophisticated regex for goto() with/without waitUntil
- URL detection patterns for both direct usage and constants
- Excludes cases where waitUntil is properly configured

### 📦 Dependencies & Versioning
- Version bump: 2.2.0 → 2.3.0
- All TypeScript types updated

## [2.2.0] - 2026-02-01

### 🎯 Test Isolation & Organization Checks

#### PW-STABILITY-001: Shared State Detection
- **Severity**: 🔴 HIGH (with retries) or 🟠 MEDIUM (without retries)
- **Detects**: Test files with 3+ tests but no `beforeEach` or `afterEach` hooks
- **Correlation**: Severity escalates to HIGH when retries are enabled
- **Why critical**: Tests share state (cookies, localStorage, page context), causing cascading failures
- **When retries enabled**: State pollution from first attempt affects retry attempts, making failures non-deterministic
- Analyzes actual test file structure, not just pattern matching
- Shows test count and whether beforeAll/afterAll are present (insufficient)

#### PW-STABILITY-002: Test Organization Detection
- **Severity**: 🟠 MEDIUM
- **Detects**: Test files with 10+ tests but zero `test.describe()` blocks
- **Why matters**: 
  - Makes failures harder to categorize in reports
  - Impacts debugging ("which feature failed?")
  - Increases maintenance burden
  - Prevents targeted test execution with --grep
- Provides evidence with exact test count per file

### 🔍 Advanced Code Analysis

**Test File Parsing:**
- New `analyzeTestFile()` function examines test structure
- Counts: `test()`, `test.only()`, `test.describe()`
- Detects: `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
- Supports both Playwright styles: `test.beforeEach()` and `beforeEach()`

**Smart Correlation:**
- STABILITY-001 severity adapts based on retry configuration
- Focuses on files with most tests first (sorted by impact)
- Evidence shows exact issue: "15 tests, no beforeEach/afterEach (has beforeAll/afterAll only)"

### 📝 Documentation Updates

- Added STABILITY-001 and STABILITY-002 to `FINDING_REFERENCE.md`
- Added remediation Pattern 12: Test isolation with hooks (comprehensive before/after example)
- Added remediation Pattern 13: Test organization with describe blocks
- Updated priority rankings
- Added to executive summary action items

### 🎯 Executive Summary Integration

- STABILITY-001 appears in "Top 3 Actions" when high-severity
- Context-aware text: "Add cleanup hooks to 47 test files"
- Risk score increases appropriately for isolation issues

---

## [2.1.0] - 2026-02-01

### 🚨 Critical New Findings

#### CI-009: Retries Enabled but Artifacts Not Published
- **Severity**: 🔴 HIGH
- **Detects**: Retries configured but test-results/traces not published in CI
- **Impact**: When retried tests fail, you have zero debug artifacts
- **Why critical**: This was **in the handoff guide** as a must-have
- Provides actionable guidance on publishing artifacts with `condition: always()`

#### PW-INSIGHT-008: The "Debugging Black Hole"
- **Severity**: 🔴 HIGH (3 gaps) or 🟠 MEDIUM (2 gaps)
- **Detects**: Retries enabled without adequate debugging mechanisms
- **Triggers when 2+ of these are missing**:
  - Trace configuration (trace: 'off' or not set)
  - Video configuration (video: 'off' or not set)
  - CI artifact publishing (test-results not uploaded)
- **Why critical**: Comprehensive detection of retry debugging gaps
- **Correlation**: Explains why flaky tests are invisible until they become blocking

### 📝 Documentation Updates

- Added CI-009 and PW-INSIGHT-008 to `FINDING_REFERENCE.md`
- Added remediation Pattern 10: Publish Test Artifacts (both Azure + GitHub)
- Added remediation Pattern 11: Fix Debugging Black Hole
- Updated priority rankings to include new high-severity findings
- Added to executive summary action items generation

### 🎯 From Handoff Guide

✅ **Completed Task**: "Add CI-007 (Retries enabled but traces not retained/published)"
- Implemented as CI-009 (more accurate naming)
- Plus bonus INSIGHT-008 for comprehensive debugging gap detection

---

## [2.0.0] - 2026-02-01

### 🎯 Major Enhancements

#### Executive Summary & Risk Scoring
- **Added executive summary section** at the top of audit reports with:
  - Risk level scoring (0-100+ scale) with color-coded indicators
  - Findings breakdown by severity (High/Medium/Low counts)
  - Top 3 actionable recommendations prioritized by impact
  - Context-aware action items with specific file names and counts

#### Enhanced Report Formatting
- **Visual indicators** throughout reports:
  - Severity icons: 🔴 High, 🟠 Medium, 🟡 Low
  - Section emojis: 📊 Summary, 🔍 Findings, 💡 Recommendations, 📈 Impact, 🎯 Hotspots, 📋 Evidence
- **Impact metrics** for each finding:
  - Total occurrence count
  - Affected file count
- **Deduplication** of evidence to prevent duplicate entries
- **Professional language**: "occurrences" instead of "hits"

### 🔍 New Findings

#### Configuration Insights
- **PW-INSIGHT-002**: Excessive test timeout detection (>120s)
- **PW-INSIGHT-003**: Missing explicit timeout configuration
- **PW-INSIGHT-004**: Excessive retry count detection (>2 retries)
- **PW-INSIGHT-005**: Missing or disabled trace configuration
- **PW-INSIGHT-006**: Missing or disabled video configuration  
- **PW-INSIGHT-007**: High fixed worker count detection (>8 workers)

#### CI/CD Insights
- **CI-007**: Missing sharding for large test suites (>100 test files)
- **CI-008**: Playwright install without --with-deps flag (Microsoft-hosted agents)

### 🔧 Enhanced CI Detection

- **Sharding detection**: Identifies `--shard=` usage in pipelines
- **Install method detection**: Distinguishes between install methods:
  - `npx playwright install`
  - `npx playwright install --with-deps`
- **Failure handling detection**: Identifies:
  - `continueOnError: true` usage
  - Conditional steps on failure

### 📝 Report Improvements

- Added sharding status to CI Summary section
- Added Playwright install method to CI Summary
- Added failure handling methods to CI Summary  
- Improved evidence presentation with deduplication
- Better section organization and hierarchy

### 🎨 Severity Adjustments

- **PW-LOC-001** (XPath selectors): Downgraded from MEDIUM → LOW
  - Still valuable for maintainability
  - Not a flakiness/reliability blocker
  - Added guidance to focus on frequently-changed files

### 📚 Documentation

- Added `IMPROVEMENTS.md`: Comprehensive improvement summary
- Added `FINDING_REFERENCE.md`: Complete finding reference with remediation patterns
- Included common anti-patterns and solutions
- Added risk score interpretation guide
- Documented typical audit workflow

### 🐛 Bug Fixes

- Fixed evidence deduplication to prevent showing same line multiple times
- Improved error handling for missing CI summary fields
- Enhanced type safety for new CI detection fields

### 💡 Smart Features

- **Context-aware recommendations**: Action items include specific file names and counts
- **Impact-based prioritization**: Findings sorted by severity × occurrence count
- **Intelligent truncation**: Evidence limited based on finding type (CI vs code)
- **Adaptive severity**: CI-005 and CI-007 adjust severity based on context

---

## [1.0.0] - Previous Version

### Initial Features

#### Code Analysis
- **PW-FLAKE-001**: Hard wait detection (waitForTimeout, setTimeout)
- **PW-FLAKE-002**: Force-click detection  
- **PW-LOC-001**: XPath selector detection

#### Configuration Analysis
- **PW-INSIGHT-001**: Masked flakiness detection (retries + hard waits + force clicks)
- Playwright config extraction and summary
- Package.json version detection

#### CI/CD Analysis
- **CI-001**: No CI pipeline detection
- **CI-002**: Missing Playwright HTML report publishing
- **CI-003**: Missing JUnit test result publishing
- **CI-004**: WORKERS environment variable not set
- **CI-005**: No dependency caching
- **CI-006**: Inconsistent WORKERS usage across pipelines
- Azure Pipelines and GitHub Actions detection
- Agent pool type detection (self-hosted vs Microsoft-hosted)

#### Reports
- Markdown audit summary (audit_summary.md)
- JSON findings export (findings.json)
- JSON inventory export (repo_inventory.json)
- Repo inventory section
- Playwright config summary section
- CI summary section
- Top findings section with hotspots

#### CLI
- `repo-audit-agent scan <path>` command
- Output directory configuration
- Error handling and validation

---

## Migration Guide: 1.0 → 2.0

### Breaking Changes
**None** - This is a backward-compatible enhancement release.

### New Fields in CiSummary Type
If you're consuming the JSON output programmatically:

```typescript
// NEW fields in ciSummary
{
  usesSharding: boolean;
  shardingFiles: string[];
  playwrightInstallMethod?: "npx playwright install" | "npx playwright install --with-deps" | "unknown";
  hasFailureHandling: boolean;
  failureHandlingMethods: string[];
}
```

### New Finding IDs
Your automation should handle these new finding IDs:
- PW-INSIGHT-002 through PW-INSIGHT-007
- CI-007, CI-008

### Report Format Changes
- Executive Summary now appears at the top
- Emoji icons in headings
- Impact metrics in findings
- Deduplicated evidence

If you're parsing the markdown output, update your parsers to handle:
- New `## 📊 Executive Summary` section
- Risk score line: `**Risk Level:** 🟠 High (Score: 87)`
- Impact line: `**📈 Impact:** X occurrences across Y files`

### Recommended Actions

1. **Review new findings**: Run audit to see new insights
2. **Check risk scores**: Understand current risk level
3. **Follow top 3 actions**: Executive summary prioritizes work
4. **Update CI configs**: Address new CI-007 and CI-008 if applicable

---

## Upgrade Notes

### For Users
- No action required - just re-run the audit
- New executive summary provides better prioritization
- More actionable recommendations

### For Integrators  
- JSON output has new fields (backward compatible)
- New finding IDs to map in dashboards
- Risk score available for trending

### For Contributors
- New patterns in ciExtractor.ts for detection
- New insight generation in scanner.ts
- Enhanced formatting helpers in report.ts
