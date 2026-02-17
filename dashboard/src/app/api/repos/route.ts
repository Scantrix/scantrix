import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/repos — List all tracked repositories with their latest scan info.
 */
export async function GET(_request: NextRequest) {
  try {
    const db = getDb();

    const repos = db
      .prepare(
        `SELECT r.*,
                s.id as last_scan_id,
                s.scanned_at as last_scanned_at,
                s.findings_count,
                s.high_count,
                s.medium_count,
                s.low_count,
                s.risk_score,
                s.risk_grade
         FROM repos r
         LEFT JOIN scans s ON s.id = (
           SELECT id FROM scans WHERE repo_id = r.id ORDER BY scanned_at DESC LIMIT 1
         )
         ORDER BY r.updated_at DESC`,
      )
      .all();

    return NextResponse.json({ repos });
  } catch (err: any) {
    console.error("[api/repos] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
