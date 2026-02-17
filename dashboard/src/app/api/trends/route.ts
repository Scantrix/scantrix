import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/trends?repo=<name>&limit=<n>
 *
 * Returns historical scan data for trending charts.
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
          `SELECT s.scanned_at, date(s.scanned_at) as date, s.findings_count, s.high_count, s.medium_count,
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

    // Aggregate trend across all repos (total findings over time)
    const trends = db
      .prepare(
        `SELECT date(s.scanned_at) as date,
                SUM(s.findings_count) as total_findings,
                SUM(s.high_count) as total_high,
                SUM(s.medium_count) as total_medium,
                SUM(s.low_count) as total_low,
                AVG(s.risk_score) as avg_risk_score,
                COALESCE(
                  (SELECT COUNT(DISTINCT json_extract(je.value, '$.file'))
                   FROM findings f
                   JOIN scans s2 ON s2.id = f.scan_id
                   , json_each(f.evidence_json) je
                   WHERE date(s2.scanned_at) = date(s.scanned_at)
                     AND f.evidence_json IS NOT NULL AND f.evidence_json != '[]'),
                  0
                ) as total_files_affected
         FROM scans s
         GROUP BY date(s.scanned_at)
         ORDER BY date ASC
         LIMIT ?`,
      )
      .all(limit);

    return NextResponse.json({ repo: "all", trends });
  } catch (err: any) {
    console.error("[api/trends] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
