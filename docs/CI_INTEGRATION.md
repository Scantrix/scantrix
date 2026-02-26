# CI Integration Guide

This guide covers how to integrate Scantrix into your CI/CD pipeline.

## Quick Start

### Azure Pipelines

#### Recommended: Hub Sink (v5.0.0+)

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'

  - script: |
      git clone https://your-org/repo-audit-agent.git /tmp/audit-agent
      cd /tmp/audit-agent && npm ci
    displayName: 'Install Audit Agent'

  - script: |
      cd /tmp/audit-agent
      npx ts-node src/cli.ts "$(Build.SourcesDirectory)" \
        --sink hub \
        --ingest-url "$(SCANTRIX_INGEST_URL)" \
        --token "$(SCANTRIX_TOKEN)" \
        --json-path "$(Build.ArtifactStagingDirectory)/audit/scantrix-results.json" \
        --out "$(Build.ArtifactStagingDirectory)/audit" \
        --format sarif,html \
        --no-trend
    displayName: 'Run Audit (Hub Sink)'

  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: '$(Build.ArtifactStagingDirectory)/audit'
      artifact: 'audit-report'
```

> **Note:** `SCANTRIX_INGEST_URL` and `SCANTRIX_TOKEN` must be set as pipeline variables (or variable group secrets). The pipeline will fail fast if either is missing in hub mode.

#### Legacy: Push Approach

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'

  - script: |
      git clone https://your-org/repo-audit-agent.git /tmp/audit-agent
      cd /tmp/audit-agent && npm ci
    displayName: 'Install Audit Agent'

  - script: |
      cd /tmp/audit-agent
      npx ts-node src/cli.ts "$(Build.SourcesDirectory)" \
        --out "$(Build.ArtifactStagingDirectory)/audit" \
        --format sarif,json,html
    displayName: 'Run Audit'

  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: '$(Build.ArtifactStagingDirectory)/audit'
      artifact: 'audit-report'
```

### GitHub Actions

#### Recommended: Hub Sink (v5.0.0+)

```yaml
name: Playwright Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Clone Audit Agent
        run: |
          git clone https://your-org/repo-audit-agent.git /tmp/audit-agent
          cd /tmp/audit-agent && npm ci

      - name: Run Audit (Hub Sink)
        env:
          SCANTRIX_INGEST_URL: ${{ secrets.SCANTRIX_INGEST_URL }}
          SCANTRIX_TOKEN: ${{ secrets.SCANTRIX_TOKEN }}
        run: |
          cd /tmp/audit-agent
          npx ts-node src/cli.ts "${{ github.workspace }}" \
            --sink hub \
            --ingest-url "$SCANTRIX_INGEST_URL" \
            --token "$SCANTRIX_TOKEN" \
            --json-path ./audit-output/scantrix-results.json \
            --out ./audit-output \
            --format sarif,html \
            --no-trend

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: /tmp/audit-agent/audit-output/audit.sarif

      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: audit-report
          path: /tmp/audit-agent/audit-output/
```

> **Note:** `SCANTRIX_INGEST_URL` and `SCANTRIX_TOKEN` must be configured as repository secrets. The CLI will fail fast if either is missing in hub mode.

#### Legacy: Push Approach

