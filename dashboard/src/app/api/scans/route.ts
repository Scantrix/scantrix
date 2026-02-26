import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * POST /api/scans — Receive findings from the CLI `scantrix push` command.
 *
 * Headers: Authorization: Bearer <api-key>
 * Body: { repoName, findings[], timestamp, findingsCount, highCount, mediumCount, lowCount }
 */
export async function POST(request: NextRequest) {
  // Validate API key (simple bearer token check)
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid API key" }, { status: 401 });
  }

  // In production, validate the key against api_keys table.
  // For MVP, accept any non-empty key.
  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return NextResponse.json({ error: "Empty API key" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repoName: rawRepoName, findings, timestamp, findingsCount, highCount, mediumCount, lowCount } = body;

  if (!rawRepoName || !Array.isArray(findings)) {
    return NextResponse.json(
      { error: "Missing required fields: repoName, findings" },
      { status: 400 },
    );
  }

  // Normalize repo name to lowercase to prevent case-sensitive duplicates
  const repoName = rawRepoName.trim().toLowerCase();

  try {
    const db = getDb();

    // Upsert repo
    db.prepare(
      `INSERT INTO repos (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET updated_at = datetime('now')`,
    ).run(repoName);

    const repo = db.prepare(`SELECT id FROM repos WHERE name = ?`).get(repoName) as { id: number };

    // Use the pre-computed risk score & grade from the CLI's canonical scoring
    // module when available. Fall back to a simple heuristic only for legacy
    // payloads that don't include them.
    const score = body.riskScore ?? ((highCount ?? 0) * 10 + (mediumCount ?? 0) * 4 + (lowCount ?? 0));
    const grade = body.riskGrade ??
      (score >= 80 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : score >= 15 ? "D" : "F");

    // Serialize inventory/config data into summary_json if provided
    const summaryJson = body.inventory ? JSON.stringify(body.inventory) : null;

    // Insert scan
    const scanResult = db
      .prepare(
        `INSERT INTO scans (repo_id, scanned_at, findings_count, high_count, medium_count, low_count, risk_score, risk_grade, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        repo.id,
        timestamp || new Date().toISOString(),
        findingsCount ?? findings.length,
        highCount ?? 0,
        mediumCount ?? 0,
        lowCount ?? 0,
        score,
        grade,
        summaryJson,
      );

    const scanId = scanResult.lastInsertRowid;

    // Insert findings
    const insertFinding = db.prepare(
      `INSERT INTO findings (scan_id, finding_id, severity, title, description, recommendation, evidence_count, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = db.transaction((items: any[]) => {
      for (const f of items) {
        insertFinding.run(
          scanId,
          f.findingId,
          f.severity,
          f.title,
          f.description ?? "",
          f.recommendation ?? "",
          f.evidence?.length ?? 0,
          JSON.stringify(f.evidence ?? []),
        );
      }
    });

    insertMany(findings);

    return NextResponse.json({
      success: true,
      scanId: Number(scanId),
      grade,
      findingsCount: findings.length,
    });
  } catch (err: any) {
    console.error("[api/scans] Error:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}

/**
 * GET /api/scans — List scans, optionally filtering by repo.
 * Query params: ?repo=<name>&limit=<n>
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoName = searchParams.get("repo");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  try {
    const db = getDb();

    if (repoName) {
      const scans = db
        .prepare(
          `SELECT s.*, r.name as repo_name
           FROM scans s
           JOIN repos r ON r.id = s.repo_id
           WHERE r.name = ?
           ORDER BY s.scanned_at DESC
           LIMIT ?`,
        )
        .all(repoName, limit);
      return NextResponse.json({ scans });
    }

    // All scans across all repos
    const scans = db
      .prepare(
        `SELECT s.*, r.name as repo_name
         FROM scans s
         JOIN repos r ON r.id = s.repo_id
         ORDER BY s.scanned_at DESC
         LIMIT ?`,
      )
      .all(limit);

    return NextResponse.json({ scans });
  } catch (err: any) {
    console.error("[api/scans] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
