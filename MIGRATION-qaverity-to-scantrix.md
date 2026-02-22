# Migration Guide: Qaverity → Scantrix

This document describes the complete rename of the product from **Qaverity** to **Scantrix** and lists every action required for operators, CI pipelines, and developers to transition.

---

## 1. Environment Variable Changes

| Old Variable            | New Variable             | Status                    |
| ----------------------- | ------------------------ | ------------------------- |
| `QAVERITY_API_URL`      | `SCANTRIX_API_URL`       | Aliased with deprecation  |
| `QAVERITY_API_KEY`      | `SCANTRIX_API_KEY`       | Aliased with deprecation  |
| `QAVERITY_REPO_NAME`    | `SCANTRIX_REPO_NAME`     | Aliased with deprecation  |

**Backward compatibility:** The CLI (`src/cli.ts`) checks for `SCANTRIX_*` first. If not found, it falls back to `QAVERITY_*` and emits a `[deprecation]` warning to stderr. Update your environment to use `SCANTRIX_*` variables at your earliest convenience.

### Action Required
- Update CI/CD secrets and environment variables in GitHub Actions, Azure DevOps, Jenkins, etc.
- Update `.env` files, Docker Compose configs, and Kubernetes ConfigMaps/Secrets.

---

## 2. Database Rename

| Old File                    | New File                     |
| --------------------------- | ---------------------------- |
| `dashboard/data/qaverity.db`| `dashboard/data/scantrix.db` |

The database file has been **copied** (not moved) — the original `qaverity.db` remains in place for safe rollback.

### Action Required
- The dashboard code (`dashboard/src/lib/db.ts`) now defaults to `data/scantrix.db`.
- If you set the `DATABASE_PATH` environment variable to an explicit path containing `qaverity.db`, update it to point to `scantrix.db`.
- Once confirmed working, you may delete `dashboard/data/qaverity.db`.

---

## 3. CI/CD & GitHub Actions

| Item                                | Change                                                   |
| ----------------------------------- | -------------------------------------------------------- |
| `action.yml` name                   | `Scantrix – Repo Audit Agent`                            |
| `action.yml` author                 | `scantrix-dev`                                           |
| Artifact names                      | `scantrix-audit-report`                                  |
| PR comment branding                 | `## 🔍 Scantrix Audit Summary`                           |
| Example workflow file               | Renamed to `.github/workflows/scantrix-example.txt`      |
| Output-dir default                  | `scantrix-audit-results`                                 |
| Environment variables in workflows  | `SCANTRIX_API_KEY`, `SCANTRIX_API_URL`, `SCANTRIX_REPO_NAME` |

### Action Required
- Update any workflows referencing the old action name or artifact names.
- Rename secrets from `QAVERITY_*` to `SCANTRIX_*` in your GitHub repository settings.
- If you copied the example workflow, update it from the new `scantrix-example.txt`.

---

## 4. Configuration Files

| File                          | Change                                                  |
| ----------------------------- | ------------------------------------------------------- |
| `dashboard/package.json`      | `name: "scantrix-dashboard"`                            |
| `dashboard/package-lock.json` | `name: "scantrix-dashboard"` (2 locations)              |
| `.auditrc.json` `$schema`     | `https://scantrix.com/schemas/auditrc.json`             |
| `src/pushClient.ts`           | `User-Agent: scantrix-cli`                              |

---

## 5. Asset & File Renames

### Old assets (`assets/old/`)
| Old Name                          | New Name                           |
| --------------------------------- | ---------------------------------- |
| `qaverity-logo-wide-original.svg` | `scantrix-logo-wide-original.svg`  |
| `qaverity-logo-wide.svg`          | `scantrix-logo-wide.svg`           |
| `qaverity-logo.svg`               | `scantrix-logo.svg`                |
| `qaverity-mark.svg`               | `scantrix-mark.svg`                |
| `qaverity.png`                    | `scantrix.png`                     |
| `qaverity2.png`                   | `scantrix2.png`                    |
| `qaverity3.png`                   | `scantrix3.png`                    |
| `qaverityLogo.png`                | `scantrixLogo.png`                 |

### Other files
| Old Name                 | New Name                  |
| ------------------------ | ------------------------- |
| `qaverityDBqueries.txt`  | `scantrixDBqueries.txt`   |

---

## 6. Documentation Updated

The following files had all `qaverity`/`Qaverity`/`QAVERITY` references replaced with `scantrix`/`Scantrix`/`SCANTRIX`:

- `readMe.md`
- `CHANGELOG.md`
- `PROJECT_CONTEXT.md`
- `repo_audit_agent_project_overview_handoff_guide.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/CI_INTEGRATION.md`

---

## 7. Validation Checklist

- [x] `npx vitest run` — 117 tests pass (10 test files)
- [x] `npx tsc --noEmit` — zero type errors (dashboard)
- [x] `git grep -rni qaverity` — only intentional backward-compat aliases remain in `src/cli.ts`
- [x] Database file copied successfully (1,519,616 bytes, verified)
- [x] All asset files renamed via `git mv`

---

## 8. Rollback Procedure

If you need to revert:

1. **Git:** `git revert <commit-sha>` to undo the rename commit.
2. **Database:** The original `dashboard/data/qaverity.db` is preserved. Restore the `DATABASE_PATH` or rename it back.
3. **Environment variables:** The `QAVERITY_*` aliases are still functional — no immediate breakage.
4. **CI secrets:** Re-add `QAVERITY_*` secrets if they were removed.

---

## 9. Timeline

| Phase | Action                             | Deadline        |
| ----- | ---------------------------------- | --------------- |
| Now   | Merge rename commit                | Immediate       |
| +1 wk | Update all CI/CD secrets           | Within 1 week   |
| +2 wk | Remove `QAVERITY_*` alias code     | Within 2 weeks  |
| +4 wk | Delete `qaverity.db` backup        | Within 1 month  |
