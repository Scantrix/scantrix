# Scantrix Deployment & Multi-Repo Setup Guide

This guide explains how Scantrix works across multiple repositories, how to deploy the dashboard, and how teams get a unified view of all their automation repos in one place.

---

## How Scantrix Works Across Multiple Repos

Scantrix has two components that work together:

| Component | What It Does | Where It Runs |
|-----------|-------------|---------------|
| **Scantrix CLI** (scanner) | Scans a repo's test code, config, and CI pipelines. Produces findings and reports. | Inside each repo's CI pipeline |
| **Scantrix Dashboard** (web app) | Central web interface that collects, stores, and visualizes results from all repos. | One shared server |

### The Key Concept: Scan Locally, Route Results via Sinks

As of **v5.0.0**, Scantrix uses a **pluggable sink architecture**. Each repository runs its own scan in its own CI pipeline. The CLI produces a canonical `ScanResult` JSON (including tool, version, runId, timestamps, repo metadata, findings, summary, and inventory) and routes it to one or more **sinks**:

| Sink | Always On? | Description |
|------|-----------|-------------|
| **JSON file** | Yes | Writes `findings.json` and other report files to disk |
| **SQLite** | Optional (local mode) | Appends results to a local SQLite database |
| **Hub HTTP POST** | Optional (hub mode) | POSTs the `ScanResult` to a central Hub ingestion endpoint |

There are two deployment models:

#### Model A — Local / Self-Hosted (SQLite)

The dashboard uses an embedded SQLite database. The CLI writes results via the JSON and/or SQLite sinks, or pushes via the legacy `push` subcommand.

```
┌─────────────────────┐
│ Repo A - CI build   │──scan──► ScanResult ──sink──┐
└─────────────────────┘                             │
┌─────────────────────┐                             │    ┌──────────────────────────┐
│ Repo B - CI build   │──scan──► ScanResult ──sink──┼───►│  Scantrix Dashboard       │
└─────────────────────┘                             │    │  (single instance)        │
┌─────────────────────┐                             │    │   ┌──────────────────┐    │
│ Repo C - CI build   │──scan──► ScanResult ──sink──┘    │   │   SQLite DB      │    │
└─────────────────────┘                                  │   │   (all repos)    │    │
                                                         │   └──────────────────┘    │
  Sinks: JSON file (always) + SQLite (optional)          └──────────────────────────┘
  CLI flag: --sink local
```

#### Model B — Hub / Multi-Pipeline (Postgres)

Multiple pipelines POST the `ScanResult` to a central **Hub ingestion API**. The Hub service owns Postgres and writes the data. The dashboard reads from Postgres. **The CLI never touches Postgres directly.**

```
┌─────────────────────┐
│ Repo A - CI build   │──scan──► ScanResult ──POST──┐
└─────────────────────┘                             │
┌─────────────────────┐                             │    ┌─────────────────────────┐
│ Repo B - CI build   │──scan──► ScanResult ──POST──┼───►│  Scantrix Hub API       │
└─────────────────────┘                             │    │  (ingestion endpoint)   │
┌─────────────────────┐                             │    │   ┌─────────────────┐   │
│ Repo C - CI build   │──scan──► ScanResult ──POST──┘    │   │   Postgres DB   │   │
└─────────────────────┘                                  │   │   (all repos)   │   │
                                                         │   └─────────────────┘   │
  Sinks: JSON file (always) + Hub HTTP POST              │           │             │
  CLI flag: --sink hub                                   └───────────┼─────────────┘
                                                                     │
                                                         ┌───────────▼─────────────┐
                                                         │   Scantrix Dashboard    │
                                                         │   (reads from Postgres) │
                                                         └─────────────────────────┘
```

### What Each Repo Needs

You do **not** install the full dashboard in every repo. Each repo only needs the CLI scanner, which you can add in one of two ways:

**Option A - npm devDependency** (for any CI platform):
```bash
npm install --save-dev scantrix
```

