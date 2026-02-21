# Scantrix
### Eliminating Flaky Tests, Hidden CI Costs, and Automation Guesswork

---

## **Slide 1 — The Problem**  
### *Modern Test Automation Is Expensive, Fragile, and Misleading*

Enterprise Playwright repositories today often contain:

- Thousands of automated tests  
- Multiple CI pipelines  
- Environment-driven behavior  
- Years of accumulated test debt  

Yet teams still struggle with:

- Flaky tests that “pass on retry”  
- CI pipelines that behave differently with no clear explanation  
- Long runtimes caused by hidden waits and misconfiguration  
- Manual audits that take days and still miss systemic issues  

**The result:** wasted engineering time, unreliable quality signals, and delayed releases.

---

## **Slide 2 — Why Existing Tools Aren’t Enough**  
### *Linters See Syntax. They Don’t See Systems.*

Traditional tools (ESLint, Playwright linters):

- Flag individual code smells  
- Operate file-by-file  
- Lack awareness of CI, retries, workers, or environment intent  

They cannot answer the questions leadership actually asks:

- Why are retries masking failures?  
- Why does one pipeline finish in 12 minutes and another in 45?  
- Where should we fix things first for maximum impact?

---

## **Slide 3 — Our Solution**  
# **Scantrix**

A static analysis, configuration-aware auditing engine that evaluates:

- Playwright test code  
- Playwright configuration  
- CI pipelines (Azure DevOps, GitHub Actions)  

…and correlates them into **high-signal, executive-grade insights**.

It runs in minutes, requires **no test execution**, and is completely **read‑only**.

---

## **Slide 4 — What Makes It Different**  
### *Correlation, Not Linting*

Scantrix doesn't just flag issues — **it explains behavior**.

It correlates:

- Code patterns (hard waits, force clicks)  
- Configuration choices (retries, workers, trace policy)  
- CI pipeline behavior (env vars, caching, artifacts)  

This enables detection of **systemic reliability risks**, not isolated warnings.

---

## **Slide 5 — Example Insight**  
### *Masked Flakiness Risk*

Detected when:

- Retries are enabled  
- Hard waits exist in the codebase  
- Force clicks are present  

**Insight produced:**  
> “Retries are compensating for timing instability rather than fixing root causes.”

Why this matters:

- CI time increases  
- Failures become harder to reproduce  
- Engineers burn time chasing non-deterministic failures  

**This is the level of insight linters cannot produce.**

---

## **Slide 6 — CI Visibility You Don’t Have Today**  
### *CI Pipeline Consistency Analysis*

Scantrix scans all pipeline YAML files and detects:

- Which pipelines publish reports, traces, and test results  
- Which pipelines set critical env vars (WORKERS, HEADLESS)  
- Which pipelines use caching  
- Hosted vs self-hosted agent behavior  

**Example finding:**  
> WORKERS env is set in 3 of 8 pipelines — missing in 5.

**Impact:**  
- Inconsistent parallelism  
- Unpredictable runtimes  
- “Same tests, different behavior”

---

## **Slide 7 — Actionable, Not Overwhelming**  
### *Prioritized Findings with Clear Hotspots*

Every finding includes:

- Context-aware severity (not static rules)  
- Plain-language explanation  
- Concrete recommendations  
- Ranked hotspot files and pipelines  

This answers the critical question:

> **“What should we fix first to get the biggest reliability gain?”**

---

## **Slide 8 — Outputs Leadership Can Read**  
### *Not Logs — Reports*

Scantrix produces:

- Executive-friendly **Markdown reports**  
- Structured **JSON** for dashboards or automation  
- Repo inventory summaries for context  

Reports are designed to be:

- Shared in leadership reviews  
- Used in architecture discussions  
- Acted on immediately by engineering teams  

---

## **Slide 9 — Business Value**  
### *Why This Matters to the Organization*

Scantrix helps teams:

- Reduce flaky tests and false failures  
- Cut CI runtime and infrastructure cost  
- Improve release confidence  
- Eliminate “automation folklore” and guesswork  
- Scale quality without manual audits  

---

## **Slide 10 — Ideal Use Cases**

- Large Playwright repositories (500+ tests)  
- Multiple CI pipelines  
- Teams experiencing unexplained flakiness  
- Organizations preparing for scale or re-architecture  
- Pre-merge or pre-release quality audits  

