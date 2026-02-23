import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/repos/[name] — Return full details for a single repository:
 *   - repo metadata
 *   - scan summary (latest, or specific scan via ?scan=<id>)
 *   - all findings from the selected scan (with evidence)
 *   - scan history for mini-trend
 *
 * Query params:
 *   ?scan=<id>  — load a specific scan instead of the latest
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } },
) {
  const repoName = decodeURIComponent(params.name);
  const { searchParams } = new URL(request.url);
  const scanIdParam = searchParams.get("scan");

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

    // ── Selected scan (specific or latest) ──
    let selectedScan: Record<string, unknown> | undefined;

    if (scanIdParam) {
      const scanId = parseInt(scanIdParam, 10);
      if (Number.isNaN(scanId) || scanId < 1) {
        return NextResponse.json(
          { error: "Invalid scan ID" },
          { status: 400 },
        );
      }
      // Load specific scan, verify it belongs to this repo
      selectedScan = db
        .prepare(
          `SELECT * FROM scans
           WHERE id = ? AND repo_id = ?`,
        )
        .get(scanId, repo.id) as Record<string, unknown> | undefined;

      if (!selectedScan) {
        return NextResponse.json(
          { error: `Scan ${scanId} not found for repository "${repoName}"` },
          { status: 404 },
        );
      }
    } else {
      selectedScan = db
        .prepare(
          `SELECT * FROM scans
           WHERE repo_id = ?
           ORDER BY scanned_at DESC
           LIMIT 1`,
        )
        .get(repo.id) as Record<string, unknown> | undefined;
    }

    // Parse inventory/config from summary_json
    let inventory: unknown = null;
    if (selectedScan?.summary_json) {
      try {
        inventory = JSON.parse(selectedScan.summary_json as string);
      } catch { /* corrupt JSON — skip */ }
    }

    // ── Findings for selected scan ──
    let findings: Record<string, unknown>[] = [];
    if (selectedScan) {
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
        .all(selectedScan.id as number) as Record<string, unknown>[];

      // Parse evidence JSON for each finding
      findings = rawFindings.map((f) => ({
        ...f,
        evidence: f.evidence_json ? JSON.parse(f.evidence_json as string) : [],
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
      latestScan: selectedScan
        ? {
            id: selectedScan.id,
            scanned_at: selectedScan.scanned_at,
            findings_count: selectedScan.findings_count,
            high_count: selectedScan.high_count,
            medium_count: selectedScan.medium_count,
            low_count: selectedScan.low_count,
            risk_score: selectedScan.risk_score,
            risk_grade: selectedScan.risk_grade,
          }
        : null,
      isHistorical: !!scanIdParam,
      findings,
      inventory,
      scanHistory,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[api/repos/${repoName}] Error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/repos/[name] — Delete a repository and all its scans + findings.
 *
 * Performs a transactional delete:
 *   1. Delete all findings belonging to the repo's scans
 *   2. Delete all scans belonging to the repo
 *   3. Delete the repo row itself
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { name: string } },
) {
  const repoName = decodeURIComponent(params.name);

  try {
    const db = getDb();

    const repo = db
      .prepare(`SELECT id FROM repos WHERE name = ?`)
      .get(repoName) as { id: number } | undefined;

    if (!repo) {
      return NextResponse.json(
        { error: `Repository "${repoName}" not found` },
        { status: 404 },
      );
    }

    const deleteAll = db.transaction(() => {
      // 1. Delete findings for every scan that belongs to this repo
      db.prepare(
        `DELETE FROM findings
         WHERE scan_id IN (SELECT id FROM scans WHERE repo_id = ?)`,
      ).run(repo.id);

      // 2. Delete scans
      db.prepare(`DELETE FROM scans WHERE repo_id = ?`).run(repo.id);

      // 3. Delete the repo
      db.prepare(`DELETE FROM repos WHERE id = ?`).run(repo.id);
    });

    deleteAll();

    console.log(`[api/repos/${repoName}] Deleted repo id=${repo.id} and all associated data`);

    return NextResponse.json({ deleted: repoName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[api/repos/${repoName}] DELETE error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
