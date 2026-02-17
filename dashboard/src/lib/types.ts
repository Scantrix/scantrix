/**
 * Shared types for the Qaverity Dashboard API and frontend.
 */

export interface Repo {
  id: number;
  name: string;
  url?: string;
  created_at: string;
  updated_at: string;
  last_scan?: ScanSummary;
}

export interface ScanSummary {
  id: number;
  repo_id: number;
  scanned_at: string;
  findings_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score?: number;
  risk_grade?: string;
}

export interface ScanDetail extends ScanSummary {
  findings: FindingRecord[];
}

export interface FindingRecord {
  id: number;
  scan_id: number;
  finding_id: string;
  severity: "low" | "medium" | "high";
  title: string;
  description?: string;
  recommendation?: string;
  evidence_count: number;
}

export interface TrendPoint {
  scanned_at: string;
  findings_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score?: number;
}

export interface RepoComparison {
  repo_name: string;
  latest_grade: string;
  findings_count: number;
  high_count: number;
  trend_direction: "improving" | "degrading" | "stable";
}

export interface PushPayload {
  repoName: string;
  findings: Array<{
    findingId: string;
    severity: "low" | "medium" | "high";
    title: string;
    description: string;
    recommendation: string;
    evidence: Array<{ file: string; line: number; snippet: string }>;
  }>;
  timestamp: string;
  findingsCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}
