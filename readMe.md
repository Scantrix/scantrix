<p align="center">
  <img src="docs/scantrix-logo-light.svg" alt="Scantrix" width="420" />
</p>

<h3 align="center">Static analysis for Playwright, Cypress, and Selenium test repositories</h3>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#output-formats">Output</a> &middot;
  <a href="#cli-reference">CLI Reference</a> &middot;
  <a href="#github-action">GitHub Action</a> &middot;
  <a href="docs/RULES.md">Rules</a> &middot;
  <a href="#license">License</a>
</p>

---

Scantrix performs rule‑driven and pattern‑driven static analysis across test code, configuration files, repositories, and CI pipeline definitions. It provides clear visibility into the health and maintainability of automation frameworks, offering actionable insights that reduce flakiness, improve consistency, and enforce standards across Playwright, Cypress, and Selenium projects.

## What it does

- Detects flaky patterns (hard waits, force clicks, non-retrying assertions, missing awaits)
- Analyzes Playwright, Cypress, and Selenium configuration for misconfigurations
- Scans CI pipelines (GitHub Actions, Azure DevOps) for inconsistencies
- Produces correlated insights (e.g., retries masking flakiness, CI worker mismatches)
- Scores repository health (A–F grade) with density-normalized risk calculation
- Tracks trends across scans with automatic snapshots and diff summaries

## What it does NOT do

- Does not execute tests
- Does not modify any files in the target repository
- Does not make network connections beyond the local filesystem
- Does not require credentials or access tokens to scan

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Scan a repository
node dist/cli.js /path/to/repo --out ./audit-out

# Or use the shorthand (builds + scans)
npm run audit -- /path/to/repo --out ./audit-out
```

## Output Formats

| Format | File | Description |
|--------|------|-------------|
| Markdown | `audit_summary.md` | Primary report — executive-grade findings with hotspots |
| HTML | `audit_summary.html` | Styled HTML report for browser viewing |
| JSON | `findings.json` | Machine-readable findings array |
| SARIF | `audit.sarif` | GitHub Code Scanning / Azure DevOps compatible |
| Email | `audit_email.html` | Email-ready HTML summary |

Use `--format` to select specific formats:

```bash
node dist/cli.js /path/to/repo --out ./audit-out --format md,json,sarif
```

## CLI Reference

```
scantrix <repoPath> [options]
scantrix init [dir]
```

### Scan options

| Flag | Description | Default |
|------|-------------|---------|
| `--out <dir>` | Output directory for reports | `./audit-out` |
| `--format <list>` | Comma-separated formats: `md,html,json,sarif,email` | all |
| `--config <path>` | Path to `.auditrc.json` config file | auto-detected |
| `--updates` | Check npm registry for outdated dependencies | off |
| `--diff <path>` | Explicit baseline `findings.json` for comparison | auto |
| `--no-trend` | Disable automatic snapshot saving | off |
| `--json-path <path>` | Write canonical `ScanResult` JSON to this path | — |

### Environment variables

| Variable | Description |
|----------|-------------|
| `SCANTRIX_JSON_PATH` | Write canonical results JSON to this path |

### Init subcommand

```bash
# Create a starter .auditrc.json in the target repo
node dist/cli.js init /path/to/repo
```

## Configuration

Create an `.auditrc.json` in the target repository to customize behavior:

```bash
node dist/cli.js init /path/to/repo
```

The config file supports rule overrides (disable rules, adjust severity) and scan options. See [CLI Architecture](docs/CLI_ARCHITECTURE.md) for details.

## GitHub Action

Use Scantrix in CI with the provided composite action:

```yaml
- uses: your-org/scantrix@v1
  with:
    repo-path: "."
    output-dir: "./scantrix-out"
    format: "md,html,json,sarif"
    post-comment: "true"    # Post summary on PRs
    fail-on-high: "true"    # Block merges with high-severity findings
```

### Action inputs

| Input | Description | Default |
|-------|-------------|---------|
| `repo-path` | Path to repository to scan | `.` |
| `output-dir` | Directory for audit artifacts | `./scantrix-out` |
| `config-path` | Path to `.auditrc.json` | — |
| `format` | Output formats (comma-separated) | `md,html,json,sarif` |
| `check-updates` | Check for outdated dependencies | `false` |
| `post-comment` | Post summary comment on PRs | `true` |
| `fail-on-high` | Fail if high-severity findings exist | `false` |

### Action outputs

| Output | Description |
|--------|-------------|
| `findings-count` | Total number of findings |
| `high-count` | Number of high-severity findings |
| `medium-count` | Number of medium-severity findings |
| `low-count` | Number of low-severity findings |
| `risk-grade` | Overall risk grade (A–F) |
| `report-path` | Path to generated report directory |

## Trend Tracking

Every scan automatically saves a snapshot to `<outDir>/snapshots/` with git branch, commit SHA, and file counts. On subsequent scans, Scantrix compares against the latest baseline and reports:

- New and resolved findings
- Evidence-level diffs (added/removed file:line locations)
- Inventory changes (total files, test file counts)
- One-line console delta summary

Disable with `--no-trend`.

## Documentation

- [Rules Reference](docs/RULES.md) — all 87 finding rules with severity and description
- [CI Integration](docs/CI_INTEGRATION.md) — CI pipeline setup and quality gates
- [CLI Architecture](docs/CLI_ARCHITECTURE.md) — module diagram and data flow
- [Security](docs/SECURITY.md) — security model and threat considerations
- [Finding Reference](FINDING_REFERENCE.md) — complete finding ID catalog

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

```bash
# Run the test suite
npm test

# Run tests in watch mode
npm run test:watch
```

## License

[AGPL-3.0](LICENSE) — Copyright (c) 2025 Shawn Tamez / Scantrix
