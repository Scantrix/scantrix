import https from "https";
import http from "http";
import type { Finding } from "./scanner";
import { calculateRiskScore } from "./scoring";

export interface PushOptions {
  apiUrl: string;
  apiKey: string;
  repoName?: string;
  findings: Finding[];
  inventory?: Record<string, any>;
}

/**
 * Push scan findings to the Scantrix dashboard API.
 *
 * POST <apiUrl>/api/scans
 * Headers: Authorization: Bearer <apiKey>
 * Body: { repoName, findings, timestamp }
 */
export async function pushFindings(options: PushOptions): Promise<void> {
  const { apiUrl, apiKey, repoName, findings } = options;
  const url = new URL("/api/scans", apiUrl);

  // Compute score & grade from the canonical scoring module so the dashboard
  // receives the exact same values as the CLI report.
  const inv = options.inventory;
  const scoreInv = inv && typeof inv.testFiles === "number"
    ? {
        testFiles: inv.testFiles,
        cypressTestFiles: typeof inv.cypressTestFiles === "number" ? inv.cypressTestFiles : undefined,
        seleniumTestFiles: typeof inv.seleniumTestFiles === "number" ? inv.seleniumTestFiles : undefined,
      }
    : undefined;
  const risk = calculateRiskScore(findings, scoreInv);

  const body = JSON.stringify({
    repoName: (repoName ?? inferRepoName()).toLowerCase(),
    findings,
    timestamp: new Date().toISOString(),
    findingsCount: findings.length,
    highCount: findings.filter((f) => f.severity === "high").length,
    mediumCount: findings.filter((f) => f.severity === "medium").length,
    lowCount: findings.filter((f) => f.severity === "low").length,
    riskScore: risk.riskScore,
    riskGrade: risk.grade,
    inventory: options.inventory,
  });

  return new Promise<void>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "scantrix-cli",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const { statusCode } = res;
        const chunks: Buffer[] = [];
        res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on("end", () => {
          if (statusCode && statusCode >= 200 && statusCode < 300) {
            resolve();
          } else {
            const responseBody = Buffer.concat(chunks).toString("utf8");
            reject(
              new Error(
                `Push failed with HTTP ${statusCode ?? "(unknown)"}: ${responseBody}`,
              ),
            );
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Infer the repository name from environment variables or cwd.
 */
function inferRepoName(): string {
  // GitHub Actions
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  // Azure DevOps
  if (process.env.BUILD_REPOSITORY_NAME) return process.env.BUILD_REPOSITORY_NAME;
  // Fall back to current directory name
  const cwd = process.cwd();
  return cwd.split(/[/\\]/).pop() || "unknown";
}
