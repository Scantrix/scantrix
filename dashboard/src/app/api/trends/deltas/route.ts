import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/trends/deltas?repo=<name>&limit=<n>
 *
 * Compares consecutive scans for a repo (or all repos) and returns
 * which findings were resolved vs newly introduced, broken down by severity.
 */

interface FindingRow {
  finding_id: string;
  severity: string;
}

interface ScanRow {
  id: number;
  scanned_at: string;
  date: string;
}

interface DeltaEntry {
  scanned_at?: string;
  date: string;
  resolved_high: number;
  resolved_medium: number;
  resolved_low: number;
  new_high: number;
  new_medium: number;
  new_low: number;
}

function countSev(rows: FindingRow[], severity: string): number {
  return rows.filter((f) => f.severity === severity).length;
}

function computeDeltas(scans: ScanRow[], findingsStmt: any): DeltaEntry[] {
  return scans.map((scan, idx) => {
    const curr = findingsStmt.all(scan.id) as FindingRow[];
    const currIds = new Set(curr.map((f) => f.finding_id));

    if (idx === 0) {
      return {
        scanned_at: scan.scanned_at,
        date: scan.date,
        resolved_high: 0,
        resolved_medium: 0,
        resolved_low: 0,
        new_high: 0,
        new_medium: 0,
        new_low: 0,
      };
    }

    const prev = findingsStmt.all(scans[idx - 1].id) as FindingRow[];
    const prevIds = new Set(prev.map((f) => f.finding_id));

    const resolved = prev.filter((f) => !currIds.has(f.finding_id));
    const introduced = curr.filter((f) => !prevIds.has(f.finding_id));

    return {
      scanned_at: scan.scanned_at,
      date: scan.date,
      resolved_high: countSev(resolved, "high"),
      resolved_medium: countSev(resolved, "medium"),
      resolved_low: countSev(resolved, "low"),
      new_high: countSev(introduced, "high"),
      new_medium: countSev(introduced, "medium"),
      new_low: countSev(introduced, "low"),
    };
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoName = searchParams.get("repo");
  const limit = parseInt(searchParams.get("limit") ?? "30", 10);

  try {
    const db = getDb();
    const findingsStmt = db.prepare(
      `SELECT finding_id, severity FROM findings WHERE scan_id = ?`,
    );

    /* ── Per-repo ── */
    if (repoName) {
      const scans = db
        .prepare(
          `SELECT s.id, s.scanned_at, date(s.scanned_at) as date
           FROM scans s JOIN repos r ON r.id = s.repo_id
           WHERE r.name = ?
           ORDER BY s.scanned_at ASC
           LIMIT ?`,
        )
        .all(repoName, limit) as ScanRow[];

      return NextResponse.json({ repo: repoName, deltas: computeDeltas(scans, findingsStmt) });
    }

    /* ── Aggregate: per-repo deltas summed by date ── */
    const allScans = db
      .prepare(
        `SELECT s.id, s.scanned_at, date(s.scanned_at) as date, s.repo_id
         FROM scans s ORDER BY s.scanned_at ASC`,
      )
      .all() as (ScanRow & { repo_id: number })[];

    const byRepo = new Map<number, ScanRow[]>();
    for (const s of allScans) {
      if (!byRepo.has(s.repo_id)) byRepo.set(s.repo_id, []);
      byRepo.get(s.repo_id)!.push(s);
    }

    const aggByDate = new Map<string, DeltaEntry>();

    for (const [, scans] of byRepo) {
      const deltas = computeDeltas(scans, findingsStmt);
      for (const d of deltas) {
        if (!aggByDate.has(d.date)) {
          aggByDate.set(d.date, {
            date: d.date,
            resolved_high: 0,
            resolved_medium: 0,
            resolved_low: 0,
            new_high: 0,
            new_medium: 0,
            new_low: 0,
          });
        }
        const a = aggByDate.get(d.date)!;
        a.resolved_high += d.resolved_high;
        a.resolved_medium += d.resolved_medium;
        a.resolved_low += d.resolved_low;
        a.new_high += d.new_high;
        a.new_medium += d.new_medium;
        a.new_low += d.new_low;
      }
    }

    const deltas = [...aggByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([, d]) => d);

    return NextResponse.json({ repo: "all", deltas });
  } catch (err: any) {
    console.error("[api/trends/deltas] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