**Option B - GitHub Action** (for GitHub repos - zero install required):
```yaml
- uses: your-org/scantrix@v4
  with:
    api-key: ${{ secrets.SCANTRIX_API_KEY }}
    api-url: https://your-dashboard-url.com
```

The dashboard only needs to be deployed once, and all repos push to it.

## Dashboard Deployment

### What Is the Dashboard?
The Scantrix Dashboard is a Next.js 14 web application with a SQLite database. It provides:

- **Main dashboard** - Overview cards for every repo with grades, finding counts, and last-scan timestamps
- **Repo detail pages** - Deep-dive into findings, severity breakdown, priority files, config overview, scan history
- **Trends** - Charts showing finding counts and risk scores over time per repo
- **Compare** - Side-by-side comparison of any two repos
- **REST API** - Receives pushed scan data and serves the frontend

### Does It Need a Web Server?
Yes - the dashboard is a web application that must be running and accessible over HTTP(S) so that:

- CI pipelines can POST scan results to it (the `push` command)
- Your team can open it in a browser to view reports

Next.js includes its own built-in production web server (`next start`), so you do not need to install Apache, Nginx, or IIS separately. You just need a machine (physical, virtual, or container) that can run Node.js.

### Infrastructure Requirements

| Requirement | Detail |
|-------------|--------|
| Node.js | v18 or later |
| Disk space | Minimal - SQLite database grows ~1 MB per 100 scans |
| Memory | 256 MB minimum, 512 MB recommended |
| CPU | 1 core is sufficient |
| Network | Must be reachable from your CI runners (HTTP or HTTPS) |
| OS | Any OS that runs Node.js - Linux, Windows, macOS |
| External database | **Local mode:** None — SQLite is embedded. **Hub mode:** Postgres (managed by the Hub service, not the CLI) |
| External services | **Local mode:** None — fully self-contained, works offline/air-gapped. **Hub mode:** Requires the Hub ingestion API |

### Deployment Options

#### Option 1: Internal VM or Server (Simplest)
Run the dashboard on any Linux or Windows server your CI pipelines can reach.

```bash
# 1. Clone the repo and install dependencies
git clone https://your-org/repo-audit-agent.git /opt/scantrix
cd /opt/scantrix/dashboard
npm ci

# 2. Build the production app
npm run build

# 3. Start the server (default port 3000)
npm run start

# Or specify a custom port:
PORT=8080 npm run start
```

The dashboard is now running at `http://your-server:3000`. CI pipelines push to this URL.

Keeping it running: Use a process manager like `pm2` or a systemd service:

```bash
# With pm2:
npm install -g pm2
pm2 start npm --name "scantrix" -- run start
pm2 save
pm2 startup   # auto-start on reboot

# With systemd (Linux):
# Create /etc/systemd/system/scantrix.service
# [Service]
# ExecStart=/usr/bin/npm run start
# WorkingDirectory=/opt/scantrix/dashboard
# Restart=always
```

