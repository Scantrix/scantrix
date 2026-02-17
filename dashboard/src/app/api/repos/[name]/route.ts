import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/repos/[name] — Return full details for a single repository:
 *   - repo metadata
 *   - latest scan summary
 *   - all findings from the latest scan (with evidence)
 *   - scan history for mini-trend
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } },
) {
  const repoName = decodeURIComponent(params.name);

  try {
    const db = getDb();

    // ── Repo row ──
    const repo = db
      .prepare(`SELECT * FROM repos WHERE name = ?`)
      .get(repoName) as any | undefined;

    if (!repo) {
      return NextResponse.json(
        { error: `Repository "${repoName}" not found` },
        { status: 404 },
      );
    }

    // ── Latest scan ──
    const latestScan = db
      .prepare(
        `SELECT * FROM scans
         WHERE repo_id = ?
         ORDER BY scanned_at DESC
         LIMIT 1`,
      )
      .get(repo.id) as any | undefined;

    // Parse inventory/config from summary_json
    let inventory: any = null;
    if (latestScan?.summary_json) {
      try {
        inventory = JSON.parse(latestScan.summary_json);
      } catch { /* corrupt JSON — skip */ }
    }

    // ── Findings for latest scan ──
    let findings: any[] = [];
    if (latestScan) {
      findings = db
        .prepare(
          `SELECT finding_id, severity, title, description, recommendation,
                  evidence_count, evidence_json
           FROM findings
           WHERE scan_id = ?
           ORDER BY
             CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
             evidence_count DESC`,
        )
        .all(latestScan.id);

      // Parse evidence JSON for each finding
      findings = findings.map((f: any) => ({
        ...f,
        evidence: f.evidence_json ? JSON.parse(f.evidence_json) : [],
        evidence_json: undefined,
      }));
    }

    // ── Scan history (last 20 scans for mini-trend) ──
    const scanHistory = db
      .prepare(
        `SELECT id, scanned_at, findings_count, high_count, medium_count,
                low_count, risk_score, risk_grade
         FROM scans
         WHERE repo_id = ?
         ORDER BY scanned_at DESC
         LIMIT 20`,
      )
      .all(repo.id);

    return NextResponse.json({
      repo: {
        id: repo.id,
        name: repo.name,
        url: repo.url,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
      },
      latestScan: latestScan
        ? {
            id: latestScan.id,
            scanned_at: latestScan.scanned_at,
            findings_count: latestScan.findings_count,
            high_count: latestScan.high_count,
            medium_count: latestScan.medium_count,
            low_count: latestScan.low_count,
            risk_score: latestScan.risk_score,
            risk_grade: latestScan.risk_grade,
          }
        : null,
      findings,
      inventory,
      scanHistory,
    });
  } catch (err: any) {
    console.error(`[api/repos/${repoName}] Error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
