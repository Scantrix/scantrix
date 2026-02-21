You are working on Repo Audit Agent (Scantrix), a TypeScript‑based static analysis tool that audits Playwright, Cypress, and Selenium automation repositories and their CI pipelines.

**Version:** 4.2.0

Your goals:

Improve report clarity and executive readability

Add high‑signal correlated findings

Avoid noisy or purely stylistic rules

Update the scoring to ensure accuracy

Focus areas:

scanner.ts (derived insights)

ciExtractor.ts (accurate CI behavior detection)

reports.ts (clean, deduplicated, prioritized output)

You should treat audit_summary.md as the primary product surface.

## Architecture (v4.1.0)

### Core CLI Modules
- `src/scanner.ts` — Core orchestration, 50+ audit rules across Playwright/Cypress/Selenium, git metadata capture
- `src/cli.ts` — CLI entry point with 3 modes: scan, init, push
- `src/report.ts` — Markdown, HTML, JSON, SARIF, email report generation (includes git branch in header)
- `src/configExtractor.ts` — Playwright config parsing
- `src/astConfigParser.ts` — AST-based config parser using TypeScript Compiler API
- `src/ciExtractor.ts` — CI pipeline discovery and behavior extraction
- `src/cypressExtractor.ts` — Cypress project detection and config parsing
- `src/diffTracker.ts` — Trend tracking: snapshots with git metadata + inventory, auto-baseline, evidence-level diffs with path normalization, inventory deltas
- `src/auditConfig.ts` — `.auditrc.json` loading, merging, and default generation
- `src/pushClient.ts` — HTTP client for pushing findings to the Scantrix dashboard API
- `src/sarifFormatter.ts` — SARIF 2.1.0 output formatter

### CI Integration
- `action.yml` — GitHub Action (composite) for CI integration
- `.github/workflows/scantrix-example.yml` — Example workflow

### Web Dashboard (`dashboard/`)
- Next.js 14 + SQLite (better-sqlite3)
- `dashboard/src/lib/db.ts` — Database schema + queries (repos, scans, findings, api_keys)
- `dashboard/src/lib/types.ts` — Shared TypeScript types
- `dashboard/src/app/api/` — REST API routes (scans, repos, repos/[name](?scan=id), trends, compare)
- `dashboard/src/app/` — Frontend pages (dashboard, repos, repos/[name] detail, trends, compare)
- `dashboard/src/components/sidebar.tsx` — Collapsible icon-driven sidebar navigation
- Repo detail page (`/repos/[name]`) — Overview cards, repository statistics (with git branch/commit), severity breakdown, priority files, recommended actions, collapsible findings table, configuration overview, scan history (dates link to `?scan=<id>` for historical report). Supports `?scan=<id>` query param to view any historical scan with the full report layout.
- Inventory pipeline: `push` sends `repo_inventory.json` data through to `summary_json` column for rendering on detail page

### Risk Trend Chart — Dashboard (`dashboard/src/app/page.tsx`)

The "Risk Trend" card on the main dashboard displays a mini area chart of the portfolio's
average risk score over time (up to the last 24 data points from `/api/trends`).

**Data source:**
- The `/api/trends` aggregate endpoint (`dashboard/src/app/api/trends/route.ts`) uses a
  **rolling portfolio state** — it processes all scans chronologically, maintains each repo's
  latest known score in a `Map`, and outputs the portfolio-wide average at each scan date.
  Re-scanning one repo does not distort the aggregate; all other repos keep their last-known
  score in the calculation.

**Per-segment coloring:**
- Each segment between consecutive data points is independently colored based on direction:
  - **Green** (`hsl(152 76% 45%)`) — score decreased (improving)
  - **Red** (`hsl(0 84% 60%)`) — score increased (declining)
  - **Blue** (`hsl(224 90% 63%)`) — score unchanged (flat)
- Two horizontal `<linearGradient>` elements map stop percentages to segment boundaries:
  - `riskStrokeGrad` — fully opaque colors for the `<Area>` stroke
  - `riskFillGrad` — same colors at 30% opacity for the `<Area>` fill
- When a new scan increases the score, **only the latest segment turns red** — earlier
  segments that were improving remain green.

**Trend indicator badge:**
- The status badge (Improving / Declining / Stable) and its icon reflect the
  **most recent segment's** direction (`latestSegmentDir`), comparing the last two data
  points. This tells the user what just happened, not a summary of all history.

**Key variables (in `page.tsx`):**
| Variable | Purpose |
|---|---|
| `trendChartData` | Last 24 `{ date, score }` objects from `/api/trends` |
| `trendScores` | Array of just the score values |
| `segmentStops` | `{ offset, color }[]` — gradient stop pairs for each segment |
| `latestSegmentDir` | `"improving"` / `"declining"` / `"flat"` based on last two scores |
| `TREND_GREEN/RED/BLUE` | HSL color constants |

### Test Suite
- 113 tests across 10 test files (vitest 3.2.4)
- Fixture repos: bad-repo, good-repo, complex-config-repo, cypress-repo, selenium-repo, deprecated-repo

First review the repo_audit_agent_project_overview_handoff_guide.md