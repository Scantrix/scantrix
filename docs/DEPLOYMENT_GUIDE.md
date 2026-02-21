# Scantrix Deployment & Multi-Repo Setup Guide

This guide explains how Scantrix works across multiple repositories, how to deploy the dashboard, and how teams get a unified view of all their automation repos in one place.

---

## How Scantrix Works Across Multiple Repos

Scantrix has two components that work together:

| Component | What It Does | Where It Runs |
|-----------|-------------|---------------|
| **Scantrix CLI** (scanner) | Scans a repo's test code, config, and CI pipelines. Produces findings and reports. | Inside each repo's CI pipeline |
| **Scantrix Dashboard** (web app) | Central web interface that collects, stores, and visualizes results from all repos. | One shared server |

### The Key Concept: Scan Locally, Push Centrally

Each repository runs its own scan in its own CI pipeline. After the scan completes, the `push` command sends the results over HTTP to the single shared dashboard. The dashboard stores everything in its database and provides a unified view.

```
┌─────────────────────┐
│ Repo A - CI build   │──scan──► findings.json ──push──┐
└─────────────────────┘                               │
┌─────────────────────┐                               │    ┌──────────────────────┐
│ Repo B - CI build   │──scan──► findings.json ──push──┼───►│ Scantrix Dashboard    │
└─────────────────────┘                               │    │ (single instance)     │
┌─────────────────────┐                               │    │  ┌─────────────────┐  │
│ Repo C - CI build   │──scan──► findings.json ──push──┘    │  │   SQLite DB     │  │
└─────────────────────┘                                    │  │  (all repos)    │  │
                                                           │  └─────────────────┘  │
                                                           └──────────────────────┘
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
| External database | None - SQLite is embedded, no Postgres/MySQL/Mongo needed |
| External services | None - fully self-contained, works offline/air-gapped |

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

- The SQLite database contains finding titles, descriptions, recommendations, and code snippets from scanned repos
- Audit data stays on your infrastructure - nothing is sent to external services
- The dashboard is fully self-contained with no telemetry or phone-home behavior

## Database
The dashboard uses SQLite - a serverless, zero-configuration database stored as a single file at `scantrix.db`.

- No database server required - no Postgres, MySQL, or MongoDB to install or maintain
- Automatic schema creation - the database and tables are created automatically on first start
- Backup - copy the single `.db` file to back up all data
- Custom location - set the `DATABASE_PATH` environment variable to store the database elsewhere:

```bash
DATABASE_PATH=/var/data/scantrix.db npm run start
```

### Database Schema

| Table | Purpose |
|-------|---------|
| repos | One row per unique repo name |
| scans | One row per push (timestamp, finding counts, grade, inventory JSON) |
| findings | Individual findings per scan (severity, evidence, recommendations) |
| api_keys | API keys for authenticating push requests |

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
