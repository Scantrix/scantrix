"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushFindings = pushFindings;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const scoring_1 = require("./scoring");
/**
 * Push scan findings to the Qaverity dashboard API.
 *
 * POST <apiUrl>/api/scans
 * Headers: Authorization: Bearer <apiKey>
 * Body: { repoName, findings, timestamp }
 */
async function pushFindings(options) {
    const { apiUrl, apiKey, repoName, findings } = options;
    const url = new URL("/api/scans", apiUrl);
    // Compute score & grade from the canonical scoring module so the dashboard
    // receives the exact same values as the CLI report.
    const risk = (0, scoring_1.calculateRiskScore)(findings);
    const body = JSON.stringify({
        repoName: repoName ?? inferRepoName(),
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
    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https_1.default : http_1.default;
        const req = transport.request(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "User-Agent": "qaverity-cli",
                "Content-Length": Buffer.byteLength(body),
            },
        }, (res) => {
            const { statusCode } = res;
            const chunks = [];
            res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on("end", () => {
                if (statusCode && statusCode >= 200 && statusCode < 300) {
                    resolve();
                }
                else {
                    const responseBody = Buffer.concat(chunks).toString("utf8");
                    reject(new Error(`Push failed with HTTP ${statusCode ?? "(unknown)"}: ${responseBody}`));
                }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}
/**
 * Infer the repository name from environment variables or cwd.
 */
function inferRepoName() {
    // GitHub Actions
    if (process.env.GITHUB_REPOSITORY)
        return process.env.GITHUB_REPOSITORY;
    // Azure DevOps
    if (process.env.BUILD_REPOSITORY_NAME)
        return process.env.BUILD_REPOSITORY_NAME;
    // Fall back to current directory name
    const cwd = process.cwd();
    return cwd.split(/[/\\]/).pop() || "unknown";
}
