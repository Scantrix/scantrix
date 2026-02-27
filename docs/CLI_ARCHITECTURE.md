# Scantrix CLI — Architecture Overview & Setup Guide

This document provides a complete overview of the Scantrix CLI architecture, explains
what it does and how it works, and gives step-by-step instructions for setting it up.

---

## Table of Contents

1. [What Is Scantrix?](#what-is-scantrix)
2. [How It Works](#how-it-works)
3. [Architecture Overview](#architecture-overview)
4. [The ScanResult Contract](#the-scanresult-contract)
5. [Getting Started](#getting-started)
6. [Configuration Reference](#configuration-reference)
7. [Frequently Asked Questions](#frequently-asked-questions)

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
- It does **not** connect to any database or external service

---

## How It Works

```
┌──────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────────┐
│  Repository  │────►│  Scanner   │────►│  ScanResult  │────►│  JSON File   │
│  (on disk)   │     │  Engine    │     │  (canonical)  │     │  (optional)  │
└──────────────┘     └────────────┘     └──────────────┘     └──────────────┘
                           │
                    ┌──────┴──────┐
                    │  50+ Rules  │
                    │  3 Frameworks│
                    │  CI Analysis │
                    └─────────────┘
```

1. **Input** — Point the CLI at a repository directory on disk
2. **Scan** — The engine runs 50+ rules across code, config, and CI pipelines
3. **Report** — Report artifacts are written (MD, HTML, JSON, SARIF, email)
4. **Result** — Optionally, a canonical `ScanResult` JSON file is written via `--json-path`

---

## Architecture Overview

### Module Map

```
src/
├── cli.ts              # CLI entry point — args, subcommands
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
├── sarifFormatter.ts   # SARIF 2.1.0 output formatter
└── sinks/
    ├── types.ts        # Sink interface
    ├── index.ts        # Config resolver + sink factory
    └── jsonSink.ts     # JSON file sink
```

### Execution Flow

```
CLI Start
  │
  ├─ Parse arguments (minimist)
  ├─ Route to subcommand: init | scan
  │
  └─ [scan]
       ├── 1. Load .auditrc.json (if present)
       ├── 2. Resolve baseline for trend tracking
       ├── 3. Record startedAt timestamp
       ├── 4. Run scanRepo() → ScanResults
       ├── 5. Write report artifacts (MD, HTML, JSON, SARIF, email)
       ├── 6. Save snapshot for trend tracking
       ├── 7. Print console trend summary
       └── 8. Write canonical ScanResult JSON (if --json-path set)
```

---

## The ScanResult Contract

Every scan can produce a `ScanResult` object. This is the **canonical artifact**
written via `--json-path`. Its shape is stable and versioned.

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

## Getting Started

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

### Step 4: Customize Scan Behavior (Optional)

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
    "gradeA": 80,
    "gradeB": 60,
    "gradeC": 40
  }
}
```

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
| `--json-path <path>` | Path for canonical `ScanResult` JSON | None |

### Environment Variables

| Variable | Description | CLI Equivalent |
|----------|-------------|----------------|
| `SCANTRIX_JSON_PATH` | Canonical results JSON path | `--json-path` |

CLI flags take precedence over environment variables.

### Subcommands

| Command | Description |
|---------|-------------|
| `scantrix <repoPath>` | Run a scan (default) |
| `scantrix init [dir]` | Create a starter `.auditrc.json` |

---

## Frequently Asked Questions

**Q: Can I add a custom sink?**
Yes. Implement the `Sink` interface from `src/sinks/types.ts` and add it to the
`buildSinks()` factory in `src/sinks/index.ts`.

**Q: What version of Node.js do I need?**
Node.js 18 or later.

**Q: How do I view results locally?**
Open `audit-out/audit_summary.html` in a browser, or read `audit-out/audit_summary.md`
in any Markdown viewer.

**Q: Is the ScanResult schema stable?**
Yes. The `ScanResult` interface is versioned and designed for backward compatibility.
New fields may be added, but existing fields will not be renamed or removed without a
major version bump.
