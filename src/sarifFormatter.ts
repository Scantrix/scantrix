import type { ScanResults, Finding } from "./scanner";

type SarifSeverity = "error" | "warning" | "note";

function toSarifLevel(severity: "low" | "medium" | "high"): SarifSeverity {
  switch (severity) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
  }
}

/**
 * Convert ScanResults into a SARIF 2.1.0 document.
 * Usable with GitHub Code Scanning, Azure DevOps, and VS Code SARIF Viewer.
 */
export function toSarif(results: ScanResults): object {
  const repoPath = results.repoPath.replace(/\\/g, "/");

  // Deduplicate rules by findingId
  const seenRuleIds = new Set<string>();
  const rules: object[] = [];
  for (const f of results.findings) {
    if (seenRuleIds.has(f.findingId)) continue;
    seenRuleIds.add(f.findingId);
    const rule: Record<string, unknown> = {
      id: f.findingId,
      shortDescription: { text: f.title },
      fullDescription: { text: f.description },
      defaultConfiguration: { level: toSarifLevel(f.severity) },
      help: { text: f.recommendation, markdown: f.recommendation },
    };
    if (f.baseSeverity) {
      rule.properties = {
        baseSeverity: f.baseSeverity,
        escalationReason: f.escalationReason,
      };
    }
    rules.push(rule);
  }

  const sarifResults: object[] = [];
  for (const f of results.findings) {
    for (const e of f.evidence) {
      const uri = e.file.replace(/\\/g, "/");
      // Make path relative to repo root when possible
      const relativeUri = uri.startsWith(repoPath)
        ? uri.slice(repoPath.length + 1)
        : uri;

      // Skip synthetic/summary evidence that doesn't point to real files
      if (
        relativeUri.includes("(CI summary)") ||
        relativeUri.includes("(correlation") ||
        relativeUri.includes("(analysis summary)")
      ) {
        continue;
      }

      sarifResults.push({
        ruleId: f.findingId,
        level: toSarifLevel(f.severity),
        message: { text: `${f.title}: ${e.snippet}` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: relativeUri },
              region: { startLine: Math.max(e.line, 1) },
            },
          },
        ],
      });
    }
  }

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "scantrix",
            version: "6.3.0",
            informationUri: "https://github.com/stamez/scantrix",
            rules,
          },
        },
        results: sarifResults,
      },
    ],
  };
}
