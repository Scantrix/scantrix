import fs from "fs/promises";
import path from "path";
import MarkdownIt from "markdown-it";
import type { ScanResults } from "./scanner";
import type { PlaywrightConfigSummary } from "./configExtractor";

function severityScore(sev: "low" | "medium" | "high") {
  return sev === "high" ? 3 : sev === "medium" ? 2 : 1;
}

function topFiles(evidence: { file: string }[], topN = 3) {
  const counts = new Map<string, number>();
  for (const e of evidence) counts.set(e.file, (counts.get(e.file) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function formatMs(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  return `${ms} ms`;
}

function pushIf(md: string[], label: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim().length === 0) return;
  md.push(`- ${label}: ${value}`);
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, "").trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineCodeHtml(input: string): string {
  // Lightweight inline renderer: preserves `code` spans while escaping everything.
  // This avoids relying on markdown parsing inside HTML blocks.
  const parts = input.split("`");
  return parts
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
    .join("");
}

function toEmailFriendlyMarkdown(markdown: string): string {
  // Email clients often don't support <details>/<summary>. Flatten them.
  // Keep the summary text as a bold line.
  const flattened = markdown
    .replace(/\r\n/g, "\n")
    .replace(/<details>\s*\n/gi, "")
    .replace(/\n<\/details>\s*\n/gi, "\n\n")
    .replace(/<summary>([\s\S]*?)<\/summary>\s*\n/gi, (_m, summary) => {
      const label = stripHtmlTags(String(summary));
      return `\n**${label}**\n\n`;
    });

  // Centering wrappers don't help in email; keep content simple.
  // IMPORTANT: only remove the specific <div align="center"> wrappers.
  // Do not strip generic </div> tags, since other HTML blocks rely on them.
  const out: string[] = [];
  let centerDepth = 0;
  for (const line of flattened.split("\n")) {
    if (/^\s*<div\s+align="center">\s*$/i.test(line)) {
      centerDepth += 1;
      continue;
    }
    if (centerDepth > 0 && /^\s*<\/div>\s*$/i.test(line)) {
      centerDepth -= 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

type HtmlFlavor = "full" | "email";

function wrapHtmlDocument(title: string, bodyHtml: string, flavor: HtmlFlavor = "full"): string {
  // Keep CSS broadly compatible (browser/Word/email attachments), but improve
  // readability with subtle color + shading.
  const baseCss = `
    :root {
      --bg: #f6f7fb;
      --panel: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e5e7eb;
      --header: #0b1220;
      --accent: #2563eb;
      --accent-weak: #eff6ff;
      --good: #16a34a;
      --warn: #ca8a04;
      --bad: #dc2626;
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      color: var(--text);
      line-height: 1.5;
      margin: 0;
      padding: 24px;
      background: ${flavor === "full" ? "var(--bg)" : "#ffffff"};
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      background: ${flavor === "full" ? "var(--panel)" : "transparent"};
      border: ${flavor === "full" ? "1px solid var(--border)" : "0"};
      border-radius: ${flavor === "full" ? "12px" : "0"};
      padding: ${flavor === "full" ? "26px 28px" : "0"};
      box-shadow: ${flavor === "full" ? "0 10px 30px rgba(2, 6, 23, 0.08)" : "none"};
    }
    h1, h2, h3, h4 { line-height: 1.25; margin: 18px 0 10px; }
    h1 { margin-top: 0; color: var(--header); letter-spacing: -0.02em; }
    h2 { padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    p { margin: 8px 0 8px; }
    ul, ol { padding-left: 20px; }
    li { margin: 4px 0; }
    hr { border: 0; border-top: 1px solid var(--border); margin: 18px 0; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
      font-size: 0.95em;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 0 0.25em;
    }
    pre {
      background: #0b1020;
      color: #e5e7eb;
      padding: 12px;
      overflow-x: auto;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }
    pre code {
      color: inherit;
      background: transparent;
      border: 0;
      padding: 0;
    }
    blockquote {
      margin: 12px 0.5em;
      padding: 10px 12px;
      border-left: 4px solid #b6ceff;
      background: var(--accent-weak);
      color: #1e293b;
      border-radius: 8px;
    }
    img { max-width: 100%; height: auto; }

    table {
      width: 100%;
      margin: 12px 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      border-collapse: separate;
      border-spacing: 0;
      overflow: hidden;
      background: #fff;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 9px 10px;
      vertical-align: top;
      text-align: left;
    }
    th { background: #f8fafc; color: #0f172a; }
    tbody tr:nth-child(even) td { background: #fbfdff; }
    tbody tr:last-child td { border-bottom: 0; }

    /* <details> blocks are used for findings in the full report. */
    details {
      margin: 10px .5em;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #fbfdff;
      overflow: hidden;
    }
    summary {
      cursor: pointer;
      padding: 10px 12px;
      background: #f8fafc;
      border-bottom: 1px solid var(--border);
      list-style: none;
      position: relative;
      padding-left: 38px;
    }
    summary:hover { background: #eef2ff; }
    details[open] summary { background: #eef2ff; }
    summary::after {
      content: "▸";
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      font-size: 16px;
      line-height: 1;
    }
    details[open] summary::after {
      transform: translateY(-50%) rotate(90deg);
    }
    details > :not(summary) { padding: 0px0px; }
    summary::-webkit-details-marker { display: none; }

    /* Section headers inside expanded details */
    details h4 {
      margin: 14px 0 8px;
      font-size: 0.95rem;
      font-weight: 700;
      color: #0f172a;
      padding: 6px 10px;
      border: 1px solid var(--border);
      background: #ffffff;
      border-radius: 10px;
      display: inline-block;
    }

    /* Sub-blocks inside expanded findings */
    .finding-block {
      margin: 12px 0.5em;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #ffffff;
      overflow: hidden;
    }
    .finding-block-title {
      padding: 8px 10px;
      font-weight: 700;
      color: #0f172a;
      background: #f8fafc;
      border-bottom: 1px solid var(--border);
    }
    .finding-block-body { padding: 10px 12px; }
    .finding-block-body p { margin: 10px 0; }
    .finding-block-body ul { margin: 6px 0 4px 18px; padding-left: 18px; }
    .finding-block-body li { margin: 3px 0; }
    .finding-block-body table {
      margin: 0;
      border-radius: 10px;
    }
    .finding-block-body table { border: 1px solid var(--border); }
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
${baseCss}
  </style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}

function calculateRiskScore(findings: ScanResults["findings"]): { grade: string; level: string; description: string } {
  let riskPoints = 0;
  
  // Weight findings by type and severity
  const INSIGHT_MULTIPLIER = 1.5; // Correlated findings are higher signal
  const CI_MULTIPLIER = 1.3; // CI issues affect entire pipeline
  const ARCH_MULTIPLIER = 1.2; // Architecture issues compound over time
  
  for (const f of findings) {
    const basePoints = severityScore(f.severity);
    // Cap evidence impact to avoid one noisy rule dominating the score
    // Use log scale for better distribution with large evidence counts
    const evidenceMultiplier = Math.min(1 + Math.log2(Math.max(f.evidence.length, 1)), 5);
    
    let multiplier = 1;
    if (f.findingId.startsWith("PW-INSIGHT-")) multiplier = INSIGHT_MULTIPLIER;
    else if (f.findingId.startsWith("CI-")) multiplier = CI_MULTIPLIER;
    else if (f.findingId.startsWith("ARCH-")) multiplier = ARCH_MULTIPLIER;
    
    riskPoints += basePoints * evidenceMultiplier * multiplier;
  }
  
  // Convert risk points to letter grade (A = best, D = worst)
  // Thresholds calibrated for typical Playwright repos
  if (riskPoints <= 15) {
    return { grade: 'A', level: '🟢 Excellent', description: 'Framework follows best practices' };
  } else if (riskPoints <= 40) {
    return { grade: 'B', level: '🟡 Good', description: 'Minor issues, normal maintenance needed' };
  } else if (riskPoints <= 70) {
    return { grade: 'C', level: '🟠 Needs Improvement', description: 'Notable issues requiring attention' };
  } else {
    return { grade: 'D', level: '🔴 Critical', description: 'Serious issues, prioritize remediation' };
  }
}

function getTopActionItems(findings: ScanResults["findings"]): string[] {
  const actions: string[] = [];
  const highFindings = findings.filter(f => f.severity === "high").sort((a, b) => b.evidence.length - a.evidence.length);
  
  // Prioritize high-severity items by impact
  for (const f of highFindings) {
    if (actions.length >= 3) break;
    
    if (f.findingId === "PW-FLAKE-001") {
      const topFile = topFiles(f.evidence, 1)[0];
      if (topFile) {
        const fileName = topFile[0].split('/').pop() || topFile[0];
        actions.push(`Remove ${topFile[1]} hard wait${topFile[1] > 1 ? 's' : ''} from ${fileName}`);
      } else {
        actions.push("Remove hard waits (waitForTimeout/setTimeout)");
      }
    } else if (f.findingId === "PW-INSIGHT-001") {
      actions.push("Fix root cause of flaky tests before relying on retries");
    } else if (f.findingId === "PW-INSIGHT-008") {
      actions.push("Enable trace/video capture and publish test artifacts in CI");
    } else if (f.findingId === "PW-STABILITY-001") {
      actions.push(`Add cleanup hooks to ${f.evidence.length} test file${f.evidence.length > 1 ? 's' : ''}`);
    } else if (f.findingId === "PW-STABILITY-003") {
      actions.push(`Move page-based setup out of beforeAll in ${f.evidence.length} file${f.evidence.length > 1 ? 's' : ''}`);
    } else if (f.findingId === "CI-002") {
      actions.push("Configure Playwright HTML report publishing in CI");
    } else if (f.findingId === "CI-007") {
      actions.push(`Implement test sharding for faster CI (${f.evidence[0]?.snippet.match(/\d+/)?.[0] || 'many'} test files)`);
    } else if (f.findingId === "CI-009") {
      actions.push("Publish test-results artifacts to debug retry failures");
    } else if (f.findingId === "ARCH-003") {
      actions.push(`Extract shared code from ${f.evidence.length} test file${f.evidence.length > 1 ? 's' : ''} to utility modules`);
    } else if (f.findingId === "ARCH-005") {
      actions.push("Move hardcoded credentials to environment variables");
    } else {
      // Generic high-severity action
      actions.push(f.recommendation.split('.')[0]);
    }
  }
  
  // Fill remaining slots with medium severity items
  if (actions.length < 3) {
    const mediumFindings = findings.filter(f => f.severity === "medium").sort((a, b) => b.evidence.length - a.evidence.length);
    for (const f of mediumFindings) {
      if (actions.length >= 3) break;
      
      if (f.findingId === "PW-FLAKE-002") {
        actions.push(`Remove ${f.evidence.length} force-click pattern${f.evidence.length > 1 ? 's' : ''}`);
      } else if (f.findingId === "PW-STABILITY-001") {
        actions.push(`Add cleanup hooks to ${f.evidence.length} test file${f.evidence.length > 1 ? 's' : ''}`);
      } else if (f.findingId === "PW-STABILITY-002") {
        actions.push(`Organize ${f.evidence.length} test file${f.evidence.length > 1 ? 's' : ''} with describe blocks`);
      } else if (f.findingId === "CI-006") {
        actions.push("Standardize WORKERS env across all CI pipelines");
      } else if (f.findingId === "PW-INSIGHT-002") {
        actions.push("Review and reduce excessive test timeouts");
      } else if (f.findingId === "PW-INSIGHT-008") {
        actions.push("Enable trace capture and artifact publishing");
      } else if (f.findingId === "CI-008") {
        actions.push("Add --with-deps to playwright install command");
      } else if (f.findingId === "ARCH-001") {
        actions.push("Create BasePage class for consistent POM patterns");
      } else if (f.findingId === "ARCH-004") {
        actions.push(`Add proper TypeScript typing to ${f.evidence.length} fixture file${f.evidence.length > 1 ? 's' : ''}`);
      } else {
        actions.push(f.recommendation.split('.')[0]);
      }
    }
  }
  
  return actions.slice(0, 3);
}

function getTopHotspotsAcrossFindings(findings: ScanResults["findings"]): Array<{file: string; issueCount: number; findingTypes: string[]}> {
  // Aggregate all files across findings, weighted by severity
  const fileStats = new Map<string, { count: number; findingIds: Set<string> }>();
  
  for (const f of findings) {
    // Skip CI findings (they're pipeline-level, not code hotspots)
    if (f.findingId.startsWith("CI-") || f.findingId.startsWith("PW-INSIGHT-")) continue;
    
    const weight = severityScore(f.severity);
    
    for (const e of f.evidence) {
      // Normalize the file path to avoid path casing issues
      const normalizedFile = e.file.replace(/\\/g, "/");
      
      // Skip summary/meta evidence lines
      if (normalizedFile.includes("(CI summary)") || normalizedFile.includes("(correlation")) continue;
      
      const existing = fileStats.get(normalizedFile) || { count: 0, findingIds: new Set<string>() };
      existing.count += weight;
      existing.findingIds.add(f.findingId);
      fileStats.set(normalizedFile, existing);
    }
  }
  
  // Convert to sorted array
  return [...fileStats.entries()]
    .map(([file, stats]) => ({
      file,
      issueCount: stats.count,
      findingTypes: [...stats.findingIds],
    }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 5);
}

type QuickWinCategory = {
  quickWins: Array<{ finding: string; effort: string; impact: string }>;
  largerEfforts: Array<{ finding: string; effort: string; impact: string }>;
};

interface TimeEstimate {
  toGoodGrade: { minHours: number; maxHours: number };
  toAllResolved: { minHours: number; maxHours: number };
  highPriorityCount: number;
  totalIssueCount: number;
}

function calculateRemediationTime(findings: ScanResults["findings"]): TimeEstimate {
  let toGoodMin = 0, toGoodMax = 0;
  let toAllMin = 0, toAllMax = 0;
  
  const highSeverity = findings.filter(f => f.severity === "high");
  const mediumSeverity = findings.filter(f => f.severity === "medium");
  const lowSeverity = findings.filter(f => f.severity === "low");
  
  // Time estimates per finding type (in hours)
  const timeEstimates: Record<string, { min: number; max: number }> = {
    "PW-FLAKE-001": { min: 1, max: 4 },     // Hard waits
    "PW-FLAKE-002": { min: 0.5, max: 2 },   // Force clicks
    "PW-LOC-001": { min: 1, max: 4 },       // XPath selectors
    "PW-STABILITY-001": { min: 2, max: 4 }, // Missing hooks
    "PW-STABILITY-001a": { min: 0.5, max: 1 }, // beforeAll/afterAll info
    "PW-STABILITY-003": { min: 2, max: 6 }, // page fixture used in beforeAll
    "CI-005": { min: 0.5, max: 1 },         // Missing cache
    "CI-006": { min: 0.5, max: 1 },         // Inconsistent workers
    "CI-007": { min: 2, max: 4 },           // Missing sharding
    "PW-INSIGHT-001": { min: 2, max: 6 },   // Locator-timeout correlation
    "PW-INSIGHT-002": { min: 0.25, max: 0.5 }, // Excessive timeout
    "PW-INSIGHT-003": { min: 4, max: 8 },   // Complex test files
    "ARCH-001": { min: 2, max: 4 },         // Missing BasePage
    "ARCH-002": { min: 1, max: 4 },         // Public locators
    "ARCH-003": { min: 2, max: 4 },         // Test coupling
    "ARCH-004": { min: 1, max: 2 },         // Missing fixture typing
    "ARCH-005": { min: 0.5, max: 1 },       // Hardcoded credentials
    "ARCH-005a": { min: 1, max: 3 },        // Hardcoded emails
    "ARCH-006": { min: 4, max: 8 },         // No API mocking
    "ARCH-007": { min: 2, max: 4 },         // No custom error types
  };
  
  // Calculate time to address high severity issues (to reach "Good" grade)
  for (const f of highSeverity) {
    const estimate = timeEstimates[f.findingId] ?? { min: 1, max: 3 };
    // Scale by file count for larger scope issues
    const fileCount = new Set(f.evidence.map(e => e.file)).size;
    const scale = Math.min(Math.max(1, fileCount / 3), 3); // Cap scaling at 3x
    toGoodMin += estimate.min * scale;
    toGoodMax += estimate.max * scale;
  }
  
  // Calculate total time for all issues
  for (const f of [...highSeverity, ...mediumSeverity, ...lowSeverity]) {
    const estimate = timeEstimates[f.findingId] ?? { min: 1, max: 3 };
    const fileCount = new Set(f.evidence.map(e => e.file)).size;
    const scale = Math.min(Math.max(1, fileCount / 3), 3);
    toAllMin += estimate.min * scale;
    toAllMax += estimate.max * scale;
  }
  
  return {
    toGoodGrade: { minHours: Math.round(toGoodMin), maxHours: Math.round(toGoodMax) },
    toAllResolved: { minHours: Math.round(toAllMin), maxHours: Math.round(toAllMax) },
    highPriorityCount: highSeverity.length,
    totalIssueCount: findings.length,
  };
}

function formatTimeRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "No remediation needed";
  if (max <= 4) return `${min}-${max} hours`;
  if (max <= 16) return `${Math.round(min / 4)}-${Math.round(max / 4)} half-days`;
  return `${Math.round(min / 8)}-${Math.round(max / 8)} days`;
}

function categorizeFindings(findings: ScanResults["findings"]): QuickWinCategory {
  const quickWins: QuickWinCategory["quickWins"] = [];
  const largerEfforts: QuickWinCategory["largerEfforts"] = [];
  
  for (const f of findings) {
    const fileCount = new Set(f.evidence.map(e => e.file)).size;
    const occurrences = f.evidence.length;
    
    // Categorize based on finding type and scope
    switch (f.findingId) {
      case "PW-FLAKE-002": // Force clicks - usually few occurrences, easy fix
        if (occurrences <= 5) {
          quickWins.push({
            finding: `Fix ${occurrences} force-click${occurrences > 1 ? 's' : ''}`,
            effort: "~30 min",
            impact: "Reduces hidden UI issues",
          });
        } else {
          largerEfforts.push({
            finding: `Fix ${occurrences} force-clicks across ${fileCount} files`,
            effort: "2-4 hours",
            impact: "Reduces hidden UI issues",
          });
        }
        break;
        
      case "PW-LOC-001": // XPath selectors
        if (fileCount <= 2) {
          quickWins.push({
            finding: `Refactor ${occurrences} XPath selectors in ${fileCount} file${fileCount > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "More maintainable locators",
          });
        } else {
          largerEfforts.push({
            finding: `Refactor ${occurrences} XPath selectors across ${fileCount} files`,
            effort: "4-8 hours",
            impact: "More maintainable locators",
          });
        }
        break;
        
      case "PW-FLAKE-001": // Hard waits
        if (occurrences <= 5) {
          quickWins.push({
            finding: `Remove ${occurrences} hard wait${occurrences > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Faster, more stable tests",
          });
        } else {
          largerEfforts.push({
            finding: `Remove ${occurrences} hard waits across ${fileCount} files`,
            effort: "4-8 hours",
            impact: "Faster, more stable tests",
          });
        }
        break;
        
      case "PW-STABILITY-001": // Missing hooks (high priority)
        largerEfforts.push({
          finding: `Add cleanup hooks to ${fileCount} test file${fileCount > 1 ? 's' : ''}`,
          effort: "2-4 hours",
          impact: "Better test isolation",
        });
        break;

      case "PW-STABILITY-003": // page fixture used in beforeAll
        largerEfforts.push({
          finding: `Move page-based setup out of beforeAll in ${fileCount} file${fileCount > 1 ? 's' : ''}`,
          effort: "2-6 hours",
          impact: "Prevents shared state + flaky cascades",
        });
        break;
        
      case "PW-STABILITY-001a": // beforeAll/afterAll only (low priority)
        // Skip - this is informational/low priority
        break;
        
      case "CI-006": // Inconsistent WORKERS
        quickWins.push({
          finding: "Standardize WORKERS env across pipelines",
          effort: "30 min",
          impact: "Consistent CI behavior",
        });
        break;
        
      case "CI-007": // Missing sharding
        largerEfforts.push({
          finding: "Implement test sharding in CI",
          effort: "2-4 hours",
          impact: "50-75% faster CI",
        });
        break;
        
      case "CI-005": // Missing cache
        quickWins.push({
          finding: "Add dependency caching to CI",
          effort: "30 min",
          impact: "Faster CI install phase",
        });
        break;
        
      case "PW-INSIGHT-002": // Excessive timeout
        quickWins.push({
          finding: "Reduce test timeout configuration",
          effort: "15 min",
          impact: "Faster failure feedback",
        });
        break;

      // Architecture findings
      case "ARCH-001": // Missing BasePage
        largerEfforts.push({
          finding: `Create BasePage pattern for ${fileCount} POM${fileCount > 1 ? 's' : ''}`,
          effort: "2-4 hours",
          impact: "Consistent POM patterns",
        });
        break;
        
      case "ARCH-002": // Public locators
        if (occurrences <= 3) {
          quickWins.push({
            finding: `Encapsulate locators in ${fileCount} POM${fileCount > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Better encapsulation",
          });
        } else {
          largerEfforts.push({
            finding: `Encapsulate locators in ${fileCount} POMs`,
            effort: "4-8 hours",
            impact: "Better encapsulation",
          });
        }
        break;
        
      case "ARCH-003": // Test coupling
        largerEfforts.push({
          finding: `Decouple ${fileCount} test file${fileCount > 1 ? 's' : ''} from test imports`,
          effort: "2-4 hours",
          impact: "Better test isolation",
        });
        break;
        
      case "ARCH-004": // Missing fixture typing
        if (fileCount <= 2) {
          quickWins.push({
            finding: `Add fixture typing to ${fileCount} file${fileCount > 1 ? 's' : ''}`,
            effort: "1 hour",
            impact: "Type safety in tests",
          });
        } else {
          largerEfforts.push({
            finding: `Add fixture typing to ${fileCount} files`,
            effort: "2-4 hours",
            impact: "Type safety in tests",
          });
        }
        break;
        
      case "ARCH-005": // Hardcoded credentials
        quickWins.push({
          finding: "Move credentials to env variables",
          effort: "30 min",
          impact: "Security + env flexibility",
        });
        break;
        
      case "ARCH-005a": // Hardcoded emails
        if (occurrences <= 10) {
          quickWins.push({
            finding: `Replace ${occurrences} hardcoded email${occurrences > 1 ? 's' : ''} with faker/factory`,
            effort: "1 hour",
            impact: "Fewer test conflicts",
          });
        } else {
          largerEfforts.push({
            finding: `Replace ${occurrences} hardcoded emails with data factory`,
            effort: "2-4 hours",
            impact: "Fewer test conflicts",
          });
        }
        break;
        
      case "ARCH-006": // No API mocking
        largerEfforts.push({
          finding: "Implement API mocking patterns",
          effort: "4-8 hours",
          impact: "Faster, isolated tests",
        });
        break;
        
      case "ARCH-007": // No custom error types
        largerEfforts.push({
          finding: `Create custom error types for ${fileCount} POM${fileCount > 1 ? 's' : ''}`,
          effort: "2-4 hours",
          impact: "Better error handling",
        });
        break;
        
      // Skip other insights (they're recommendations, not direct fixes)
      default:
        break;
    }
  }
  
  return { quickWins: quickWins.slice(0, 4), largerEfforts: largerEfforts.slice(0, 4) };
}

export async function writeReportArtifacts(outDir: string, results: ScanResults) {
  await fs.mkdir(outDir, { recursive: true });

  const findingsSorted = [...results.findings].sort(
    (a, b) => severityScore(b.severity) - severityScore(a.severity)
  );

  const risk = calculateRiskScore(findingsSorted);
  const topActions = getTopActionItems(findingsSorted);
  
  const md: string[] = [];
  
  // Professional Header
  md.push(`<div align="center">`);
  md.push(``);
  md.push(`# Playwright Framework Audit Report`);
  md.push(``);
  md.push(`**Automation Quality & Reliability Assessment**`);
  md.push(``);
  md.push(`</div>`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  
  // Report metadata
  md.push(`| | |`);
  md.push(`|---|---|`);
  md.push(`| **Repository** | \`${results.repoPath.split(/[/\\]/).pop()}\` |`);
  md.push(`| **Audit Type** | Deep Audit |`);
  md.push(`| **Generated** | ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} |`);
  md.push(`| **Playwright Version** | ${results.inventory.playwrightVersion ?? 'Unknown'} |`);
  md.push(`| **Total Files Scanned** | ${results.inventory.totalFiles} |`);
  md.push(``);
  
  // Table of Contents
  md.push(`##  TABLE OF CONTENTS`);
  md.push(``);
  md.push(`1. [Executive Summary](#-executive-summary)`);
  md.push(`2. [Risk Assessment](#-risk-assessment)`);
  md.push(`3. [Recommended Actions](#-recommended-actions)`);
  md.push(`4. [Configuration Overview](#-configuration-overview)`);
  md.push(`5. [Detailed Findings](#-detailed-findings)`);
  md.push(`6. [Appendix](#-appendix)`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  
  // Executive Summary
  md.push(`##  EXECUTIVE SUMMARY`);
  md.push(``);
  
  const highCount = findingsSorted.filter(f => f.severity === "high").length;
  const mediumCount = findingsSorted.filter(f => f.severity === "medium").length;
  const lowCount = findingsSorted.filter(f => f.severity === "low").length;
  const totalFindings = highCount + mediumCount + lowCount;
  
  // Overall Score with Letter Grade
  md.push(`### Overall Score`);
  md.push(``);
  md.push(`| Grade | Level | Assessment |`);
  md.push(`|:-----:|-------|------------|`);
  md.push(`| **${risk.grade}** | ${risk.level} | ${risk.description} |`);
  md.push(``);
  md.push(`> *Score is a heuristic based on severity-weighted findings and hotspot concentration.*`);
  md.push(``);
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| **Total Findings** | ${totalFindings} |`);
  md.push(``);
  
  // Findings breakdown
  md.push(`### Findings Breakdown`);
  md.push(``);
  md.push(`| Severity | Count | Description |`);
  md.push(`|----------|-------|-------------|`);
  md.push(`| 🔴 **High** | ${highCount} | Critical issues requiring immediate attention |`);
  md.push(`| 🟠 **Medium** | ${mediumCount} | Important issues to address in next sprint |`);
  md.push(`| 🟡 **Low** | ${lowCount} | Minor improvements for long-term quality |`);
  md.push(``);
  
  md.push(`---`);
  md.push(``);
  
  // Risk Assessment
  md.push(`##  RISK ASSESSMENT`);
  md.push(``);
  
  // Top Hotspots section
  const topHotspots = getTopHotspotsAcrossFindings(findingsSorted);
  if (topHotspots.length > 0) {
    md.push(`### Priority Files`);
    md.push(`> These files have the highest concentration of issues and should be addressed first.`);
    md.push(``);
    md.push(`| File | Issues Found |`);
    md.push(`|------|--------------|`);
    for (const hotspot of topHotspots) {
      const fileName = hotspot.file.split('/').pop() || hotspot.file;
      const issueLabels = hotspot.findingTypes.map(t => `\`${t}\``).join(' ');
      md.push(`| \`${fileName}\` | ${issueLabels} |`);
    }
    md.push(``);
  }
  
  md.push(`---`);
  md.push(``);
  
  // Recommended Actions
  md.push(`##  RECOMMENDED ACTIONS`);
  md.push(``);
  
  if (topActions.length > 0) {
    md.push(`### Top 3 Priority Items`);
    md.push(``);
    topActions.forEach((action, i) => {
      const priority = i === 0 ? '' : i === 1 ? '' : '';
      md.push(`${priority} **${i + 1}.** ${action}`);
      md.push(``);
    });
  }
  
  // Quick Wins vs Larger Efforts
  const { quickWins, largerEfforts } = categorizeFindings(findingsSorted);
  if (quickWins.length > 0 || largerEfforts.length > 0) {
    md.push(`### Effort Estimation`);
    md.push(``);
    
    if (quickWins.length > 0) {
      md.push(`####  Quick Wins *(< 2 hours each)*`);
      md.push(``);
      md.push(`| Action Item | Time Estimate | Expected Impact |`);
      md.push(`|-------------|---------------|-----------------|`);
      for (const qw of quickWins) {
        md.push(`| ${qw.finding} | ${qw.effort} | ${qw.impact} |`);
      }
      md.push(``);
    }
    
    if (largerEfforts.length > 0) {
      md.push(`####  Strategic Improvements *(half-day to multi-day)*`);
      md.push(``);
      md.push(`| Action Item | Time Estimate | Expected Impact |`);
      md.push(`|-------------|---------------|-----------------|`);
      for (const le of largerEfforts) {
        md.push(`| ${le.finding} | ${le.effort} | ${le.impact} |`);
      }
      md.push(``);
    }    
    // Time Summary
    const timeEstimate = calculateRemediationTime(findingsSorted);
    md.push(`####  Remediation Time Summary`);
    md.push(``);
    md.push(`| Target | Estimated Time | Scope |`);
    md.push(`|--------|----------------|-------|`);
    if (risk.grade !== 'A' && risk.grade !== 'B') {
      md.push(`| **Reach Grade B (Good)** | ${formatTimeRange(timeEstimate.toGoodGrade.minHours, timeEstimate.toGoodGrade.maxHours)} | Address ${timeEstimate.highPriorityCount} high-severity finding${timeEstimate.highPriorityCount !== 1 ? 's' : ''} |`);
    }
    md.push(`| **Address All Issues** | ${formatTimeRange(timeEstimate.toAllResolved.minHours, timeEstimate.toAllResolved.maxHours)} | Resolve all ${timeEstimate.totalIssueCount} finding${timeEstimate.totalIssueCount !== 1 ? 's' : ''} |`);
    md.push(``);
    md.push(`> *Time estimates assume a single engineer familiar with the codebase. Actual time may vary based on complexity and team experience.*`);
    md.push(``);  }
  
  md.push(`---`);
  md.push(``);
  
  // Configuration Overview
  md.push(`##  CONFIGURATION OVERVIEW`);
  md.push(``);
  
  // Playwright Config
  const pw = results.inventory.playwrightConfigSummary as PlaywrightConfigSummary | undefined;
  if (pw) {
    md.push(`### Playwright Configuration`);
    md.push(``);
    md.push(`<details>`);
    md.push(`<summary>Configuration details</summary>`);
    md.push(``);
    md.push(`| Setting | Value |`);
    md.push(`|---------|-------|`);
    md.push(`| Config Path | \`${pw.configPath}\` |`);
    if (pw.testDir) md.push(`| Test Directory | \`${pw.testDir}\` |`);
    if (pw.timeoutMs) md.push(`| Test Timeout | ${formatMs(pw.timeoutMs)} |`);
    if (pw.expectTimeoutMs) md.push(`| Expect Timeout | ${formatMs(pw.expectTimeoutMs)} |`);
    if (pw.workers) md.push(`| Workers | ${pw.workers} |`);
    if (pw.retries) md.push(`| Retries | ${pw.retries} |`);
    if (pw.globalSetup) md.push(`| Global Setup | \`${pw.globalSetup}\` |`);
    
    if (pw.use) {
      if (pw.use.headless !== undefined) md.push(`| Headless | ${pw.use.headless} |`);
      if (pw.use.actionTimeoutMs) md.push(`| Action Timeout | ${formatMs(pw.use.actionTimeoutMs)} |`);
      if (pw.use.trace) md.push(`| Trace | ${pw.use.trace} |`);
      if (pw.use.video) md.push(`| Video | ${pw.use.video} |`);
      if (pw.use.screenshot) md.push(`| Screenshot | ${pw.use.screenshot} |`);
    }
    
    if (pw.reporters?.length) {
      const uniqueNames = [...new Set(pw.reporters.map((r) => r.name))];
      md.push(`| Reporters | ${uniqueNames.join(', ')} |`);
    }
    
    if (pw.projects?.length) {
      const projNames = pw.projects.map((p) => p.name).join(', ');
      md.push(`| Projects | ${projNames} |`);
    }
    
    md.push(``);
    md.push(`</details>`);
    md.push(``);
  }
  
  // CI Configuration
  const ci = results.inventory.ciSummary;
  if (ci) {
    md.push(`### CI/CD Configuration`);
    md.push(``);
    md.push(`<details>`);
    md.push(`<summary>CI details</summary>`);
    md.push(``);
    md.push(`| Setting | Status |`);
    md.push(`|---------|--------|`);
    md.push(`| CI Platform | ${ci.detectedAzurePipelines ? 'Azure Pipelines' : ''}${ci.detectedGitHubActions ? 'GitHub Actions' : ''}${!ci.detectedAzurePipelines && !ci.detectedGitHubActions ? 'Not detected' : ''} |`);
    md.push(`| Pipeline Files | ${ci.files.length} |`);
    md.push(`| HTML Report Publishing | ${ci.publishesPlaywrightReport ? ' Configured' : ' Not configured'} |`);
    md.push(`| JUnit Publishing | ${ci.publishesJUnit ? ' Configured' : ' Not configured'} |`);
    md.push(`| Trace/Artifact Publishing | ${ci.publishesTracesOrTestResultsDir ? ' Configured' : ' Not configured'} |`);
    if (ci.publishesTracesOrTestResultsDir) {
      md.push(`| Artifacts on Failure | ${ci.publishesArtifactsOnFailure ? ' Yes' : ' Not detected'} |`);
    }
    md.push(`| Dependency Caching | ${ci.usesCache ? ' Enabled' : ' Not enabled'} |`);
    md.push(`| Test Sharding | ${ci.usesSharding ? ' Enabled' : ' Not enabled'} |`);
    md.push(`| WORKERS Env Variable | ${ci.setsWorkersEnv ? ' Set' : ' Not set'} |`);
    md.push(``);
    
    if (ci.files.length > 0) {
      md.push(`**Pipeline Files:**`);
      for (const f of ci.files) {
        md.push(`- \`${f.file.split(/[/\\]/).pop()}\``);
      }
    }
    md.push(``);
    md.push(`</details>`);
    md.push(``);
  }
  
  md.push(`---`);
  md.push(``);
  
  // Detailed Findings
  md.push(`##  DETAILED FINDINGS`);
  md.push(``);
  
  if (!findingsSorted.length) {
    md.push(`>  **Excellent!** No issues were detected by the current audit rules.`);
    md.push(``);
  } else {
    // Group findings by severity
    const highFindings = findingsSorted.filter(f => f.severity === "high");
    const mediumFindings = findingsSorted.filter(f => f.severity === "medium");
    const lowFindings = findingsSorted.filter(f => f.severity === "low");
    
    if (highFindings.length > 0) {
      md.push(`### 🔴 High Severity Issues`);
      md.push(``);
      for (const f of highFindings) {
        renderFinding(md, f);
      }
    }
    
    if (mediumFindings.length > 0) {
      md.push(`### 🟠 Medium Severity Issues`);
      md.push(``);
      for (const f of mediumFindings) {
        renderFinding(md, f);
      }
    }
    
    if (lowFindings.length > 0) {
      md.push(`### 🟡 Low Severity Issues`);
      md.push(``);
      for (const f of lowFindings) {
        renderFinding(md, f);
      }
    }
  }
  
  md.push(`---`);
  md.push(``);
  
  // Appendix
  md.push(`##  Appendix`);
  md.push(``);
  md.push(`### Repository Statistics`);
  md.push(``);
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| Total Files Scanned | ${results.inventory.totalFiles} |`);
  md.push(`| Test Files | ${results.inventory.testFiles} |`);
  md.push(`| Playwright Config | ${results.inventory.hasPlaywrightConfig ? 'Found' : 'Not found'} |`);
  md.push(``);
  
  md.push(`### Score Interpretation Guide`);
  md.push(``);
  md.push(`| Grade | Level | Interpretation |`);
  md.push(`|:-----:|-------|----------------|`);
  md.push(`| **A** | 🟢 Excellent | Framework follows best practices |`);
  md.push(`| **B** | 🟡 Good | Minor issues, normal maintenance needed |`);
  md.push(`| **C** | 🟠 Needs Improvement | Notable issues requiring attention |`);
  md.push(`| **D** | 🔴 Critical | Serious issues, prioritize remediation |`);
  md.push(``);
  md.push(`> *Grades are calculated using severity-weighted findings and evidence concentration.*`);
  md.push(``);
  
  // Professional Footer
  md.push(`---`);
  md.push(``);
  md.push(`<div align="center">`);
  md.push(``);
  md.push(`*Report generated by SouthernSentinel* (*because passing tests shouldn’t lie*)`);
  md.push(``);
  md.push(`**Questions?** Contact your QA Engineering team for remediation guidance.`);
  md.push(``);
  md.push(`</div>`);

  const markdownReport = md.join("\n");

  const mdParser = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
  });

  const htmlBody = mdParser.render(markdownReport);
  const fullHtml = wrapHtmlDocument(
    "Playwright Framework Audit Report",
    htmlBody
  );

  const emailMarkdown = toEmailFriendlyMarkdown(markdownReport);
  const emailHtmlBody = mdParser.render(emailMarkdown);
  const emailHtml = wrapHtmlDocument(
    "Playwright Framework Audit Report (Email)",
    emailHtmlBody,
    "email"
  );

  await fs.writeFile(
    path.join(outDir, "audit_summary.md"),
    markdownReport,
    "utf8"
  );

  await fs.writeFile(
    path.join(outDir, "audit_summary.html"),
    fullHtml,
    "utf8"
  );

  await fs.writeFile(
    path.join(outDir, "audit_email.html"),
    emailHtml,
    "utf8"
  );

  await fs.writeFile(
    path.join(outDir, "findings.json"),
    JSON.stringify(findingsSorted, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(outDir, "repo_inventory.json"),
    JSON.stringify(results.inventory, null, 2),
    "utf8"
  );
}

function renderFinding(md: string[], f: { findingId: string; severity: string; title: string; description: string; recommendation: string; evidence: Array<{ file: string; line: number; snippet: string }> }) {
  md.push(`<details>`);
  md.push(`<summary><strong>${f.findingId}</strong>: ${f.title}</summary>`);
  md.push(``);
  md.push(`> ${f.description}`);
  md.push(``);
  md.push(`<div class="finding-block">`);
  md.push(`<div class="finding-block-title"><b>Recommendation</b></div>`);
  md.push(`<div class="finding-block-body"><p>${renderInlineCodeHtml(f.recommendation)}</p></div>`);
  md.push(`</div>`);
  md.push(``);
  
  // Evidence deduplication
  const uniqueEvidence = new Map<string, typeof f.evidence[0]>();
  for (const e of f.evidence) {
    const key = `${e.file}:${e.line}`;
    if (!uniqueEvidence.has(key)) {
      uniqueEvidence.set(key, e);
    }
  }
  
  const totalHits = uniqueEvidence.size;
  const affectedFiles = new Set([...uniqueEvidence.values()].map(e => e.file)).size;
  
  md.push(`**Impact:** ${totalHits} occurrence${totalHits > 1 ? 's' : ''} across ${affectedFiles} file${affectedFiles > 1 ? 's' : ''}`);
  md.push(``);
  
  // Hotspots
  const fileHitCounts = new Map<string, number>();
  for (const e of uniqueEvidence.values()) {
    fileHitCounts.set(e.file, (fileHitCounts.get(e.file) ?? 0) + 1);
  }
  const hotspots = [...fileHitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  if (hotspots.length > 0 && !f.findingId.startsWith("CI-")) {
    md.push(`<div class="finding-block">`);
    md.push(`<div class="finding-block-title">Top Affected Files</div>`);
    md.push(`<div class="finding-block-body">`);
    md.push(`<ul>`);
    for (const [file, count] of hotspots) {
      const fileName = file.split(/[/\\]/).pop() || file;
      md.push(`<li><code>${escapeHtml(fileName)}</code> (${count} occurrence${count > 1 ? "s" : ""})</li>`);
    }
    md.push(`</ul>`);
    md.push(`</div>`);
    md.push(`</div>`);
    md.push(``);
  }
  
  // Evidence samples
  // Show all evidence rows (no truncation) for customer deliverables.
  const evidenceList = Array.from(uniqueEvidence.values());
  
  md.push(`<div class="finding-block">`);
  md.push(`<div class="finding-block-title"><b>Hotspots</b></div>`);
  md.push(`<div class="finding-block-body">`);
  md.push(`<table>`);
  md.push(`<thead><tr><th>Source Location</th><th>Code</th></tr></thead>`);
  md.push(`<tbody>`);
  for (const e of evidenceList) {
    const fileName = e.file.split(/[/\\]/).pop() || e.file;
    const snippetRaw = e.snippet.length > 120 ? e.snippet.slice(0, 120) + "..." : e.snippet;
    md.push(
      `<tr><td><code>${escapeHtml(`${fileName}:${e.line}`)}</code></td><td><code>${escapeHtml(snippetRaw)}</code></td></tr>`
    );
  }
  md.push(`</tbody>`);
  md.push(`</table>`);
  md.push(`</div>`);
  md.push(`</div>`);
  md.push(``);
  md.push(`</details>`);
  md.push(``);
}
