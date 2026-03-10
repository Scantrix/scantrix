You are working on Repo Audit Agent (Scantrix), a TypeScript‑based static analysis tool that audits Playwright, Cypress, and Selenium automation repositories and their CI pipelines.

**Version:** 6.3.0

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

## Architecture (v5.0.0)

### Core CLI Modules
- `src/scanner.ts` — Core orchestration, 50+ audit rules across Playwright/Cypress/Selenium, git metadata capture
- `src/cli.ts` — CLI entry point with 2 modes: scan, init; optional JSON result output via `--json-path`
- `src/scanResult.ts` — Canonical `ScanResult` contract (tool, version, runId, timestamps, repo metadata, findings, summary, inventory)
- `src/sinks/types.ts` — `Sink` interface
- `src/sinks/jsonSink.ts` — JSON file sink (zero dependencies)
- `src/sinks/index.ts` — `resolveSinkConfig()` + `buildSinks()` factory (JSON-only)
- `src/report.ts` — Markdown, HTML, JSON, SARIF, email report generation (includes git branch in header)
- `src/configExtractor.ts` — Playwright config parsing
- `src/astConfigParser.ts` — AST-based config parser using TypeScript Compiler API
- `src/ciExtractor.ts` — CI pipeline discovery and behavior extraction
- `src/cypressExtractor.ts` — Cypress project detection and config parsing
- `src/diffTracker.ts` — Trend tracking: snapshots with git metadata + inventory, auto-baseline, evidence-level diffs with path normalization, inventory deltas
- `src/auditConfig.ts` — `.auditrc.json` loading, merging, and default generation
- `src/sarifFormatter.ts` — SARIF 2.1.0 output formatter
- `src/scoring.ts` — Single source of truth for risk score/grade calculation; density-normalized λ scaling based on suite size

### Result Output
Every scan produces a `ScanResult` payload that can be written as a canonical JSON file via `--json-path`:

| Sink | Module | Purpose |
|------|--------|---------|
| JSON | `src/sinks/jsonSink.ts` | Writes results to file (always safe, zero deps) |

Configuration via `--json-path <path>` or `SCANTRIX_JSON_PATH` env var.

### CI Integration
- `action.yml` — GitHub Action (composite) for CI integration
- `.github/workflows/scantrix-example.yml` — Example workflow

### Test Suite
- Vitest test suite across 12 test files
- Fixture repos: bad-repo, good-repo, complex-config-repo, cypress-repo, selenium-repo, deprecated-repo