```yaml
name: Playwright Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Clone Audit Agent
        run: |
          git clone https://your-org/repo-audit-agent.git /tmp/audit-agent
          cd /tmp/audit-agent && npm ci

      - name: Run Audit
        run: |
          cd /tmp/audit-agent
          npx ts-node src/cli.ts "${{ github.workspace }}" \
            --out ./audit-output \
            --format sarif,json,html,md

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: /tmp/audit-agent/audit-output/audit.sarif

      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: audit-report
          path: /tmp/audit-agent/audit-output/
```

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <path>` | Path to the repository to audit (or positional arg) | Required |
| `--out <dir>` | Output directory for reports | `./audit-out` |
| `--updates` | Check for outdated npm dependencies | `false` |
| `--config <path>` | Path to `.auditrc.json` config file | Auto-detected in repo root |
| `--diff <path>` | Path to baseline `findings.json` for trend tracking | None |
| `--format <list>` | Comma-separated output formats: `md,html,json,sarif,email` | All formats || `--sink local\|hub` | Result sink target. `local` writes files to `--out`; `hub` POSTs `ScanResult` JSON to a Hub ingestion endpoint | `local` |
| `--json-path <path>` | Write the canonical `ScanResult` JSON to this path (recommended even in hub mode for pipeline artifacts) | None |
| `--sqlite-path <path>` | Path to a local SQLite database for result storage | None |
| `--ingest-url <url>` | Hub ingestion endpoint URL (required when `--sink hub`) | None |
| `--token <tok>` | Bearer token for Hub authentication (required when `--sink hub`) | None |
| `--no-trend` | Disable local snapshot saving (useful in CI where snapshots are ephemeral) | `false` |
## Output Files

| File | Format | Purpose |
|------|--------|---------|
| `audit_summary.md` | Markdown | Full report with findings, risk score, recommendations |
| `audit_summary.html` | HTML | Styled report for browser viewing |
| `audit_email.html` | HTML | Email-safe HTML (no `<details>`, no `<summary>`) |
| `findings.json` | JSON | Machine-readable findings for downstream processing |
| `repo_inventory.json` | JSON | Repository metadata (file counts, config summary) |
| `audit.sarif` | SARIF 2.1.0 | GitHub Code Scanning / Azure DevOps integration || `scantrix-results.json` | JSON | Canonical `ScanResult` artifact produced by `--json-path` (recommended for pipeline artifacts) || `audit_diff.md` | Markdown | Trend report (when `--diff` is provided) |
| `audit_diff.json` | JSON | Machine-readable diff (when `--diff` is provided) |

## Environment Variables for Sink Mode

When using `--sink hub`, the following environment variables can be used in place of (or alongside) CLI flags. CLI flags take precedence over environment variables.

| Variable | CLI Equivalent | Description |
|----------|---------------|-------------|
| `SCANTRIX_SINK` | `--sink` | Sink target: `local` or `hub` |
| `SCANTRIX_JSON_PATH` | `--json-path` | Path to write the canonical `ScanResult` JSON |
| `SCANTRIX_SQLITE_PATH` | `--sqlite-path` | Path to a local SQLite database for result storage |
| `SCANTRIX_INGEST_URL` | `--ingest-url` | Hub ingestion endpoint URL (**required** in hub mode) |
| `SCANTRIX_TOKEN` | `--token` | Bearer token for Hub authentication (**required** in hub mode) |

> **Fail-fast behavior:** In hub mode, the CLI validates that `SCANTRIX_INGEST_URL` and `SCANTRIX_TOKEN` are present before scanning begins. If either is missing, the process exits with a non-zero code and a clear error message.

## Trend Tracking

To track findings over time, save the `findings.json` from each run and pass the previous baseline:

```bash
# First run
npx ts-node src/cli.ts /path/to/repo --out ./audit-current

# Subsequent runs (compare against previous)
npx ts-node src/cli.ts /path/to/repo \
  --out ./audit-current \
  --diff ./audit-previous/findings.json
```

The `audit_diff.md` will show:
- **New findings** (regressions)
- **Resolved findings** (improvements)
- **Persistent findings** (unchanged)

## SARIF Integration

### GitHub Code Scanning
Upload `audit.sarif` using the `github/codeql-action/upload-sarif` action. Findings will appear in the Security tab of your repository.

### Azure DevOps
Use the SARIF SAST Scans Tab extension or publish as a build artifact.

## Custom Configuration (.auditrc.json)

Place an `.auditrc.json` in the audited repository's root to customize behavior:

```json
{
  "rules": {
    "disabled": ["PW-LOC-001"],
    "severityOverrides": {
      "PW-FLAKE-001": "medium"
    }
  },
  "exclude": ["**/generated/**", "**/vendor/**"],
  "thresholds": {
    "gradeA": 80,
    "gradeB": 60,
    "gradeC": 40
  }
}
```

See `.auditrc.example.json` for a complete example.
