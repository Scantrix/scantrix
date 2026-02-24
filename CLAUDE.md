# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scantrix (repo-audit-agent v5.0.0) is a TypeScript static analysis engine that audits Playwright, Cypress, and Selenium test repositories and their CI pipelines. It produces prioritized, executive-grade findings without executing tests. Read-only, runs in minutes.

## Build & Development Commands

```bash
# Root CLI (TypeScript → CommonJS)
npm install
npm run build          # tsc → dist/
npm run audit -- "<repoPath>" --out ./audit-out   # build + scan
npm test               # vitest run (138 tests, 30s timeout)
npm run test:watch     # vitest in watch mode

# Run a single test file
npx vitest run tests/scanner.test.ts

# Dashboard (Next.js 14 + SQLite)
cd dashboard && npm install
npm run dev            # localhost:3000
npm run build          # production build
```

## Architecture

### Data Flow

```
Target Repo → Scanner Engine (50+ rules) → Report Artifacts (md/html/json/sarif/email)
                                         → ScanResult (canonical contract)
                                         → Sink Routing (JSON / SQLite / Hub HTTP POST)
```

### Two Independent Applications

1. **CLI Engine** (`src/`) — TypeScript CommonJS, compiled to `dist/`. Entry point: `src/cli.ts` with three subcommands: `scan` (default), `init`, `push`.
2. **Web Dashboard** (`dashboard/`) — Next.js 14 + SQLite (better-sqlite3) + Tailwind + Recharts + Radix UI. Separate `package.json`, independent install.

### Core Modules (src/)

| Module | Role |
|--------|------|
| `scanner.ts` | Core engine — 50+ audit rules, evidence collection, framework detection |
| `scanResult.ts` | `ScanResult` interface — canonical contract consumed by all sinks |
| `scoring.ts` | Single source of truth for risk score/grade (weighted by finding type) |
| `report.ts` | Generates md, html, json, sarif, email reports |
| `configExtractor.ts` / `astConfigParser.ts` | Playwright config parsing (AST-based via TS Compiler API) |
| `ciExtractor.ts` | CI pipeline YAML discovery and behavior extraction |
| `cypressExtractor.ts` | Cypress project detection |
| `diffTracker.ts` | Trend tracking — auto-snapshots, baselines, evidence-level diffs |
| `auditConfig.ts` | `.auditrc.json` loading, merging, rule disable/override |
| `sinks/` | Pluggable sink system (jsonSink, sqliteSink, hubSink) with fail-fast validation |

### Sink Architecture

Two execution modes controlled by `SCANTRIX_SINK` env var:
- **local** (default): JSON file + optional SQLite → for developer workstations
- **hub**: JSON file + HTTP POST → for CI pipelines feeding a central Postgres-backed dashboard

Hub mode requires `SCANTRIX_INGEST_URL` + `SCANTRIX_TOKEN` — validated before scanning starts.

### Dashboard Structure (dashboard/src/)

- `app/page.tsx` — Main dashboard with risk trend area chart (per-segment coloring logic)
- `app/repos/` — Repository grid with delete, detail pages with `?scan=<id>` for historical views
- `app/api/` — REST routes: repos (GET/DELETE), scans (GET/DELETE), trends, compare
- `lib/db.ts` — SQLite schema (repos, scans, findings, api_keys tables) + query functions
- `components/sidebar.tsx` — Collapsible sidebar (68-240px)

### Risk Scoring (scoring.ts)

Weighted multipliers: `PW-INSIGHT-*` 1.5x, `CI-*` 1.3x, `ARCH-*` 1.2x. Evidence count capped at 3.5x. Grades: A (0-20), B (21-50), C (51-85), D (86-120), F (120+).

## Testing

Tests in `tests/` use Vitest with fixtures in `tests/fixtures/` (bad-repo, good-repo, complex-config-repo, cypress-repo, selenium-repo, deprecated-repo). Key test files mirror core modules: `scanner.test.ts`, `sinks.test.ts`, `frameworks.test.ts`, etc.

## Key Conventions

- `ScanResult` in `scanResult.ts` is the canonical data contract — all sinks receive the same payload
- Scoring logic lives only in `scoring.ts` — do not duplicate grade/score calculations elsewhere
- Finding IDs follow the pattern `PW-FLAKE-001`, `CI-001`, `ARCH-001`, `PW-INSIGHT-001`, etc. (full reference in `FINDING_REFERENCE.md`)
- `audit_summary.md` is the primary product surface — treat report clarity as high priority
- Correlated/insight findings (`PW-INSIGHT-*`) combine multiple signals and are weighted higher than single-pattern findings
- CLI flags take precedence over environment variables

## Documentation

- `docs/CLI_ARCHITECTURE.md` — Complete architecture, modes, setup
- `docs/RULES.md` — Audit rule reference
- `docs/CI_INTEGRATION.md` — GitHub Actions / Azure DevOps examples
- `docs/DEPLOYMENT_GUIDE.md` — Multi-repo hosting, security, API keys
- `FINDING_REFERENCE.md` — All finding IDs and descriptions
- `PROJECT_CONTEXT.md` — Project goals and focus areas
