import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/trends?repo=<name>&limit=<n>
 *
 * Returns historical scan data for trending charts.
 *
 * Per-repo mode: returns one row per scan in chronological order.
 * Aggregate mode (no repo): computes the rolling portfolio state at each
 * scan date — i.e. the average of every repo's *latest known* score as of
 * that date, not just the scans that happened on that date.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoName = searchParams.get("repo");
  const limit = parseInt(searchParams.get("limit") ?? "30", 10);

  try {
    const db = getDb();

    if (repoName) {
      const trends = db
        .prepare(
          `SELECT s.id as scan_id, s.scanned_at, date(s.scanned_at) as date, s.findings_count, s.high_count, s.medium_count,
                  s.low_count, s.risk_score, s.risk_grade,
                  COALESCE(
                    (SELECT COUNT(DISTINCT json_extract(je.value, '$.file'))
                     FROM findings f, json_each(f.evidence_json) je
                     WHERE f.scan_id = s.id AND f.evidence_json IS NOT NULL AND f.evidence_json != '[]'),
                    0
                  ) as files_affected
           FROM scans s
           JOIN repos r ON r.id = s.repo_id
           WHERE r.name = ?
           ORDER BY s.scanned_at ASC
           LIMIT ?`,
        )
        .all(repoName, limit);

      return NextResponse.json({ repo: repoName, trends });
    }

    // ── Aggregate trend: rolling portfolio state ──
    // For each unique scan date, compute the portfolio-wide totals/averages
    // using each repo's *latest* scan as-of that date.  This prevents the
    // average from spiking when only one repo is scanned on a given day.
    interface ScanRow {
      repo_id: number;
      scanned_at: string;
      date: string;
      findings_count: number;
      high_count: number;
      medium_count: number;
      low_count: number;
      risk_score: number;
    }

    const allScans = db
      .prepare(
        `SELECT s.repo_id, s.scanned_at, date(s.scanned_at) as date,
                s.findings_count, s.high_count, s.medium_count, s.low_count,
                s.risk_score
         FROM scans s
         ORDER BY s.scanned_at ASC`,
      )
      .all() as ScanRow[];

    // Build rolling latest-per-repo state; capture the portfolio snapshot
    // at each unique date (last write wins for same date).
    const latestByRepo = new Map<number, ScanRow>();
    const stateByDate = new Map<string, {
      date: string;
      total_findings: number;
      total_high: number;
      total_medium: number;
      total_low: number;
      avg_risk_score: number;
      total_files_affected: number;
    }>();

    for (const scan of allScans) {
      latestByRepo.set(scan.repo_id, scan);

      const values = [...latestByRepo.values()];
      const n = values.length;
      stateByDate.set(scan.date, {
        date: scan.date,
        total_findings: values.reduce((s, v) => s + v.findings_count, 0),
        total_high: values.reduce((s, v) => s + v.high_count, 0),
        total_medium: values.reduce((s, v) => s + v.medium_count, 0),
        total_low: values.reduce((s, v) => s + v.low_count, 0),
        avg_risk_score: values.reduce((s, v) => s + v.risk_score, 0) / n,
        total_files_affected: 0, // computed per-scan is expensive; omit for aggregate
      });
    }

    const trends = [...stateByDate.values()].slice(-limit);

    return NextResponse.json({ repo: "all", trends });
  } catch (err: any) {
    console.error("[api/trends] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
