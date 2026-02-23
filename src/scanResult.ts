import { randomUUID } from "crypto";
import type { Finding, Inventory, ScanResults } from "./scanner";
import { calculateRiskScore } from "./scoring";

/**
 * Canonical scan-result contract.
 *
 * Every scan run emits exactly one ScanResult.  All sinks (JSON file,
 * SQLite, Hub HTTP POST) consume this identical shape, ensuring a
 * consistent artifact regardless of execution environment.
 */
export interface ScanResult {
  /** Tool identifier — always "scantrix" */
  tool: string;
  /** Tool version (from package.json) */
  version: string;
  /** Unique run identifier (UUID v4) */
  runId: string;
  /** ISO-8601 timestamp when the scan started */
  startedAt: string;
  /** ISO-8601 timestamp when the scan completed */
  completedAt: string;

  /** Repository metadata */
  repo: {
    /** Absolute path to the scanned repository */
    path: string;
    /** Repository name (directory basename or inferred) */
    name: string;
    /** Git branch at time of scan */
    branch?: string;
    /** Short Git commit SHA at time of scan */
    commit?: string;
  };

  /** Audit findings */
  findings: Finding[];

  /** Aggregate counts and risk assessment */
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    riskScore: number;
    riskGrade: string;
  };

  /** Repository inventory snapshot */
  inventory: Inventory;
}

/**
 * Build a canonical {@link ScanResult} from the raw scanner output.
 *
 * Call this after `scanRepo()` completes.  The function deterministically
 * maps the scanner's internal types to the stable external contract.
 */
export function buildScanResult(
  raw: ScanResults,
  opts: { version: string; startedAt: string; repoPath?: string },
): ScanResult {
  const risk = calculateRiskScore(raw.findings);
  const effectivePath = opts.repoPath ?? raw.repoPath;
  const repoName = effectivePath.split(/[/\\]/).pop() || "unknown";

  return {
    tool: "scantrix",
    version: opts.version,
    runId: randomUUID(),
    startedAt: opts.startedAt,
    completedAt: new Date().toISOString(),
    repo: {
      path: effectivePath,
      name: repoName,
      branch: raw.gitBranch,
      commit: raw.gitCommit,
    },
    findings: raw.findings,
    summary: {
      total: raw.findings.length,
      high: raw.findings.filter(f => f.severity === "high").length,
      medium: raw.findings.filter(f => f.severity === "medium").length,
      low: raw.findings.filter(f => f.severity === "low").length,
      riskScore: risk.riskScore,
      riskGrade: risk.grade,
    },
    inventory: raw.inventory,
  };
}
