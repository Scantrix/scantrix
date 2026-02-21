# CI Integration Guide

This guide covers how to integrate Scantrix into your CI/CD pipeline.

## Quick Start

### Azure Pipelines

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
| `--format <list>` | Comma-separated output formats: `md,html,json,sarif,email` | All formats |

## Output Files

| File | Format | Purpose |
|------|--------|---------|
| `audit_summary.md` | Markdown | Full report with findings, risk score, recommendations |
| `audit_summary.html` | HTML | Styled report for browser viewing |
| `audit_email.html` | HTML | Email-safe HTML (no `<details>`, no `<summary>`) |
| `findings.json` | JSON | Machine-readable findings for downstream processing |
| `repo_inventory.json` | JSON | Repository metadata (file counts, config summary) |
| `audit.sarif` | SARIF 2.1.0 | GitHub Code Scanning / Azure DevOps integration |
| `audit_diff.md` | Markdown | Trend report (when `--diff` is provided) |
| `audit_diff.json` | JSON | Machine-readable diff (when `--diff` is provided) |

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
    "gradeA": 20,
    "gradeB": 50,
    "gradeC": 85
  }
}
```

See `.auditrc.example.json` for a complete example.