---

## **Slide 11 — Strategic Vision**  
### *From Tool to Platform*

Scantrix is designed to evolve into:

- A paid repo-audit service  
- A CI quality gate  
- A reliability scoring engine  
- A consulting accelerator for test architecture reviews  

It is intentionally:

- Fast  
- Safe (read-only)  
- CI-agnostic  
- Extensible  

---

## **Slide 12 — Phase 2: Platform Features (Shipped)**
### *Trend Tracking · CI Integration · Web Dashboard*

### Trend Tracking & Diff Mode
- **Auto-snapshots**: Every scan saves a timestamped snapshot to `<outDir>/snapshots/` with git branch, commit SHA, and file/test counts
- **Auto-baseline**: Automatically compares against the latest previous snapshot — no manual `--diff` flag needed
- **Evidence-level diffs**: Tracks which file:line locations were added/removed within persistent findings (with Windows path normalization)
- **Inventory-level diffs**: Shows total files and test file count changes between scans
- **Git-aware reports**: Audit summary header and appendix show the scanned branch and commit
- **Console summary**: One-line delta printed after every scan, including file count changes

### GitHub Action for CI
- **Composite action** (`action.yml`) — drop into any repo's workflow
- Auto-posts/updates PR comments with grade, finding counts, and top issues
- Optional quality gate: `fail-on-high: true` blocks merges with high-severity findings
- Pushes results to the Scantrix dashboard API

### CLI Subcommands
```
scantrix <repoPath> [--out <dir>] [--format md,html,json,sarif,email] [--no-trend]
scantrix init [dir]                          # Create starter .auditrc.json
scantrix push [findings.json] --key <key>    # Push results to dashboard
```

### Web Dashboard
- **Next.js 14 + SQLite** under `dashboard/`
- **Collapsible sidebar navigation** — icon-driven, toggle between 240 px and 68 px
- **Repository detail page** (`/repos/[name]`) — grade cards, repository statistics (git branch/commit), severity breakdown, priority files, recommended actions, collapsible findings table, Playwright & CI/CD configuration overview, scan history
- **Inventory pipeline** — `push` sends `repo_inventory.json` through to the dashboard for configuration and statistics rendering
- Historical scan data, trend charts, cross-repo comparison
- Dark theme with Scantrix indigo-blue brand
- API routes: `/api/scans`, `/api/repos`, `/api/repos/[name]`, `/api/trends`, `/api/compare`

---

## **Slide 13 — Bottom Line**
# **We Don't Run Your Tests.  
We Explain Them.**

Scantrix turns complex automation systems into:

- Clear insights  
- Prioritized actions  
- Better engineering decisions  

---

## Quick Start

### Scan a repository
```powershell
npm run audit -- "C:\Repositories\Service.Playwright.Automation" --out "audit-out\service-pw-automation"
```

### Initialize config for a target repo
```powershell
npx ts-node .\src\cli.ts init "C:\Repositories\Service.Playwright.Automation"
```

### Push findings to the Scantrix dashboard
```powershell
npx ts-node .\src\cli.ts push "audit-out\service-pw-automation\findings.json" --key YOUR_API_KEY

```

### Run tests
```powershell
npm test
```

### The dashboard is a Next.js app. To start it:
```powershell
cd c:\Repositories\repo-audit-agent\dashboard
npm run dev
```

Then open http://localhost:3000 in a browser.

However, the dashboard reads from its SQLite database, not the file-based snapshots in audit-out. To populate it with your scan data, you need to push findings after starting the dashboard:


```powershell
cd c:\Repositories\repo-audit-agent
npx ts-node src/cli.ts push "audit-out\service-pw-automation\findings.json" --key any-key-for-now --url http://localhost:3000
```

Two trend systems exist:
```
System	Storage	Populated by	View with
CLI snapshots |	audit-out/snapshots/*.json	|Auto-saved every scan	| Console diff summary
Web dashboard	| dashboard/data/scantrix.db	|scantrix push command	| http://localhost:3000/trends
The snapshot you're looking at (meta.json) is from the CLI system. Each time you run a scan, the CLI auto-compares against the previous snapshot and prints a delta. To build up history in the web dashboard, push findings after each scan — or add --api-key / --api-url flags to your scan workflow so it pushes automatically.
```