#### Option 2: Docker Container

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY dashboard/ .
RUN npm ci && npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
```

```bash
docker build -t scantrix-dashboard .
docker run -d -p 3000:3000 -v scantrix-data:/app/data scantrix-dashboard
```

Important: Mount the `/app/data` directory as a Docker volume so the SQLite database persists across container restarts.

#### Option 3: Azure App Service / AWS / GCP
Any Node.js hosting platform works. Configure:

- Start command: `npm run start`
- Build command: `npm run build`
- Node version: 18+
- Persistent storage: Ensure the `data/` directory is on persistent disk (not ephemeral)

#### Option 4: Run Locally (For Evaluation)
For trying it out, you can run the dashboard on your own machine:

```bash
cd dashboard
npm install
npm run dev    # development mode with hot reload on http://localhost:3000
```

## Setting Up the Push Pipeline
Once the dashboard is running, configure each repo's CI pipeline to push results after scanning.

As of v5.0.0, there are **two approaches** to sending results:

| Approach | When to Use | How It Works |
|----------|------------|---------------|
| **Sink-based** (recommended) | New setups, v5.0.0+ | CLI routes `ScanResult` to configured sinks automatically after scan |
| **`push` subcommand** (legacy) | Existing setups, backward-compat | Separate command after scan to POST `findings.json` to dashboard |

Both approaches continue to work. The sink-based approach is preferred because it combines scanning and result routing into a single step.

### Sink-Based Approach (v5.0.0+)

Configure sinks via CLI flags or environment variables:

| CLI Flag | Env Var | Default | Description |
|----------|---------|---------|-------------|
| `--sink` | `SCANTRIX_SINK` | `local` | Sink mode: `local` or `hub` |
| `--json-path` | `SCANTRIX_JSON_PATH` | `./audit-out` | Output directory for JSON files |
| `--sqlite-path` | `SCANTRIX_SQLITE_PATH` | `./scantrix.db` | Path to SQLite database (local mode) |
| `--ingest-url` | `SCANTRIX_INGEST_URL` | — | Hub ingestion endpoint URL (hub mode) |
| `--token` | `SCANTRIX_TOKEN` | — | Bearer token for Hub authentication |

**Local mode example (JSON + SQLite):**
```bash
scantrix . --out ./audit-out --sink local --sqlite-path ./scantrix.db
```

**Hub mode example (JSON + HTTP POST):**
```bash
scantrix . --out ./audit-out --sink hub \
  --ingest-url https://hub.your-company.com/api/ingest \
  --token $SCANTRIX_TOKEN
```

In both modes, JSON files are always written to disk. The sink determines the *additional* destination.

### Legacy Push Subcommand

The existing `push` subcommand still works for the legacy dashboard workflow.

### Step 1: Note Your Dashboard URL
Whatever machine or container is hosting the dashboard - that's your push URL. Examples:

- http://10.0.1.50:3000 (internal IP)
- https://scantrix.your-company.com (behind a reverse proxy with HTTPS)
- http://localhost:3000 (local development)

### Step 2: Configure CI Pipelines

#### GitHub Actions (Using the Scantrix Action)

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

      - uses: your-org/scantrix@v4
        with:
          api-key: ${{ secrets.SCANTRIX_API_KEY }}
          api-url: ${{ secrets.SCANTRIX_API_URL }}   # e.g., https://scantrix.internal.com
          fail-on-high: true                          # optional: block PR merges
          post-comment: true                          # optional: PR comment with summary
```

This single step scans the repo, pushes results, and optionally posts a PR comment - all automatically.

#### GitHub Actions (Manual Setup)

```yaml
- name: Install Scantrix
  run: npm install -g scantrix

- name: Scan
  run: scantrix . --out ./audit-out --format json,html,sarif

- name: Push Results to Dashboard
  run: scantrix push ./audit-out/findings.json --key ${{ secrets.SCANTRIX_API_KEY }} --url ${{ secrets.SCANTRIX_API_URL }}
```

#### Azure DevOps Pipelines

```yaml
- script: |
    npm install -g scantrix
    scantrix "$(Build.SourcesDirectory)" --out "$(Build.ArtifactStagingDirectory)/audit" --format json,html,sarif
  displayName: "Run Scantrix Audit"

- script: |
    scantrix push "$(Build.ArtifactStagingDirectory)/audit/findings.json" \
      --key $(SCANTRIX_API_KEY) \
      --url $(SCANTRIX_API_URL)
  displayName: "Push to Dashboard"
```

### Step 3: Set Secrets
Store these as CI secrets or pipeline variables:

| Secret | Value | Example |
|--------|-------|---------|
| SCANTRIX_API_KEY | Any string (API key authentication) | sk-scantrix-abc123 |
| SCANTRIX_API_URL | URL of your dashboard instance | https://scantrix.internal.com |

### Automatic Repo Name Detection
You do not need to tell each pipeline which repo it is. The push command auto-detects the repo name from:

1. `GITHUB_REPOSITORY` environment variable (GitHub Actions)
2. `BUILD_REPOSITORY_NAME` environment variable (Azure DevOps)
3. The working directory name (fallback)

Each unique repo name creates a separate entry on the dashboard.

## Hub Mode (Multi-Pipeline Deployment)

