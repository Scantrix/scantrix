# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scantrix (repo-audit-agent v5.1.0) is a TypeScript static analysis engine that audits Playwright, Cypress, and Selenium test repositories and CI pipelines. It produces prioritized, executive-grade findings without executing tests. Read-only; runs in minutes.

This repo contains two independent apps:
1. **CLI Engine** (`src/`) — TypeScript CommonJS compiled to `dist/`. Entry: `src/cli.ts` (subcommands: `scan` default, `init`, `push`).
2. **Web Dashboard** (`dashboard/`) — Next.js 14 + SQLite (better-sqlite3) + Tailwind + Recharts + Radix UI. Separate `package.json`.

## Build & Development Commands

```bash
# Root CLI (TypeScript → CommonJS)
npm install
npm run build                      # tsc → dist/
npm run audit -- "<repoPath>" --out ./audit-out   # build + scan
npm test                           # vitest run (138 tests, 30s timeout)
npm run test:watch                 # vitest in watch mode
npx vitest run tests/scanner.test.ts

# Dashboard (Next.js 14 + SQLite)
cd dashboard && npm install
npm run dev                        # localhost:3000
npm run build                      # production build
```

## Architecture (CLI)

### Data Flow

```
Target Repo → Scanner Engine (50+ rules) → Report Artifacts (md/html/json/sarif/email)
                                         → ScanResult (canonical contract)
                                         → Sink Routing (JSON / SQLite / Hub HTTP POST)
```

### Core Modules (src/)

| Module | Role |
|--------|------|
| `scanner.ts` | Core engine — rules, evidence collection, framework detection |
| `scanResult.ts` | Canonical `ScanResult` contract — all sinks consume the same payload |
| `scoring.ts` | Single source of truth for score/grade (do not duplicate) |
| `report.ts` | Generates md, html, json, sarif, email reports |
| `configExtractor.ts` / `astConfigParser.ts` | Playwright config parsing (TS Compiler API) |
| `ciExtractor.ts` | CI YAML discovery + behavior extraction |
| `cypressExtractor.ts` | Cypress detection |
| `diffTracker.ts` | Trend tracking (snapshots/baselines/diffs) |
| `auditConfig.ts` | `.auditrc.json` load/merge + rule overrides |
| `sinks/` | json/sqlite/hub sinks with fail-fast validation |

### Sink Modes

Controlled by `SCANTRIX_SINK` env var:

- **local** (default): JSON + optional SQLite — for developer workstations
- **hub**: JSON + HTTP POST — for CI pipelines feeding a central Postgres-backed dashboard

Hub mode requires `SCANTRIX_INGEST_URL` + `SCANTRIX_TOKEN` — validated before scanning starts.

### Risk Scoring (scoring.ts)

Weighted multipliers: `PW-INSIGHT-*` 1.5x, `CI-*` 1.3x, `ARCH-*` 1.2x. Evidence count capped at 3.5x.
Grades: A (0–20), B (21–50), C (51–85), D (86–120), F (120+).

### Dashboard Structure (dashboard/src/)

- `app/page.tsx` — Main dashboard + trend chart
- `app/repos/` — Repo grid + details (`?scan=<id>` for historical views)
- `app/api/` — REST routes (repos/scans/trends/compare)
- `lib/db.ts` — SQLite schema + queries (repos, scans, findings, api_keys)
- `components/sidebar.tsx` — Collapsible sidebar

## Testing

Vitest tests live in `tests/` with fixtures in `tests/fixtures/` (bad-repo, good-repo, complex-config-repo, cypress-repo, selenium-repo, deprecated-repo).

## Key Conventions

- `ScanResult` is the canonical contract; sinks must not diverge payload shape.
- Scoring logic lives only in `scoring.ts` — do not duplicate grade/score calculations elsewhere.
- Finding IDs follow `PW-FLAKE-001`, `CI-001`, `ARCH-001`, `PW-INSIGHT-001`, etc. (see `FINDING_REFERENCE.md`).
- `audit_summary.md` is the primary product surface; report clarity is a top priority.
- CLI flags take precedence over environment variables.

## Documentation

- `docs/CLI_ARCHITECTURE.md`
- `docs/RULES.md`
- `docs/CI_INTEGRATION.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `FINDING_REFERENCE.md`
- `PROJECT_CONTEXT.md`

## Implementation Constitution

> Applies to all work; DB rules mainly apply to dashboard/hub.

You are a senior engineer. Implement requested features end-to-end: correct, maintainable, minimal blast radius. No shortcuts.

### Feature Brief (fill in when implementing)

- Name / Goal / Success criteria
- In scope / Out of scope
- Screens/routes impacted (if dashboard)
- Roles/permissions (if any)
- Analytics/telemetry events (if any)

### Engineering Standards

- **Concurrency**: assume parallel requests; avoid long transactions and write locks.
- **Schema changes**: always via migrations (no runtime auto-create hacks).
- **Integrity**: use constraints (NOT NULL/UNIQUE/FK where appropriate); transactions for multi-step writes (keep short).
- **Safety**: parameterize SQL; validate untrusted inputs at boundaries.
- **Performance**: add indexes for new query patterns; avoid N+1.

### Workflow

1. State assumptions (don't stall).
2. Plan briefly: modules, schema+migrations, API contracts+types, data flow/state, UX states, SSR/CSR risks (if applicable).
3. Implement with minimal refactors; no new deps unless justified.
4. Type-safe: no `any`, no `@ts-ignore`, no unsafe casts. Keep secrets server-side.
5. DB access server-side only; handle UNIQUE conflicts deterministically.
6. UX: loading/error/empty states + basic accessibility (if UI).
7. Tests: add meaningful, stable tests.

### Deliverables

- User-visible summary
- Files changed/added
- Migrations + purpose (if applicable)
- Key decisions/tradeoffs
- Risks/edge cases/follow-ups
- Update `CHANGELOG`, `PROJECT_CONTEXT.md`, and relevant docs

### Prohibited

- Disabling lint/types/tests without written justification
- Timeouts/sleeps as "fixes"
- Swallowing errors with broad `try/catch`
- Unparameterized SQL / unsafe interpolation
- Client-side DB access
- Runtime schema auto-create in app code