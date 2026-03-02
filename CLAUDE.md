# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scantrix (repo-audit-agent v6.3.0) is a TypeScript static analysis engine that audits Playwright, Cypress, and Selenium test repositories and CI pipelines. It produces prioritized, executive-grade findings without executing tests. Read-only; runs in minutes.

**CLI Engine** (`src/`) — TypeScript CommonJS compiled to `dist/`. Entry: `src/cli.ts` (subcommands: `scan` default, `init`).

## Build & Development Commands

```bash
npm install
npm run build                      # tsc → dist/
npm run audit -- "<repoPath>" --out ./audit-out   # build + scan
npm test                           # vitest run
npm run test:watch                 # vitest in watch mode
npx vitest run tests/scanner.test.ts
```

## Architecture (CLI)

### Data Flow

```
Target Repo → Scanner Engine (50+ rules) → Report Artifacts (md/html/json/sarif/email)
                                         → ScanResult (canonical JSON)
```

### Core Modules (src/)

| Module | Role |
|--------|------|
| `scanner.ts` | Core engine — rules, evidence collection, framework detection |
| `scanResult.ts` | Canonical `ScanResult` contract |
| `scoring.ts` | Single source of truth for score/grade (do not duplicate) |
| `report.ts` | Generates md, html, json, sarif, email reports |
| `configExtractor.ts` / `astConfigParser.ts` | Playwright config parsing (TS Compiler API) |
| `ciExtractor.ts` | CI YAML discovery + behavior extraction |
| `cypressExtractor.ts` | Cypress detection |
| `diffTracker.ts` | Trend tracking (snapshots/baselines/diffs) |
| `auditConfig.ts` | `.auditrc.json` load/merge + rule overrides |
| `sinks/` | JSON sink for canonical result output |

### Risk Scoring (scoring.ts)

Weighted multipliers: `PW-INSIGHT-*` 1.5x, `CI-*` 1.3x, `ARCH-*` 1.2x.
Evidence scaling: `N^0.6` power curve — sensitive across the full range; every occurrence fix moves the score.
Health score (0–100, higher = better): `round(100 × exp(-riskPoints / λ))`.
Grades: A (≥80), B (≥60), C (≥40), D (≥25), F (<25).

**Density normalization:** When inventory is available, λ scales with suite size:
`λ = 200 × clamp(1.0 + 0.3 × log₂(testFiles / 50), 1.0, 4.0)`.
≤50 files → no adjustment; 100 → 1.3×; 200 → 1.6×; 500 → 2.0×; 1,000 → 2.3×.

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
- `FINDING_REFERENCE.md`
- `PROJECT_CONTEXT.md`

## Implementation Constitution

You are a senior engineer. Implement requested features end-to-end: correct, maintainable, minimal blast radius. No shortcuts.

### Feature Brief (fill in when implementing)

- Name / Goal / Success criteria
- In scope / Out of scope
- Roles/permissions (if any)
- Analytics/telemetry events (if any)

### Engineering Standards

- **Safety**: validate untrusted inputs at boundaries.
- **Performance**: avoid N+1.

### Workflow

1. State assumptions (don't stall).
2. Plan briefly: modules, API contracts+types, data flow/state.
3. Implement with minimal refactors; no new deps unless justified.
4. Type-safe: no `any`, no `@ts-ignore`, no unsafe casts.
5. Tests: add meaningful, stable tests.

### Deliverables

- User-visible summary
- Files changed/added
- Key decisions/tradeoffs
- Risks/edge cases/follow-ups
- Update `CHANGELOG`, `PROJECT_CONTEXT.md`, and relevant docs

### Prohibited

- Disabling lint/types/tests without written justification
- Timeouts/sleeps as "fixes"
- Swallowing errors with broad `try/catch`