Use **hub mode** when you have multiple CI pipelines across different repos or teams and want a centralized ingestion point backed by Postgres instead of SQLite.

### When to Use Hub Mode

- You have **many repos** (10+) pushing results and need Postgres-level concurrency
- You want a **dedicated ingestion service** that owns the database schema and migrations
- You need to **decouple** the CLI from the database — the CLI only knows about the HTTP endpoint
- Your dashboard is deployed separately and reads from Postgres

For small teams or single-repo use, **local mode with SQLite** is simpler and requires no additional infrastructure.

### Hub Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Pipeline A   │   │ Pipeline B   │   │ Pipeline C   │
│ (GitHub CI)  │   │ (Azure ADO)  │   │ (Jenkins)    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │   POST /api/ingest (ScanResult JSON)
       ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────┐
│              Scantrix Hub Service                   │
│  • Validates bearer token                           │
│  • Parses ScanResult (runId, findings, inventory)   │
│  • Writes to Postgres                               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Postgres DB   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Dashboard     │
              │   (reads only)  │
              └─────────────────┘
```

**Key point:** The CLI never connects to Postgres. It POSTs the `ScanResult` to the Hub's ingestion endpoint. The Hub service owns the database.

### Required Environment Variables (Hub Mode)

| Variable | Required | Description |
|----------|----------|-------------|
| `SCANTRIX_SINK` | Yes | Set to `hub` |
| `SCANTRIX_INGEST_URL` | Yes | Hub ingestion endpoint, e.g. `https://hub.example.com/api/ingest` |
| `SCANTRIX_TOKEN` | Yes | Bearer token for authenticating with the Hub |
| `SCANTRIX_JSON_PATH` | No | Override JSON output directory (default: `./audit-out`) |

### Example CI Configurations (Hub Mode)

#### GitHub Actions

```yaml
name: Automation Audit (Hub)
on:
  push:
    branches: [main]
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Scantrix
        run: npm install -g scantrix

      - name: Scan and Push to Hub
        env:
          SCANTRIX_SINK: hub
          SCANTRIX_INGEST_URL: ${{ secrets.SCANTRIX_INGEST_URL }}
          SCANTRIX_TOKEN: ${{ secrets.SCANTRIX_TOKEN }}
        run: scantrix . --out ./audit-out
```

#### Azure DevOps Pipelines

```yaml
- script: |
    npm install -g scantrix
    scantrix "$(Build.SourcesDirectory)" \
      --out "$(Build.ArtifactStagingDirectory)/audit" \
      --sink hub \
      --ingest-url $(SCANTRIX_INGEST_URL) \
      --token $(SCANTRIX_TOKEN)
  displayName: "Scan and Push to Hub"
```

No separate `push` step is needed — the sink handles delivery automatically.

---

## What the Dashboard Shows
Once multiple repos are pushing results, the dashboard displays:

### Main Dashboard (`/`)
A card grid showing every repo that has pushed data:

- Current risk grade (A-F)
- Finding count by severity
- Last scan timestamp
- Click any card to see the full detail page

### Repo Detail (`/repos/{name}`)
Full audit results for a single repo:

- Overview cards - grade, total findings, high severity count, scan count
- Repository statistics - file counts, Playwright version, detected frameworks, git branch and commit
- Severity breakdown - visual bars for high, medium, low
- Priority files - top hotspot files ranked by issue density
- Recommended actions - top 5 things to fix first
- Findings table - every finding with expandable evidence (file, line, code snippet)
- Configuration overview - Playwright config and CI/CD config details
- Scan history - last 20 scans with grades and scores

### Trends (`/trends`)
Per-repo charts showing how findings and risk scores change over time. Requires at least 2 scans for a given repo.

### Compare (`/compare`)
Side-by-side comparison of any two repos - useful for benchmarking teams or projects against each other.

## Network and Security Considerations

### HTTPS (Recommended for Production)
The dashboard runs on plain HTTP by default. For production, put it behind a reverse proxy with TLS:

**Nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name scantrix.your-company.com;

    ssl_certificate     /etc/ssl/certs/scantrix.crt;
    ssl_certificate_key /etc/ssl/private/scantrix.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Firewall Rules
