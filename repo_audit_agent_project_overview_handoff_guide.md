# Repo Audit Agent

## Executive Summary
Repo Audit Agent is a **static analysis and configuration‑aware auditing tool** designed to evaluate large Playwright automation repositories and their CI pipelines. Its goal is to surface **high‑signal reliability, stability, and operability risks** that traditional linters and ESLint plugins cannot reliably detect.

Unlike rule-only linters, this agent correlates **code patterns**, **Playwright configuration**, and **CI pipeline behavior** to generate **actionable, executive‑grade findings**—the kind that explain *why* tests are flaky, *where* time is being wasted, and *how* CI behavior diverges across environments.

This document explains:
- What the app does
- Why it exists
- How it works internally
- The strategic goal of the project
- How another agent should continue development inside VS Code

---

## Problem Statement (Why This Exists)
Modern Playwright repos often contain:
- Thousands of tests
- Multiple CI pipelines
- Environment‑driven behavior (WORKERS, HEADLESS, retries)
- Years of accumulated test debt

Common pain points:
- Flaky tests masked by retries
- CI pipelines behaving differently for no obvious reason
- Long runtimes caused by hidden waits or missing caching
- ESLint rules flagging syntax but missing **systemic issues**

Reviewing such repos manually can take **days**. ESLint‑plugin‑playwright helps at the file level—but it **cannot reason across config + CI + behavior**.

Repo Audit Agent exists to:
> **Compress days of senior QA / SDET review into minutes, with context and prioritization.**

---

## What the App Does (Functional Overview)

### 1. Repository Inventory
The scanner builds a structural profile of the repo:
- Total file count
- Test file count
- Playwright config presence
- Playwright version

This gives scale context before any findings are presented.

---

### 2. Playwright Configuration Analysis
The agent parses `playwright.config.*` to extract:
- Timeouts (test + expect)
- Workers configuration (static vs env‑driven)
- Retry policy
- Global setup usage
- Trace / video / screenshot policy
- Projects (desktop, mobile, grep usage)
- Environment variable hints (WORKERS, CI, HEADLESS_MODE, etc.)

**Why this matters:**
Config explains *intent*. Findings are judged against that intent.

---

### 3. CI Pipeline Discovery & Classification
The agent aggressively discovers CI YAML files using:
- Path heuristics (`/pipelines`, `.github/workflows`)
- Filename conventions (`*pipeline*.yml`)
- Content heuristics (stages, jobs, steps, PublishPipelineArtifact, etc.)

Each pipeline is classified as:
- Azure Pipelines
- GitHub Actions
- Unknown

This enables repo‑wide CI reasoning, even when pipelines are fragmented.

---

### 4. CI Behavior Extraction
For each CI pipeline, the agent detects:
- Artifact publishing (Playwright HTML report)
- JUnit publishing
- Trace / test‑results publishing
- Cache usage (Cache@2, actions/cache)
- WORKERS env usage (and **which files set it**)
- HEADLESS_MODE usage
- Node/npm/playwright install steps
- Hosted vs self‑hosted agent signals
- Hints that browsers are preinstalled

The result is a **CI Summary**, not just file detection.

---

### 5. Code Pattern Findings (Static Rules)
The agent scans source files for **high‑risk Playwright patterns**, including:

- **PW‑FLAKE‑001** — Hard waits (`waitForTimeout`, `setTimeout`)
- **PW‑FLAKE‑002** — Force clicks
- **PW‑LOC‑001** — XPath‑heavy selectors

Each finding includes:
- Severity
- Description
- Recommendation
- Hotspot files (ranked)
- Sample evidence with file + line

These are intentionally **curated**, not exhaustive lint warnings.

---

### 6. Derived / Correlated Insights (Key Differentiator)
This is where the tool separates itself from ESLint.

Example:

**PW‑INSIGHT‑001 — Masked flakiness risk**

Triggered only when:
- Retries are enabled
- Hard waits exist
- Force clicks exist

This explains *why* retries are hiding instability rather than fixing it.

---

### 7. CI Consistency Findings

Example:

**CI‑006 — WORKERS env is set inconsistently across CI pipelines**

Detected when:
- Playwright workers are env‑driven
- Some pipelines set WORKERS
- Others do not

The finding:
- Quantifies inconsistency (e.g. 3/8 pipelines)
- Lists pipelines that set WORKERS
- Lists pipelines that do **not**

This explains real‑world behavior like:
> “Why does pipeline A finish in 12 minutes and pipeline B take 45?”

---

## Output Artifacts

The app produces the following artifacts per scan:

1. **audit_summary.md** — Human‑readable, executive‑friendly report (includes git branch in header)
2. **audit_summary.html** — Styled HTML version of the report
3. **audit_email.html** — Email-optimized HTML report
4. **findings.json** — Structured findings for dashboards / automation
5. **repo_inventory.json** — Raw inventory + summaries
6. **audit_diff.md / audit_diff.json** — Trend diff with inventory-level changes (when baseline exists)
7. **snapshots/<ISO-date>/findings.json + meta.json** — Auto-saved timestamped snapshots with git branch, commit, and file counts for trend tracking

Optional SARIF output (`--format sarif`) for GitHub Code Scanning / Azure DevOps integration.

---

## Overall Project Goal (Strategic)

### Primary Goal
> **Create a reusable, sellable engine that audits Playwright, Cypress, and Selenium repos and their CI pipelines for reliability and operational risk—without running tests.**

