# Scantrix CLI — Architecture Overview & Setup Guide

This document provides a complete overview of the Scantrix CLI architecture, explains
what it does and how it works, and gives step-by-step instructions for setting it up
in every supported environment.

---

## Table of Contents

1. [What Is Scantrix?](#what-is-scantrix)
2. [How It Works](#how-it-works)
3. [Architecture Overview](#architecture-overview)
4. [The ScanResult Contract](#the-scanresult-contract)
5. [Sink System](#sink-system)
6. [Environment Modes](#environment-modes)
7. [Getting Started — Local Mode](#getting-started--local-mode)
8. [Getting Started — Hub Mode (CI Pipelines)](#getting-started--hub-mode-ci-pipelines)
9. [Configuration Reference](#configuration-reference)
10. [Frequently Asked Questions](#frequently-asked-questions)

---

## What Is Scantrix?

Scantrix is a **static analysis and configuration-aware auditing engine** for test
automation repositories. It scans:

- **Test code** — Playwright, Cypress, and Selenium projects
- **Framework configuration** — `playwright.config.ts`, `cypress.config.js`, etc.
- **CI pipelines** — GitHub Actions, Azure DevOps YAML

It produces **actionable, prioritized findings** with risk scores, severity grades, and
concrete recommendations — without ever executing your tests.

### What It Does NOT Do

- It does **not** run your tests
- It does **not** modify your code
- It does **not** connect directly to any database
- It does **not** send data to external services (unless you configure Hub mode)

---

## How It Works

```
┌──────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────────┐
│  Repository  │────►│  Scanner   │────►│  ScanResult  │────►│    Sinks     │
│  (on disk)   │     │  Engine    │     │  (canonical)  │     │  (routing)   │
└──────────────┘     └────────────┘     └──────────────┘     └──────────────┘
                           │                                    │    │    │
                    ┌──────┴──────┐                     ┌───────┘    │    └────────┐
                    │  50+ Rules  │                     ▼            ▼             ▼
                    │  3 Frameworks│               JSON File    SQLite DB     Hub API
                    │  CI Analysis │               (always)     (local)      (pipeline)
                    └─────────────┘
```

1. **Input** — Point the CLI at a repository directory on disk
2. **Scan** — The engine runs 50+ rules across code, config, and CI pipelines
3. **Result** — A canonical `ScanResult` JSON object is produced
4. **Routing** — The result is sent to one or more **sinks** based on your configuration

---

## Architecture Overview

### Module Map

```
src/
├── cli.ts              # CLI entry point — args, subcommands, sink routing
├── scanner.ts          # Core scan engine — 50+ audit rules, framework detection
├── scanResult.ts       # ScanResult contract — canonical output shape
├── scoring.ts          # Risk score / grade calculation (single source of truth)
├── report.ts           # Report generation (Markdown, HTML, JSON, SARIF, email)
├── configExtractor.ts  # Playwright config parsing
├── astConfigParser.ts  # AST-based config parser (TypeScript Compiler API)
├── ciExtractor.ts      # CI pipeline discovery and behavior extraction
├── cypressExtractor.ts # Cypress project detection and config parsing
├── diffTracker.ts      # Trend tracking — snapshots, baselines, diffs
├── auditConfig.ts      # .auditrc.json loading and merging
├── pushClient.ts       # Legacy push subcommand — HTTP client for dashboard API
├── sarifFormatter.ts   # SARIF 2.1.0 output formatter
└── sinks/
    ├── types.ts        # Sink interface
    ├── index.ts        # Config resolver + sink factory
    ├── jsonSink.ts     # JSON file sink
    ├── sqliteSink.ts   # SQLite sink (optional better-sqlite3)
    └── hubSink.ts      # Hub HTTP POST sink
```

### Execution Flow

```
CLI Start
  │
  ├─ Parse arguments (minimist)
  ├─ Route to subcommand: init | push | scan
  │
  └─ [scan]
       ├── 1. Validate sink configuration (fail-fast)
       ├── 2. Load .auditrc.json (if present)
       ├── 3. Resolve baseline for trend tracking
       ├── 4. Record startedAt timestamp
       ├── 5. Run scanRepo() → ScanResults
       ├── 6. Write report artifacts (MD, HTML, JSON, SARIF, email)
       ├── 7. Save snapshot for trend tracking
       ├── 8. Print console trend summary
       ├── 9. Build canonical ScanResult
       └── 10. Route ScanResult to configured sinks
```

Key design principle: **sink configuration is validated before the scan starts**. If
hub mode is configured without a token, the CLI exits immediately with a clear error
message — never wasting time on a scan that can't be delivered.

---

## The ScanResult Contract

Every scan produces exactly one `ScanResult` object. This is the **canonical artifact**
that all sinks consume. Its shape is stable and versioned.

```json
{
  "tool": "scantrix",
  "version": "5.0.0",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "startedAt": "2026-02-21T14:30:00.000Z",
  "completedAt": "2026-02-21T14:30:12.345Z",
  "repo": {
    "path": "/repos/my-automation",
    "name": "my-automation",
    "branch": "main",
    "commit": "abc1234"
  },
  "findings": [
    {
      "findingId": "PW-FLAKE-001",
      "severity": "high",
      "title": "Hard waits detected (waitForTimeout / setTimeout)",
      "description": "...",
      "recommendation": "...",
      "evidence": [
        { "file": "tests/login.spec.ts", "line": 42, "snippet": "await page.waitForTimeout(3000);" }
      ]
    }
  ],
  "summary": {
    "total": 12,
    "high": 3,
    "medium": 5,
    "low": 4,
    "riskScore": 67,
    "riskGrade": "C"
  },
  "inventory": {
    "totalFiles": 340,
    "testFiles": 87,
    "hasPlaywrightConfig": true,
    "playwrightVersion": "1.40.0",
    "detectedFrameworks": ["playwright"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Always `"scantrix"` |
| `version` | string | CLI version that produced the result |
| `runId` | string | UUID v4 — unique per scan run |
| `startedAt` | string | ISO-8601 timestamp when scan began |
| `completedAt` | string | ISO-8601 timestamp when scan finished |
| `repo` | object | Repository path, name, git branch, and commit SHA |
| `findings` | array | Full list of findings with evidence |
| `summary` | object | Aggregate counts and risk assessment |
| `inventory` | object | Repository file structure and config snapshot |

---

## Sink System

A **sink** is a destination for the `ScanResult`. The CLI routes results to one or more
sinks based on the configured mode.

### Available Sinks

| Sink | Description | Dependencies |
|------|-------------|-------------|
| **JSON** | Writes `ScanResult` as a pretty-printed JSON file | None (Node.js built-in `fs`) |
| **SQLite** | Persists to a local SQLite database | `better-sqlite3` (optional, dynamically loaded) |
| **Hub** | POSTs `ScanResult` via HTTP to a central ingestion API | None (Node.js built-in `http/https`) |

### Sink Selection

Sinks are activated based on the **mode** and **which paths/URLs are provided**:

| Mode | JSON Sink | SQLite Sink | Hub Sink |
|------|-----------|-------------|----------|
| `local` | ✅ when `SCANTRIX_JSON_PATH` set | ✅ when `SCANTRIX_SQLITE_PATH` set | ❌ |
| `hub` | ✅ when `SCANTRIX_JSON_PATH` set | ❌ | ✅ always |

### Why This Architecture?

The previous approach required a separate `push` subcommand after the scan. This created
failure modes where scans completed but pushes failed (or were forgotten). The sink
architecture integrates result delivery directly into the scan flow:

- **Atomic** — scan + delivery in a single CLI invocation
- **Fail-fast** — misconfiguration caught before the scan starts
- **Extensible** — adding a new sink is a single class implementing the `Sink` interface
- **Decoupled** — the CLI never touches Postgres; the Hub service owns the database

---

## Environment Modes

### Local Mode (Developer Workstation)

```
┌───────────────┐     ┌──────────┐     ┌──────────────────┐
│  Repository   │────►│  CLI     │────►│  scantrix-       │
│  (on disk)    │     │  Scanner │     │  results.json    │
└───────────────┘     └──────────┘     └──────────────────┘
                           │
                           └────────►  ┌──────────────────┐
                                       │  scantrix.db     │
                                       │  (local SQLite)  │
                                       └──────────────────┘
                                              │
                                       ┌──────┴──────────┐
                                       │  Local Dashboard │
                                       │  (Next.js +     │
                                       │   SQLite)        │
                                       └─────────────────┘
```

**Use when:** Running scans on your own machine for development, testing, or evaluation.

- Results are written to a JSON file and optionally to a local SQLite DB
- The local Next.js dashboard reads from the same SQLite DB
- No network calls, no external services
- Everything runs on a single machine

### Hub Mode (CI Pipelines → Shared Dashboard)

```
┌─────────────────────┐
│  Pipeline A (CI)    │──scan──►  ScanResult  ──POST──┐
└─────────────────────┘                               │
┌─────────────────────┐                               │   ┌───────────────────┐
│  Pipeline B (CI)    │──scan──►  ScanResult  ──POST──┼──►│  Hub Ingestion    │
└─────────────────────┘                               │   │  API              │
┌─────────────────────┐                               │   └────────┬──────────┘
│  Pipeline C (CI)    │──scan──►  ScanResult  ──POST──┘            │
└─────────────────────┘                                    ┌───────▼──────────┐
                                                           │  PostgreSQL      │
                                                           │  (shared)        │
                                                           └───────┬──────────┘
                                                           ┌───────▼──────────┐
                                                           │  Dashboard       │
                                                           │  (reads Postgres)│
                                                           └──────────────────┘
```

**Use when:** Multiple repositories or pipelines need to feed results into a single
shared dashboard.

- Each pipeline runs the CLI with `--sink hub`
- The CLI POSTs the `ScanResult` to the Hub ingestion API
- The Hub writes to Postgres (the CLI never touches Postgres directly)
- The shared dashboard reads from Postgres
- No SQLite involved — SQLite is not suitable for distributed access

### Why the CLI Doesn't Connect to Postgres Directly

| Concern | CLI → Postgres (rejected) | CLI → Hub → Postgres (chosen) |
|---------|---------------------------|-------------------------------|
| **Credentials** | Every pipeline needs DB credentials | Pipelines use a Bearer token |
| **Network** | Postgres port exposed to all CI runners | Only the Hub API endpoint is exposed |
| **Schema** | CLI must know the schema | Hub owns the schema |
| **Auth/tenancy** | CLI must handle multi-tenant logic | Hub handles isolation |
| **Retries/errors** | CLI must handle DB connection failures | Hub handles retries, queuing |
| **Upgrades** | Schema changes require CLI updates | Schema changes are Hub-internal |

---

## Getting Started — Local Mode

### Prerequisites

- Node.js 18+
- A repository to scan (Playwright, Cypress, or Selenium project)

### Step 1: Install Scantrix

```bash
# Clone and build
git clone https://your-org/repo-audit-agent.git
cd repo-audit-agent
npm ci
npm run build
```

### Step 2: Run Your First Scan

```bash
node dist/cli.js /path/to/your/repo --out ./audit-out
```

This produces report files in `./audit-out/`:

| File | Format | Description |
|------|--------|-------------|
| `audit_summary.md` | Markdown | Full human-readable report |
| `audit_summary.html` | HTML | Styled report for browsers |
| `findings.json` | JSON | Machine-readable findings |
| `repo_inventory.json` | JSON | Repository metadata |
| `audit.sarif` | SARIF | For GitHub Code Scanning / Azure DevOps |
| `audit_email.html` | HTML | Email-safe version of the report |

### Step 3: Add a Results JSON Artifact

Use `--json-path` to also write the canonical `ScanResult` JSON:

```bash
node dist/cli.js /path/to/your/repo \
  --out ./audit-out \
  --json-path ./audit-out/scantrix-results.json
```

This writes the full `ScanResult` (with runId, timestamps, summary, etc.) to the
specified path — useful for archival, downstream automation, or manual inspection.

### Step 4: Enable Local SQLite Persistence (Optional)

To feed the local Next.js dashboard with scan data:

```bash
node dist/cli.js /path/to/your/repo \
  --out ./audit-out \
  --json-path ./audit-out/scantrix-results.json \
  --sqlite-path ./dashboard/data/scantrix.db
```

Then start the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Open http://localhost:3000 to see your scan results, trends, and repo comparisons.

### Step 5: Customize Scan Behavior (Optional)

Create a `.auditrc.json` in the target repository:

```bash
node dist/cli.js init /path/to/your/repo
```

Edit the generated file to disable rules, override severities, or exclude directories:

```json
{
  "rules": {
    "disabled": ["PW-LOC-001"],
    "severityOverrides": {
      "PW-FLAKE-001": "medium"
    }
  },
  "exclude": ["**/generated/**"],
  "thresholds": {
    "gradeA": 20,
    "gradeB": 50,
    "gradeC": 85
  }
}
```

---

## Getting Started — Hub Mode (CI Pipelines)

### Prerequisites

- Node.js 18+ on the CI runner
- A Hub ingestion API running and accepting POST requests
- A Bearer token for authentication

### Step 1: Set Environment Variables

Set these as CI secrets (GitHub Actions Secrets, Azure DevOps Variable Groups, etc.):

| Variable | Example | Required |
|----------|---------|----------|
| `SCANTRIX_SINK` | `hub` | Yes |
| `SCANTRIX_INGEST_URL` | `https://hub.example.com/api/ingest` | Yes |
| `SCANTRIX_TOKEN` | `sxt_abc123...` | Yes |
| `SCANTRIX_JSON_PATH` | `./audit-out/scantrix-results.json` | Recommended |

### Step 2: Add to Your CI Pipeline

#### GitHub Actions

```yaml
name: Automation Audit
on:
  push:
    branches: [main]
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Scantrix
        run: npm install -g scantrix

      - name: Run Audit (Hub Mode)
        env:
          SCANTRIX_SINK: hub
          SCANTRIX_INGEST_URL: ${{ secrets.SCANTRIX_INGEST_URL }}
          SCANTRIX_TOKEN: ${{ secrets.SCANTRIX_TOKEN }}
          SCANTRIX_JSON_PATH: ./audit-out/scantrix-results.json
        run: |
          scantrix . --out ./audit-out --format json,html,sarif --no-trend

      - name: Upload Report Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: scantrix-audit-report
          path: ./audit-out/
```

#### Azure DevOps

```yaml
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'

  - script: npm install -g scantrix
    displayName: 'Install Scantrix'

  - script: |
      scantrix "$(Build.SourcesDirectory)" \
        --out "$(Build.ArtifactStagingDirectory)/audit" \
        --format json,html,sarif \
        --no-trend
    displayName: 'Run Scantrix Audit (Hub Mode)'
    env:
      SCANTRIX_SINK: hub
      SCANTRIX_INGEST_URL: $(SCANTRIX_INGEST_URL)
      SCANTRIX_TOKEN: $(SCANTRIX_TOKEN)
      SCANTRIX_JSON_PATH: $(Build.ArtifactStagingDirectory)/audit/scantrix-results.json

  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: '$(Build.ArtifactStagingDirectory)/audit'
      artifact: 'scantrix-audit-report'
```

### Step 3: Verify Delivery

After the pipeline runs:

1. Check the CI log for `[sink:hub] Results written successfully.`
2. Open your shared dashboard and confirm the repo appears with the latest scan
3. Check the pipeline artifact for the `scantrix-results.json` file

### What Happens If the Hub Is Unreachable?

The CLI will:
1. Complete the scan successfully
2. Write all report artifacts (MD, HTML, SARIF, etc.)
3. Write the JSON artifact (if `SCANTRIX_JSON_PATH` is set)
4. Fail on the Hub sink with a clear error message and exit code 1

The JSON artifact serves as a durable fallback — you can re-submit it later or
inspect results manually.

---

## Configuration Reference

### CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `<repoPath>` | Path to the repository to scan | Required |
| `--out <dir>` | Output directory for report artifacts | `./audit-out` |
| `--format <list>` | Output formats: `md,html,json,sarif,email` | All formats |
| `--updates` | Check for outdated npm dependencies | `false` |
| `--config <path>` | Path to `.auditrc.json` | Auto-detected in repo root |
| `--diff <path>` | Baseline `findings.json` for trend diff | Auto-detected |
| `--no-trend` | Disable local snapshot saving | `false` |
| `--sink local\|hub` | Sink mode | `local` |
| `--json-path <path>` | Path for canonical `ScanResult` JSON | None |
| `--sqlite-path <path>` | Path for local SQLite DB (local mode only) | None |
| `--ingest-url <url>` | Hub ingestion endpoint (hub mode only) | None |
| `--token <tok>` | Bearer token for Hub auth (hub mode only) | None |

### Environment Variables

| Variable | Description | CLI Equivalent |
|----------|-------------|----------------|
| `SCANTRIX_SINK` | `local` (default) or `hub` | `--sink` |
| `SCANTRIX_JSON_PATH` | Canonical results JSON path | `--json-path` |
| `SCANTRIX_SQLITE_PATH` | Local SQLite DB path | `--sqlite-path` |
| `SCANTRIX_INGEST_URL` | Hub ingestion URL | `--ingest-url` |
| `SCANTRIX_TOKEN` | Hub Bearer token | `--token` |

CLI flags take precedence over environment variables.

### Subcommands

| Command | Description |
|---------|-------------|
| `scantrix <repoPath>` | Run a scan (default) |
| `scantrix init [dir]` | Create a starter `.auditrc.json` |
| `scantrix push [findings.json]` | Push findings to dashboard (legacy) |

---

## Frequently Asked Questions

**Q: Do I need `better-sqlite3` installed?**
Only if you use `--sqlite-path` (local mode with SQLite persistence). The package is
loaded dynamically — the CLI works fine without it for JSON-only or hub mode.

**Q: What's the difference between `push` and `--sink hub`?**
The `push` subcommand is the original approach: scan first, then run a separate
`scantrix push` command. The `--sink hub` approach integrates delivery into the scan
itself — one command, atomic execution, fail-fast validation.

**Q: Can I use both JSON and SQLite sinks at the same time?**
Yes. In local mode, set both `SCANTRIX_JSON_PATH` and `SCANTRIX_SQLITE_PATH`. Both
sinks will receive the same `ScanResult`.

**Q: What happens if I set `--sink hub` without `--ingest-url`?**
The CLI exits immediately with an error message before the scan starts. This is
intentional — fail-fast prevents wasted scan time.

**Q: Can I add a custom sink?**
Yes. Implement the `Sink` interface from `src/sinks/types.ts` and add it to the
`buildSinks()` factory in `src/sinks/index.ts`.

**Q: Does the CLI ever connect to Postgres?**
No. In hub mode, the CLI sends an HTTP POST to the Hub ingestion API. The Hub service
owns the Postgres connection, schema, and write logic.

**Q: What version of Node.js do I need?**
Node.js 18 or later.

**Q: How do I view results locally without a database?**
Open `audit-out/audit_summary.html` in a browser, or read `audit-out/audit_summary.md`
in any Markdown viewer.

**Q: Is the ScanResult schema stable?**
Yes. The `ScanResult` interface is versioned and designed for backward compatibility.
New fields may be added, but existing fields will not be renamed or removed without a
major version bump.
