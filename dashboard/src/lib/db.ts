import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "scantrix.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Auto-init schema
  initSchema(db);

  // Run data migrations
  runMigrations(db);

  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      url         TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id         INTEGER NOT NULL REFERENCES repos(id),
      scanned_at      TEXT NOT NULL DEFAULT (datetime('now')),
      findings_count  INTEGER NOT NULL DEFAULT 0,
      high_count      INTEGER NOT NULL DEFAULT 0,
      medium_count    INTEGER NOT NULL DEFAULT 0,
      low_count       INTEGER NOT NULL DEFAULT 0,
      risk_score      REAL,
      risk_grade      TEXT,
      summary_json    TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id         INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      finding_id      TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK(severity IN ('low','medium','high')),
      title           TEXT NOT NULL,
      description     TEXT,
      recommendation  TEXT,
      evidence_count  INTEGER NOT NULL DEFAULT 0,
      evidence_json   TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash    TEXT NOT NULL UNIQUE,
      label       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      active      INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_scans_repo     ON scans(repo_id, scanned_at);
    CREATE INDEX IF NOT EXISTS idx_findings_scan  ON findings(scan_id);
    CREATE INDEX IF NOT EXISTS idx_findings_rule  ON findings(finding_id);
  `);
}

/**
 * Run idempotent data migrations, tracked via the _migrations table.
 */
function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  const applied = (name: string): boolean => {
    const row = db.prepare(`SELECT 1 FROM _migrations WHERE name = ?`).get(name);
    return !!row;
  };

  // ── health_score_v1: convert old unbounded risk points to 0-100 health scores ──
  if (!applied("health_score_v1")) {
    db.transaction(() => {
      // Convert existing risk_score values (higher=worse) to health scores (0-100, higher=better).
      // Formula: ROUND(100 * EXP(-old_risk_score / 80.0))
      // Only convert rows where risk_score > 100 (clearly old-format) or risk_score IS NOT NULL.
      db.exec(`
        UPDATE scans
        SET risk_score = ROUND(100.0 * EXP(-risk_score / 80.0))
        WHERE risk_score IS NOT NULL
      `);
      db.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run("health_score_v1");
    })();
  }
}
