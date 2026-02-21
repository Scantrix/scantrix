import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/scans/[id] — Return full details for a single scan:
 *   - scan metadata (score, grade, severity counts)
 *   - repo name
 *   - all findings with parsed evidence
 *   - inventory (from summary_json)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const scanId = parseInt(params.id, 10);
  if (Number.isNaN(scanId) || scanId < 1) {
    return NextResponse.json(
      { error: "Invalid scan ID" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();

    // ── Scan row with repo name ──
    const scan = db
      .prepare(
        `SELECT s.*, r.name as repo_name
         FROM scans s
         JOIN repos r ON r.id = s.repo_id
         WHERE s.id = ?`,
      )
      .get(scanId) as Record<string, unknown> | undefined;

    if (!scan) {
      return NextResponse.json(
        { error: `Scan ${scanId} not found` },
        { status: 404 },
      );
    }

    // ── Parse inventory from summary_json ──
    let inventory: unknown = null;
    if (scan.summary_json) {
      try {
        inventory = JSON.parse(scan.summary_json as string);
      } catch { /* corrupt JSON — skip */ }
    }

    // ── Findings for this scan ──
    const rawFindings = db
      .prepare(
        `SELECT finding_id, severity, title, description, recommendation,
                evidence_count, evidence_json
         FROM findings
         WHERE scan_id = ?
         ORDER BY
           CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           evidence_count DESC`,
      )
      .all(scanId) as Array<Record<string, unknown>>;

    const findings = rawFindings.map((f) => ({
      ...f,
      evidence: f.evidence_json ? JSON.parse(f.evidence_json as string) : [],
      evidence_json: undefined,
    }));

    return NextResponse.json({
      scan: {
        id: scan.id,
        repo_id: scan.repo_id,
        repo_name: scan.repo_name,
        scanned_at: scan.scanned_at,
        findings_count: scan.findings_count,
        high_count: scan.high_count,
        medium_count: scan.medium_count,
        low_count: scan.low_count,
        risk_score: scan.risk_score,
        risk_grade: scan.risk_grade,
      },
      findings,
      inventory,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[api/scans/${scanId}] Error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
