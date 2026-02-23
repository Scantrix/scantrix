import fs from "fs/promises";
import path from "path";
import type { ScanResult } from "../scanResult";
import type { Sink } from "./types";

/**
 * Persists the {@link ScanResult} into a local SQLite database.
 *
 * Requires `better-sqlite3` to be installed (`npm i better-sqlite3`).
 * The package is loaded dynamically so the tool can still run in
 * hub-only / CI mode without the native dependency.
 *
 * Schema: one table `scan_results` with indexed columns for common
 * queries and a `payload` TEXT column holding the full JSON for
 * lossless retrieval.
 */
export class SqliteSink implements Sink {
  readonly name = "sqlite";

  constructor(private readonly dbPath: string) {}

  async write(result: ScanResult): Promise<void> {
    // Dynamic require — better-sqlite3 is an optional dependency
    let Database: any;
    try {
      Database = require("better-sqlite3");
    } catch {
      throw new Error(
        "SQLite sink requires 'better-sqlite3'. Install it with:\n" +
          "  npm install better-sqlite3",
      );
    }

    const abs = path.resolve(this.dbPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });

    const db = new Database(abs);
    try {
      db.pragma("journal_mode = WAL");

      db.exec(`
        CREATE TABLE IF NOT EXISTS scan_results (
          run_id       TEXT PRIMARY KEY,
          repo_name    TEXT NOT NULL,
          branch       TEXT,
          commit_sha   TEXT,
          started_at   TEXT NOT NULL,
          completed_at TEXT NOT NULL,
          risk_score   INTEGER,
          risk_grade   TEXT,
          total        INTEGER,
          high         INTEGER,
          medium       INTEGER,
          low          INTEGER,
          payload      TEXT NOT NULL
        )
      `);

      const insert = db.prepare(`
        INSERT OR REPLACE INTO scan_results
          (run_id, repo_name, branch, commit_sha, started_at, completed_at,
           risk_score, risk_grade, total, high, medium, low, payload)
        VALUES
          (@runId, @repoName, @branch, @commitSha, @startedAt, @completedAt,
           @riskScore, @riskGrade, @total, @high, @medium, @low, @payload)
      `);

      insert.run({
        runId: result.runId,
        repoName: result.repo.name,
        branch: result.repo.branch ?? null,
        commitSha: result.repo.commit ?? null,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        riskScore: result.summary.riskScore,
        riskGrade: result.summary.riskGrade,
        total: result.summary.total,
        high: result.summary.high,
        medium: result.summary.medium,
        low: result.summary.low,
        payload: JSON.stringify(result),
      });
    } finally {
      db.close();
    }
  }
}