### Current State (v4.2.0)
Phase 2 is complete plus a major dashboard UX overhaul. The product now includes:
- **50+ audit rules** across 3 frameworks (Playwright, Cypress, Selenium)
- **AST-based config parsing** via TypeScript Compiler API
- **Trend tracking** with auto-snapshots (including git branch/commit and inventory data), evidence-level diffs with Windows path normalization, and inventory-level deltas
- **GitHub Action** for CI integration with PR comments and quality gates
- **Push client** for sending findings + inventory to the Qaverity dashboard API
- **Web dashboard** (Next.js 14 + SQLite) with collapsible sidebar navigation, repository detail page (grade cards, statistics, severity breakdown, priority files, recommended actions, findings table, config overview, scan history), trend visualization, and cross-repo comparison
- **Inventory pipeline** — `repo_inventory.json` (with git branch/commit) flows from report → push → dashboard DB → detail page
- **Git-aware reports** showing scanned branch and commit in the audit summary
- **113 tests** across 10 test files

### Long‑Term Vision
This tool is meant to evolve into:
- A paid repo‑audit SaaS platform
- A pre‑merge quality gate (via GitHub Action)
- A CI observability companion with historical trend data
- A consulting accelerator for large automation teams
- A subscription service with Stripe integration (Free/Pro/Team/Enterprise tiers)

It is intentionally:
- **Read‑only** (safe)
- **Fast** (no test execution)
- **Context‑aware** (config + CI + code)
- **Multi-framework** (Playwright, Cypress, Selenium)

---

## Design Philosophy
- High signal > many rules
- Correlation > linting
- Explain *why*, not just *what*
- Prioritize findings humans can act on Monday morning

---

## Handoff Instructions for VS Code Agent

### You are continuing work on Qaverity (Repo Audit Agent) v4.2.0.

Key files:
- `src/scanner.ts` — Core orchestration, 50+ audit rules, framework detection, git metadata capture
- `src/cli.ts` — CLI entry point with `scan`, `init`, `push` subcommands (push now includes inventory)
- `src/report.ts` — Markdown, HTML, JSON, SARIF, email report generation; `repo_inventory.json` includes git branch/commit
- `src/configExtractor.ts` — Playwright config parsing
- `src/astConfigParser.ts` — AST-based config parser (TypeScript Compiler API)
- `src/ciExtractor.ts` — CI pipeline discovery + behavior extraction
- `src/cypressExtractor.ts` — Cypress project detection + config parsing
- `src/diffTracker.ts` — Trend tracking: snapshots with git metadata + inventory, auto-baseline, evidence-level diffs with path normalization, inventory deltas
- `src/auditConfig.ts` — `.auditrc.json` loading, merging, default generation
- `src/pushClient.ts` — HTTP client for pushing findings + inventory to dashboard API
- `action.yml` — GitHub Action (composite) for CI integration
- `dashboard/` — Next.js 14 + SQLite web dashboard
- `dashboard/src/components/sidebar.tsx` — Collapsible icon-driven sidebar navigation
- `dashboard/src/app/repos/[name]/page.tsx` — Repository detail page (overview, stats, severity, priority files, actions, findings, config, scan history)
- `dashboard/src/app/api/repos/[name]/route.ts` — Detail page API (returns repo, scan, findings, inventory, history)

### Current State (v4.2.0)
- Phase 2 complete + dashboard UX overhaul (v4.2.0)
- v4.2.0 additions: collapsible sidebar navigation, repository detail page with 8 sections, inventory pipeline (push sends repo_inventory.json → dashboard DB → detail page), git branch/commit in inventory
- v4.1.0 additions: git-aware snapshots, Windows path normalization in diffs, inventory-level trend deltas, branch/commit in reports
- 50+ audit rules across Playwright, Cypress, Selenium
- 113 tests across 10 test files, all passing
- TypeScript compiles cleanly (`tsc --noEmit`)
- Dashboard backend API routes complete, frontend pages complete (including `/repos/[name]` detail)
- GitHub Action with PR comments, quality gates, artifact upload

### Phase 3 Candidates (in priority order)
1. **Stripe payment integration** — Subscription tiers (Free/Pro/Team/Enterprise), API key gating
2. **Dashboard authentication** — User accounts, team management, API key generation UI
3. **GitHub App mode** — Clone repos on infra, scan automatically on push/PR
4. **Historical diff in dashboard** — Scan-to-scan comparison UI in the web dashboard
5. **Rule authoring SDK** — Allow customers to write custom rules as plugins
6. **Monorepo support** — Scan multiple projects within a single repository

### Important Constraints
- Do NOT add low‑value lint‑style rules
- Do NOT require repo‑specific assumptions
- Keep findings explainable to non‑Playwright experts
- Dashboard must work offline with SQLite (no external DB dependency)

---

## Prompt for Another Agent (Copy/Paste)

You are working on **Qaverity** (Repo Audit Agent), a TypeScript‑based static analysis tool that audits Playwright, Cypress, and Selenium automation repositories and their CI pipelines.

**Version:** 4.2.0 | **Tests:** 113 | **Rules:** 50+

Your goals:
- Improve report clarity and executive readability
- Add high‑signal correlated findings
- Avoid noisy or purely stylistic rules
- Maintain or expand the test suite

Focus areas:
- `src/scanner.ts` (audit rules + derived insights)
- `src/ciExtractor.ts` (accurate CI behavior detection)
- `src/report.ts` (clean, deduplicated, prioritized output)
- `src/diffTracker.ts` (trend tracking + snapshot enrichment)
- `dashboard/` (web dashboard features)
- `action.yml` (GitHub Action CI integration)

You should treat `audit_summary.md` as the primary product surface.

First review `PROJECT_CONTEXT.md` for the full architecture overview.

