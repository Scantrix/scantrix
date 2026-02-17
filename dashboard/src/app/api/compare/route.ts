import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/compare
 *
 * Compare latest scores across all repos for the comparison table.
 */
export async function GET(_request: NextRequest) {
  try {
    const db = getDb();

    const repos = db
      .prepare(
        `SELECT r.name as repo_name,
                latest.risk_grade as latest_grade,
                latest.findings_count,
                latest.high_count,
                latest.risk_score as latest_score,
                prev.risk_score as prev_score
         FROM repos r
         JOIN scans latest ON latest.id = (
           SELECT id FROM scans WHERE repo_id = r.id ORDER BY scanned_at DESC LIMIT 1
         )
         LEFT JOIN scans prev ON prev.id = (
           SELECT id FROM scans WHERE repo_id = r.id ORDER BY scanned_at DESC LIMIT 1 OFFSET 1
         )
         ORDER BY latest.risk_score DESC`,
      )
      .all() as Array<{
        repo_name: string;
        latest_grade: string;
        findings_count: number;
        high_count: number;
        latest_score: number | null;
        prev_score: number | null;
      }>;

    const comparison = repos.map((r) => ({
      repo_name: r.repo_name,
      latest_grade: r.latest_grade ?? "?",
      findings_count: r.findings_count,
      high_count: r.high_count,
      trend_direction:
        r.prev_score === null
          ? "stable"
          : (r.latest_score ?? 0) < (r.prev_score ?? 0)
            ? "improving"
            : (r.latest_score ?? 0) > (r.prev_score ?? 0)
              ? "degrading"
              : "stable",
    }));

    return NextResponse.json({ comparison });
  } catch (err: any) {
    console.error("[api/compare] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