The dashboard only needs to accept inbound traffic from:

- CI runners - so they can POST scan results (port 3000 or your custom port)
- Developer browsers - so your team can view reports

If your CI runners and developers are on the same internal network, the dashboard never needs to be exposed to the public internet.

### API Key Authentication
Every push request includes an API key in the `Authorization: Bearer <key>` header. The dashboard validates this key against its `api_keys` table. This prevents unauthorized pushes.

### API Key Rotation (Detailed)
Key rotation is the process of replacing an old API key with a new one without breaking pipelines. The safest approach is a **two-key overlap window**: add a new key, update all pipelines, confirm pushes succeed, then revoke the old key.

#### Rotation Goals
- Minimize downtime (CI pushes must keep working).
- Avoid breaking old pipelines that still use the previous key.
- Provide an audit trail of when keys were created and revoked.

#### Prerequisites
To enforce key validation, the dashboard must verify keys against the `api_keys` table. The current API route accepts any non-empty key for MVP use. For production, enable database-backed validation (see next section).

#### Rotation Plan (Safe, No-Downtime)
1. **Create a new key** and add it to the dashboard's `api_keys` table as `active = 1`.
2. **Update CI secrets** in every repo to use the new key.
3. **Watch dashboard traffic** to confirm all repos are pushing successfully with the new key.
4. **Deactivate the old key** by setting `active = 0` (or deleting it).
5. **Re-test one pipeline** to ensure pushes still succeed after revocation.

#### Example Timeline
- Day 0: Add new key, start updating CI secrets.
- Day 1-3: Monitor push success across all repos.
- Day 4: Revoke the old key after confirmation.

#### Operational Checklist
- All repos updated in CI secrets
- At least one successful push from every repo with new key
- Old key disabled in the database
- Incident plan: re-enable old key if any repo still uses it

#### Recommended Key Policy
- **Unique keys per environment** (dev, staging, prod)
- **Unique keys per org or team** for clearer auditability
- **Rotate quarterly** (or after personnel changes)
- **Never reuse revoked keys**

#### How to Store Keys in CI
- Use secrets stores (GitHub Actions Secrets, Azure DevOps Variable Groups, Jenkins Credentials)
- Do not commit keys to source control
- Scope keys to the minimum required repos and environments

#### Enabling Database-Backed Key Validation (Production)
The API route currently accepts any non-empty key for MVP. To enforce `api_keys` checks:

1. Add hashed keys to the `api_keys` table.
2. Update `dashboard/src/app/api/scans/route.ts` to hash the incoming key and compare against `api_keys.key_hash` where `active = 1`.
3. Reject pushes when the key is missing or inactive.

Suggested schema behavior:
- Store **only hashes**, never raw API keys
- Include a `label` column for human-friendly tracking (e.g., `prod-ci`, `team-qa`)
- Use `active = 0` to revoke keys without deleting history

#### Emergency Revocation Procedure
If a key is leaked:
1. Set `active = 0` for the compromised key immediately.
2. Generate a new key and update all CI secrets.
3. Review dashboard logs for unexpected pushes.

### Data Privacy

- **Local mode:** The SQLite database contains finding titles, descriptions, recommendations, and code snippets from scanned repos. Audit data stays on your infrastructure — nothing is sent to external services. The dashboard is fully self-contained with no telemetry or phone-home behavior.
- **Hub mode:** Scan results are POSTed to your own Hub service over your internal network (or TLS-secured endpoint). The data stays within your infrastructure — nothing is sent to third-party services.

## Database

### Local Mode — SQLite
In local/self-hosted deployments, the dashboard uses SQLite — a serverless, zero-configuration database stored as a single file at `scantrix.db`.

- No database server required — no Postgres, MySQL, or MongoDB to install or maintain
- Automatic schema creation — the database and tables are created automatically on first start
- Backup — copy the single `.db` file to back up all data
- Custom location — set the `DATABASE_PATH` environment variable (or `SCANTRIX_SQLITE_PATH` for the CLI sink) to store the database elsewhere:

```bash
DATABASE_PATH=/var/data/scantrix.db npm run start
```

### Hub Mode — Postgres
In hub/multi-pipeline deployments, the **Hub service** owns a Postgres database. The CLI does not connect to Postgres — it POSTs `ScanResult` JSON to the Hub ingestion endpoint, and the Hub writes to Postgres.

- Postgres is managed by the Hub service, not by the CLI or the dashboard
- The dashboard connects to Postgres in read-only mode to display results
- Standard Postgres backup and HA strategies apply

### Database Schema (SQLite — Local Mode)

| Table | Purpose |
|-------|---------|
| repos | One row per unique repo name |
| scans | One row per push (timestamp, finding counts, grade, inventory JSON) |
| findings | Individual findings per scan (severity, evidence, recommendations) |
| api_keys | API keys for authenticating push requests |

### Database Schema (Postgres — Hub Mode)

The Hub service manages its own schema. Refer to the Hub deployment documentation for Postgres table definitions. The logical structure mirrors the SQLite schema (repos, scans, findings) with additional fields for multi-tenancy and audit trails.

## Frequently Asked Questions

**Q: Do I need to install the dashboard in every repo?**
No. The dashboard is deployed once. Each repo only needs the Scantrix CLI scanner (as a devDependency or via the GitHub Action).

**Q: Can I run the dashboard on my laptop?**
Yes - `cd dashboard && npm run dev` starts it locally on port 3000. Great for evaluation. For team use, deploy it on a shared server.

**Q: Does the dashboard need internet access?**
No. It works fully offline and air-gapped. The only network requirement is that CI pipelines can reach it over your internal network.

**Q: What happens if the dashboard is down when a pipeline tries to push?**
The push command will fail with a connection error, but the scan still completes and the report files are still written locally. You can re-push later using `scantrix push <findings.json>`.

**Q: How much disk space does the database use?**
Approximately 1 MB per 100 scans. A team scanning 10 repos daily would use ~36 MB per year.

**Q: Can multiple people view the dashboard at the same time?**
Yes. Next.js handles concurrent HTTP requests. SQLite in WAL mode supports concurrent reads while a write is in progress.

**Q: Is there user authentication for the dashboard UI?**
Not yet. The dashboard UI is currently open to anyone who can reach it. Place it behind your corporate VPN or reverse proxy with SSO for access control. User authentication is planned for a future release.

**Q: Can I use this with Cypress or Selenium repos too?**
Yes. Scantrix supports Playwright, Cypress, and Selenium. The scanner auto-detects which framework(s) are present and applies the appropriate rules. All three frameworks push to the same dashboard.

**Q: What is the difference between local mode and hub mode?**
Local mode (`--sink local`) writes results to JSON files and optionally to a local SQLite database. This is ideal for single-team setups or self-hosted dashboards. Hub mode (`--sink hub`) POSTs the `ScanResult` JSON to a central Hub ingestion API, which writes to Postgres. Use hub mode when you have many pipelines across repos or teams and need centralized, Postgres-backed storage.

**Q: Does the CLI connect to Postgres in hub mode?**
No. In hub mode, the CLI only makes an HTTP POST to the Hub ingestion endpoint. The Hub service owns the Postgres connection. The CLI never touches Postgres directly.

**Q: Can I use both sinks at the same time?**
JSON files are always written regardless of the sink mode. In local mode, you additionally get SQLite. In hub mode, you additionally get the HTTP POST to the Hub. You cannot write to both SQLite and Hub in a single run — choose one based on your deployment model.

**Q: Do I need to change my existing pipelines when upgrading to v5.0.0?**
No. The existing `push` subcommand still works exactly as before. The new sink architecture is opt-in. You can migrate pipelines to the sink-based approach at your own pace.

**Q: What does the ScanResult JSON contain?**
The canonical `ScanResult` includes: tool name, version, runId, timestamps (start/end), repo metadata (name, branch, commit), findings array, summary (counts and grade), and full repo inventory. This is the same structure regardless of which sink consumes it.
