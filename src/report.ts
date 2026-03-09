import fs from "fs/promises";
import path from "path";
import MarkdownIt from "markdown-it";
import type { ScanResults } from "./scanner";
import type { PlaywrightConfigSummary } from "./configExtractor";
import { toSarif } from "./sarifFormatter";
import { loadBaseline, computeDiff, formatDiffMarkdown, type SnapshotMeta } from "./diffTracker";
import { calculateRiskScore, severityScore, type ScoreInventory } from "./scoring";

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

function linkifyUrlsInPlainText(text: string): string {
  // Linkify only http(s) URLs.
  // Keep it conservative: stop at whitespace or obvious HTML delimiters.
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  return text.replace(urlRegex, (rawUrl) => {
    // Trim trailing punctuation that commonly follows URLs in prose.
    let url = rawUrl;
    while (/[),.;:!?]$/.test(url)) url = url.slice(0, -1);
    const trailing = rawUrl.slice(url.length);
    return `<a href="${url}">${url}</a>${trailing}`;
  });
}

function linkifyUrlsInHtmlTextNodes(html: string): string {
  // Only linkify inside text nodes (not inside tags/attrs), and avoid
  // linkifying inside an existing <a>...</a>.
  const parts = html.split(/(<[^>]+>)/g);
  let inAnchor = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.startsWith("<")) {
      if (/^<\s*a\b/i.test(part)) inAnchor = true;
      else if (/^<\s*\/\s*a\b/i.test(part)) inAnchor = false;
      continue;
    }

    if (!inAnchor) parts[i] = linkifyUrlsInPlainText(part);
  }

  return parts.join("");
}

function linkifyHttpUrlsInRenderedHtml(htmlBody: string): string {
  // markdown-it does not linkify inside raw HTML blocks. Our report intentionally
  // uses HTML blocks for layout, so we post-process the rendered HTML and
  // linkify only in text nodes.
  return linkifyUrlsInHtmlTextNodes(htmlBody);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Transforms a recommendation string into proper Markdown so that
 * markdown-it renders it with visible paragraph breaks and code blocks
 * instead of collapsing everything into a single paragraph.
 *
 * - Consecutive indented lines (≥2 leading spaces) → fenced code block
 * - Non-indented lines → separated by blank lines (paragraph breaks)
 */
function formatRecommendation(rec: string): string {
  const lines = rec.split("\n");
  if (lines.length <= 1) return rec;

  const out: string[] = [];
  let inCode = false;

  for (const line of lines) {
    const isIndented = /^\s{2,}/.test(line);

    if (isIndented && !inCode) {
      out.push("");
      out.push("```");
      out.push(line.trimStart());
      inCode = true;
    } else if (isIndented && inCode) {
      out.push(line.trimStart());
    } else if (!isIndented && inCode) {
      out.push("```");
      out.push("");
      out.push(line);
      inCode = false;
    } else {
      if (out.length > 0) out.push("");
      out.push(line);
    }
  }

  if (inCode) out.push("```");

  return out.join("\n");
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

interface WrapHtmlOptions {
  sidebarLogoSvg?: string;
}

function wrapHtmlDocument(title: string, bodyHtml: string, flavor: HtmlFlavor = "full", opts: WrapHtmlOptions = {}): string {
  if (flavor === "email") {
    return wrapEmailDocument(title, bodyHtml);
  }

  /* ── Enterprise report design system ─────────────────────────────── */
  const css = `
/* ── Design Tokens ── */
:root {
  --color-bg: #f5f6fa;
  --color-surface: #ffffff;
  --color-text: #0f172a;
  --color-text-secondary: #1e293b;
  --color-muted: #94a3b8;
  --color-border: #e2e8f0;
  --color-border-light: #3b82f6;
  --color-accent: #3b82f6;
  --color-accent-light: #eef2ff;
  --color-accent-hover: #386dca;

  --severity-high: #dc2626;
  --severity-high-bg: #fef2f2;
  --severity-high-border: #fecaca;
  --severity-medium: #d97706;
  --severity-medium-bg: #fffbeb;
  --severity-medium-border: #fde68a;
  --severity-low: #2563eb;
  --severity-low-bg: #eff6ff;
  --severity-low-border: #bfdbfe;

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.03);
  --sidebar-w: 224px;
}

/* ── Reset & Base ── */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 24px; }
body {
  font-family: var(--font-sans); color: var(--color-text); line-height: 1.6;
  margin: 0; padding: 0; background: var(--color-bg); font-size: 14px;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}

/* ── Layout ── */
.report-layout { display: flex; min-height: 100vh; }

/* ── Sidebar ── */
.sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; width: var(--sidebar-w);
  background: #0f172a; border-right: 1px solid #334155;
  padding: var(--space-6) 0; overflow-y: auto; z-index: 10;
  display: flex; flex-direction: column;
}
.sidebar-brand { padding: 0 var(--space-5); margin-bottom: var(--space-5); }
.sidebar-brand img { max-width: 190px; height: auto; }
.sidebar-brand .brand-logo { display: block; color: #e2e8f0; }
.sidebar-brand .brand-logo svg { width: 190px; height: auto; display: block; }
.sidebar-brand .brand-text {
  font-size: 15px; font-weight: 700; color: #e2e8f0; letter-spacing: -0.02em;
}
.sidebar-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: #64748b; padding: var(--space-2) var(--space-5) var(--space-1);
}
.sidebar-nav { list-style: none; margin: 0; padding: 0; flex: 1; }
.sidebar-nav li { margin: 0; padding: 0; }
.sidebar-nav a {
  display: block; padding: 6px var(--space-5); color: #94a3b8;
  font-size: 13px; font-weight: 500; text-decoration: none;
  border-left: 6px solid transparent; transition: all 120ms ease;
}
.sidebar-nav a:hover { color: #e2e8f0; background: #283548; }
.sidebar-nav a.active {
  color: #3b82f6; border-left-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1); font-weight: 600;
}
.sidebar-actions {
  padding: var(--space-3) var(--space-5); border-top: 1px solid #334155; margin-top: auto;
}
.sidebar-actions button:not(.theme-toggle-track) {
  display: block; width: 100%; padding: 6px var(--space-3); margin-bottom: 6px;
  border: 1px solid #020617; border-radius: var(--radius-md);
  background: #1e293b; color: #e2e8f0;
  font-size: 12px; font-family: inherit; cursor: pointer; text-align: left;
  transition: all 120ms ease;
}
.sidebar-actions button:not(.theme-toggle-track):hover { background: #283548; color: #e2e8f0; }

/* ── Main Content ── */
.report-main {
  margin-left: var(--sidebar-w); flex: 1; min-width: 0;
  padding: var(--space-8) var(--space-10);
}
.report-content { max-width: 1060px; margin: 0 auto; }

/* ── Typography ── */
h1, h2, h3, h4 { line-height: 1.3; font-weight: 700; color: var(--color-text); }
h1 { font-size: 1.75rem; margin: 0 0 var(--space-2); letter-spacing: -0.02em; }
h2 {
  font-size: 1.25rem; margin: var(--space-6) 0 var(--space-3);
  padding-bottom: 0; border-bottom: none;
}
h3 { font-size: 1.05rem; margin: var(--space-6) 0 var(--space-3); }
h4 { font-size: 0.92rem; margin: var(--space-4) 0 var(--space-2); }

p { margin: var(--space-2) 0; }
ul, ol { padding-left: var(--space-5); margin: var(--space-2) 0; }
li { margin: var(--space-1) 0; }

hr { border: 0; height: 1px; background: var(--color-border); margin: var(--space-8) 0; }
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: 2px; }

/* ── Code ── */
code {
  font-family: var(--font-mono); font-size: 0.84em;
  background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: var(--radius-sm);
  padding: 1px 5px; color: #000b25;
}
pre {
  background: #000b25; color: #e2e8f0; padding: var(--space-4); overflow-x: auto;
  border-radius: var(--radius-lg); border: 1px solid #1e293b;
  margin: var(--space-4) 0; font-size: 13px; line-height: 1.5;
}
pre code { color: inherit; background: transparent; border: 0; padding: 0; }

/* ── Blockquotes ── */
blockquote {
  margin: var(--space-4) 0; padding: var(--space-3) var(--space-5) var(--space-3) var(--space-6);
  border-left: 3px solid var(--color-accent); background: var(--color-accent-light);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-secondary); font-size: 0.9em;
}
details.finding-card blockquote { margin-left: var(--space-2); }
blockquote p { margin: var(--space-1) 0; max-width: none; }

img { max-width: 100%; height: auto; }

/* ── Tables ── */
table {
  width: 100%; margin: var(--space-4) 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); border-collapse: separate; border-spacing: 0;
  overflow: hidden; background: var(--color-surface); font-size: 13px;
}
th, td {
  padding: var(--space-2) var(--space-3); text-align: left;
  border-bottom: 1px solid var(--color-border); vertical-align: top;
  line-height: 1.3;
}
td:last-child { white-space: nowrap; }
th {
  background: #f8fafc; font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary);
  position: sticky; top: 0; z-index: 1;
}
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: #f1f5f9; }

/* ── Grade Card ── */
.grade-card {
  display: inline-flex; align-items: center; gap: var(--space-4);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); padding: var(--space-4) var(--space-6);
  box-shadow: var(--shadow-md); margin: var(--space-4) 0;
}
.grade-letter {
  font-size: 3rem; font-weight: 800; line-height: 1; min-width: 56px; text-align: center;
}
.grade-a { color: #059669; } .grade-b { color: #10b981; }
.grade-c { color: #d97706; } .grade-d { color: #dc2626; } .grade-f { color: #991b1b; }
.grade-detail { display: flex; flex-direction: column; gap: 2px; }
.grade-level { font-weight: 600; font-size: 0.95rem; }
.grade-desc { font-size: 0.85rem; color: var(--color-text-secondary); }

/* ── Stat Grid ── */
.stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-4); margin: var(--space-4) 0;
}
.stat-card {
  display: flex; flex-direction: column; padding: var(--space-4) var(--space-5);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);
}
.stat-label {
  font-size: 11px; font-weight: 600; color: var(--color-muted);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.stat-value { font-size: 1.75rem; font-weight: 700; margin-top: var(--space-1); line-height: 1.2; }
.stat-high { color: var(--severity-high); }
.stat-medium { color: var(--severity-medium); }
.stat-low { color: var(--severity-low); }

/* ── Severity Badges ── */
.badge {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
  white-space: nowrap; vertical-align: middle;
}
.badge-high { background: var(--severity-high-bg); color: var(--severity-high); border: 1px solid var(--severity-high-border); }
.badge-medium { background: var(--severity-medium-bg); color: var(--severity-medium); border: 1px solid var(--severity-medium-border); }
.badge-low { background: var(--severity-low-bg); color: var(--severity-low); border: 1px solid var(--severity-low-border); }
.escalation-tag { font-size: 10px; color: #d97706; cursor: help; margin-left: 2px; vertical-align: middle; }

/* ── Findings: Details/Summary ── */
details.finding-card {
  margin: var(--space-3) 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); background: var(--color-surface);
  overflow: hidden; box-shadow: var(--shadow-sm); transition: box-shadow 150ms ease;
}
details.finding-card:hover { box-shadow: var(--shadow-md); }
details.finding-card[data-severity="high"]   { border-left: 3px solid var(--severity-high); }
details.finding-card[data-severity="medium"] { border-left: 3px solid var(--severity-medium); }
details.finding-card[data-severity="low"]    { border-left: 3px solid var(--severity-low); }

details.finding-card summary {
  cursor: pointer; padding: var(--space-3) var(--space-4) var(--space-3) var(--space-8);
  list-style: none; position: relative; font-size: 0.9rem;
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  user-select: none;
}
details.finding-card summary::-webkit-details-marker,
details.finding-card summary::marker { display: none; }
details.finding-card summary::before {
  content: ""; position: absolute; left: 14px; top: 50%;
  width: 6px; height: 6px; border-right: 2px solid var(--color-muted);
  border-bottom: 2px solid var(--color-muted);
  transform: translateY(-50%) rotate(-45deg); transition: transform 150ms ease;
}
details.finding-card[open] summary::before { transform: translateY(-60%) rotate(45deg); }
details.finding-card summary:hover { background: #f8fafc; }
details.finding-card[open] summary {
  background: #f1f5f9; border-bottom: 1px solid var(--color-border);
}
details.finding-card > *:not(summary) { padding: var(--space-3) var(--space-4); }

/* Legacy details (config, CI, etc.) */
details:not(.finding-card) {
  margin: var(--space-3) 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); background: var(--color-surface); overflow: hidden;
}
details:not(.finding-card) summary {
  cursor: pointer; padding: var(--space-3) var(--space-4) var(--space-3) var(--space-8);
  list-style: none; position: relative; font-weight: 500;
}
details:not(.finding-card) summary::-webkit-details-marker,
details:not(.finding-card) summary::marker { display: none; }
details:not(.finding-card) summary::before {
  content: ""; position: absolute; left: 14px; top: 50%;
  width: 6px; height: 6px; border-right: 2px solid var(--color-muted);
  border-bottom: 2px solid var(--color-muted);
  transform: translateY(-50%) rotate(-45deg); transition: transform 150ms ease;
}
details:not(.finding-card)[open] summary::before { transform: translateY(-60%) rotate(45deg); }
details:not(.finding-card) summary:hover { background: #f8fafc; }
details:not(.finding-card)[open] summary { border-bottom: 1px solid var(--color-border); }
details:not(.finding-card) > *:not(summary) { padding: var(--space-3) var(--space-6); }
details:not(.finding-card) > table {
  width: calc(100% - var(--space-6) * 2); margin: var(--space-3) var(--space-6);
  padding: 0; box-sizing: border-box;
}
details:not(.finding-card) > ul,
details:not(.finding-card) > p + ul { padding-left: calc(var(--space-6) + var(--space-5)); padding-right: var(--space-6); }

/* ── Finding sub-blocks ── */
.finding-block {
  margin: var(--space-3) 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-md); background: var(--color-surface); overflow: hidden;
}
.finding-block-title {
  padding: var(--space-2) var(--space-3); font-weight: 600; font-size: 12px;
  text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-secondary);
  background: #f8fafc; border-bottom: 1px solid var(--color-border);
}
.finding-block-body { padding: var(--space-3) var(--space-4); font-size: 0.9em; }
.finding-block-body p { margin: var(--space-2) 0; }
.finding-block-body ul { margin: var(--space-2) 0; padding-left: var(--space-5); }
.finding-block-body li { margin: var(--space-1) 0; }
.finding-block-body table { margin: 0; font-size: 12px; table-layout: fixed; }
.finding-block-body table th:first-child,
.finding-block-body table td:first-child { width: 30%; }
.finding-block-body table td:last-child { text-align: left; white-space: normal; }
.finding-block-body table td code { word-break: break-all; white-space: pre-wrap; }

/* ── Filter Bar ── */
.filter-bar {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  margin: var(--space-4) 0 var(--space-6); padding: var(--space-3) var(--space-4);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.filter-bar label {
  font-size: 12px; font-weight: 600; color: var(--color-muted);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.filter-btn {
  padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border);
  border-radius: 9999px; background: var(--color-surface); color: var(--color-text-secondary);
  font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: all 120ms ease;
}
.filter-btn:hover { background: var(--color-border-light); }
.filter-btn.active { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
.filter-search {
  margin-left: auto; padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  font-size: 13px; font-family: inherit; color: var(--color-text);
  background: var(--color-surface); min-width: 180px;
}
.filter-search::placeholder { color: var(--color-muted); }
.filter-search:focus {
  outline: none; border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

/* ── Report Footer ── */
.report-footer-logo { display: block; margin: var(--space-3) auto; max-width: 200px; width: 100%; height: auto; }
.report-footer-text { margin: var(--space-2) 0; color: var(--color-muted); font-size: 0.9em; text-align: center; }

/* ── Back to Top ── */
.back-to-top {
  position: fixed; bottom: var(--space-6); right: var(--space-6);
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid var(--color-border); background: var(--color-surface);
  color: var(--color-text-secondary); font-size: 18px; cursor: pointer;
  box-shadow: var(--shadow-md); opacity: 0; transform: translateY(10px);
  transition: opacity 200ms ease, transform 200ms ease;
  z-index: 20; display: flex; align-items: center; justify-content: center;
}
.back-to-top.visible { opacity: 1; transform: translateY(0); }
.back-to-top:hover { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }

.hidden { display: none !important; }

/* ── Section Cards ── */
.section-card {
  background: #e2e8f0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  margin: var(--space-3) 0 var(--space-4);
  box-shadow: var(--shadow-sm);
}
.section-card > *:first-child { margin-top: 0; }
.section-card > *:last-child { margin-bottom: 0; }
.section-card hr { display: none; }

/* ── Theme Toggle ── */
.theme-toggle {
  display: flex; align-items: center; gap: var(--space-3);
  padding: 0 0 var(--space-2); margin-bottom: var(--space-2);
}
.theme-toggle-track {
  position: relative; width: 40px; min-width: 40px; max-width: 40px;
  height: 22px; flex-shrink: 0;
  background: #94a3b8; border-radius: 9999px;
  cursor: pointer; transition: background 200ms ease;
  border: none; padding: 0; margin: 0;
}
.theme-toggle-track::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 200ms ease;
}
[data-theme="dark"] .theme-toggle-track { background: var(--color-accent); }
[data-theme="dark"] .theme-toggle-track::after { transform: translateX(18px); background: #1e293b; }
.theme-toggle-label {
  font-size: 12px; color: #94a3b8; user-select: none;
}

/* ── Report Meta ── */
.report-meta {
  display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5);
  padding: var(--space-3) 0; margin: var(--space-2) 0 var(--space-4);
  font-size: 13px; color: var(--color-text-secondary);
  border-bottom: 3px solid #3b82f6;
}
.report-meta .meta-item { white-space: nowrap; }
.report-meta code { font-size: 12px; }

/* ── Hero Card ── */
.hero-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); padding: var(--space-6);
  box-shadow: var(--shadow-md); margin: var(--space-4) 0;
}
.hero-grade {
  display: flex; align-items: center; gap: var(--space-4);
  padding-bottom: var(--space-5); border-bottom: 2px solid #94a3b8;
  margin-bottom: var(--space-5);
}
.hero-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4);
}
.hero-stats .stat-card { box-shadow: none; border: 1px solid var(--color-border-light); }
.hero-footnote {
  margin-top: var(--space-4); padding-top: var(--space-3);
  border-top: 2px solid #94a3b8;
  font-size: 12px; color: var(--color-muted); font-style: italic;
}

/* ── Severity Matrix ── */
.severity-matrix table { font-size: 13px; }
.severity-matrix td:not(:first-child),
.severity-matrix th:not(:first-child) { text-align: center; width: 80px; }
.severity-matrix td:first-child { font-weight: 500; }

/* ── Effort Badges ── */
.effort-quick { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.effort-strategic { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }

/* ── Config Summary ── */
.config-summary { font-size: 13px; color: var(--color-text-secondary); margin: var(--space-2) 0; }

/* ── Filter Count ── */
.filter-count { font-size: 12px; color: var(--color-muted); margin: 0 0 var(--space-3); min-height: 16px; }

/* ── Stat Card Severity Tinting ── */
.stat-card-high { border-left: 3px solid var(--severity-high); }
.stat-card-medium { border-left: 3px solid var(--severity-medium); }
.stat-card-low { border-left: 3px solid var(--severity-low); }

/* ── Dark Theme ── */
[data-theme="dark"] {
  --color-bg: #020617;
  --color-surface: #1e293b;
  --color-text: #cccccc;
  --color-text-secondary: #94a3b8;
  --color-muted: #64748b;
  --color-border: #334155;
  --color-border-light: #3b82f6;
  --color-accent: #3b82f6;
  --color-accent-light: rgba(99, 102, 241, 0.1);
  --color-accent-hover: #6366f1;
  --severity-high-bg: rgba(220, 38, 38, 0.15);
  --severity-high-border: rgba(220, 38, 38, 0.3);
  --severity-medium-bg: rgba(217, 119, 6, 0.15);
  --severity-medium-border: rgba(217, 119, 6, 0.3);
  --severity-low-bg: rgba(37, 99, 235, 0.15);
  --severity-low-border: rgba(37, 99, 235, 0.3);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px rgba(0,0,0,0.3);
}
[data-theme="dark"] code { background: #334155; border-color: #475569; color: #e2e8f0; }
[data-theme="dark"] pre { background: #0a0f1a; border-color: #1e293b; }
[data-theme="dark"] blockquote { background: rgba(99, 102, 241, 0.08); border-left-color: var(--color-accent); }
[data-theme="dark"] table th { background: #1e293b; }
[data-theme="dark"] table td { background: var(--color-surface); }
[data-theme="dark"] table tr:hover td { background: rgba(255,255,255,0.04); }
[data-theme="dark"] tbody tr:hover td { background: #283548; }
[data-theme="dark"] details.finding-card summary:hover { background: #283548; }
[data-theme="dark"] details.finding-card[open] summary { background: #1e293b; border-bottom-color: var(--color-border); }
[data-theme="dark"] details:not(.finding-card) summary:hover { background: #283548; }
[data-theme="dark"] .filter-btn:hover { background: #283548; }
[data-theme="dark"] .finding-block-title { background: #1e293b; }
[data-theme="dark"] .filter-search { background: var(--color-surface); color: var(--color-text); border-color: var(--color-border); }
[data-theme="dark"] .filter-search:focus { box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.2); }
[data-theme="dark"] .hero-card { border-color: var(--color-border); }
[data-theme="dark"] .hero-stats .stat-card { border-color: var(--color-border); }
[data-theme="dark"] .effort-quick { background: rgba(5, 150, 105, 0.12); color: #34d399; border-color: rgba(5, 150, 105, 0.3); }
[data-theme="dark"] .effort-strategic { background: rgba(37, 99, 235, 0.12); color: #60a5fa; border-color: rgba(37, 99, 235, 0.3); }
[data-theme="dark"] .section-card { background: #162033; }
[data-theme="dark"] .config-summary { color: var(--color-muted); }

/* ── Print ── */
@media print {
  .sidebar, .back-to-top, .filter-bar, .sidebar-actions, .theme-toggle { display: none !important; }
  .report-main { margin-left: 0 !important; padding: 0 !important; }
  body { background: #fff; font-size: 12px; color: #0f172a; }
  .report-layout { display: block; }
  details { break-inside: avoid; }
  details[open] summary { break-after: avoid; }
  table { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  .finding-block { break-inside: avoid; }
  a { color: inherit !important; }
  pre { white-space: pre-wrap; word-break: break-all; }
  .grade-card { box-shadow: none; border: 2px solid #e2e8f0; }
  .section-card { box-shadow: none; border: 1px solid #e2e8f0; background: #e2e8f0; }
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .sidebar { display: none; }
  .report-main { margin-left: 0; padding: var(--space-4); }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .filter-bar { flex-direction: column; align-items: stretch; }
  .filter-search { margin-left: 0; min-width: auto; }
  .section-card { padding: var(--space-4); }
  .hero-stats { grid-template-columns: repeat(2, 1fr); }
  .report-meta { gap: var(--space-1) var(--space-3); }
}
  `;

  /* ── Minimal vanilla JS for interactivity ──────────────────────── */
  const js = `(function(){
  'use strict';
  // ── Build sidebar nav from h2 headings ──
  var main=document.getElementById('report-main');
  var nav=document.querySelector('.sidebar-nav');
  if(!main||!nav) return;
  var headings=main.querySelectorAll('h2');
  var sections=[];
  headings.forEach(function(h,i){
    var raw=h.textContent||'';
    // strip leading emoji/symbol characters
    var text=raw.replace(/^[\\s\\u2600-\\u27BF\\uD83C-\\uDBFF\\uDC00-\\uDFFF\\uFE00-\\uFE0F]+/u,'').trim();
    if(!text) text=raw.trim();
    var id='section-'+i;
    h.id=id;
    sections.push({id:id,el:h});
    var li=document.createElement('li');
    var a=document.createElement('a');
    a.href='#'+id;
    a.textContent=text;
    a.dataset.section=id;
    li.appendChild(a);
    nav.appendChild(li);
  });

  // ── Scroll-spy ──
  var activeId=null;
  function spy(){
    var y=window.scrollY+100;
    var cur=null;
    for(var i=sections.length-1;i>=0;i--){
      if(sections[i].el.offsetTop<=y){cur=sections[i].id;break;}
    }
    if(cur===activeId) return;
    if(activeId){var p=nav.querySelector('a[data-section=\"'+activeId+'\"]');if(p)p.classList.remove('active');}
    if(cur){var n=nav.querySelector('a[data-section=\"'+cur+'\"]');if(n)n.classList.add('active');}
    activeId=cur;
  }
  window.addEventListener('scroll',spy,{passive:true});
  spy();

  // ── Wrap section content in cards ──
  for(var s=0;s<sections.length;s++){
    var hEl=sections[s].el;
    var card=document.createElement('div');
    card.className='section-card';
    var nextH=sections[s+1]?sections[s+1].el:null;
    if(hEl.nextSibling){hEl.parentNode.insertBefore(card,hEl.nextSibling);}
    else{hEl.parentNode.appendChild(card);}
    while(card.nextSibling){
      var nx=card.nextSibling;
      if(nx===nextH)break;
      if(nx.nodeType===1&&nx.tagName==='HR'){nx.parentNode.removeChild(nx);continue;}
      card.appendChild(nx);
    }
  }

  // ── Back to top ──
  var btt=document.getElementById('back-to-top');
  if(btt){
    window.addEventListener('scroll',function(){btt.classList.toggle('visible',window.scrollY>300);},{passive:true});
    btt.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
  }

  // ── Expand / Collapse all ──
  var expBtn=document.getElementById('btn-expand-all');
  if(expBtn){
    var open=false;
    expBtn.addEventListener('click',function(){
      open=!open;
      document.querySelectorAll('details.finding-card').forEach(function(d){d.open=open;});
      expBtn.textContent=open?'\\u229F Collapse all':'\\u229E Expand all';
    });
  }

  // ── Theme toggle ──
  var themeBtn=document.getElementById('theme-toggle');
  if(themeBtn){
    var html=document.documentElement;
    themeBtn.addEventListener('click',function(){
      var isDark=html.dataset.theme==='dark';
      html.dataset.theme=isDark?'light':'dark';
      localStorage.setItem('scantrix-theme',html.dataset.theme);
    });
  }

  // ── Severity filter + search ──
  var filterBtns=document.querySelectorAll('.filter-btn[data-severity]');
  var searchBox=document.getElementById('finding-search');
  var activeSev='all';
  function applyFilters(){
    var term=searchBox?searchBox.value.toLowerCase():'';
    var cards=document.querySelectorAll('details.finding-card');
    cards.forEach(function(f){
      var sev=f.dataset.severity||'';
      var txt=(f.querySelector('summary')||{}).textContent||'';
      var sevOk=activeSev==='all'||sev===activeSev;
      var txtOk=!term||txt.toLowerCase().indexOf(term)!==-1;
      f.classList.toggle('hidden',!(sevOk&&txtOk));
    });
    // also hide/show severity group headings if all children hidden
    document.querySelectorAll('h3').forEach(function(h){
      var next=h.nextElementSibling;
      if(!next||!next.classList.contains('finding-card')) return;
      var anyVisible=false;
      var el=h.nextElementSibling;
      while(el&&el.tagName==='DETAILS'){
        if(!el.classList.contains('hidden')) anyVisible=true;
        el=el.nextElementSibling;
      }
      h.classList.toggle('hidden',!anyVisible);
    });
    var vc=0;
    cards.forEach(function(c){if(!c.classList.contains('hidden'))vc++;});
    var fc=document.getElementById('filter-count');
    if(fc){
      if(activeSev==='all'&&!term) fc.textContent='';
      else fc.textContent='Showing '+vc+' of '+cards.length+' findings';
    }
  }
  filterBtns.forEach(function(b){
    b.addEventListener('click',function(){
      activeSev=b.dataset.severity;
      filterBtns.forEach(function(x){x.classList.toggle('active',x===b);});
      applyFilters();
    });
  });
  if(searchBox) searchBox.addEventListener('input',applyFilters);
})();`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${css}</style>
<script>(function(){var t=localStorage.getItem('scantrix-theme');if(t){document.documentElement.dataset.theme=t;}else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches){document.documentElement.dataset.theme='dark';}})();</script>
</head>
<body>
<div class="report-layout">
  <nav class="sidebar" aria-label="Report navigation">
    <div class="sidebar-brand">${opts.sidebarLogoSvg ? `<span class="brand-logo">${opts.sidebarLogoSvg}</span>` : '<span class="brand-text">Scantrix</span>'}</div>
    <div class="sidebar-label">Sections</div>
    <ul class="sidebar-nav" role="list"></ul>
    <div class="sidebar-actions">
      <div class="theme-toggle">
        <button id="theme-toggle" class="theme-toggle-track" type="button" aria-label="Toggle theme"></button>
        <span class="theme-toggle-label">Dark mode</span>
      </div>
      <button id="btn-expand-all" type="button">&#x229E; Expand all</button>
      <button onclick="window.print()" type="button">&#128424; Print report</button>
    </div>
  </nav>
  <main id="report-main" class="report-main">
    <div class="report-content">
${bodyHtml}
    </div>
  </main>
</div>
<button id="back-to-top" class="back-to-top" aria-label="Back to top" title="Back to top">&uarr;</button>
<script>${js}</script>
</body>
</html>`;
}

/* ── Email‐friendly HTML wrapper (no sidebar / JS) ───────────────── */
function wrapEmailDocument(title: string, bodyHtml: string): string {
  const emailCss = `
:root {
  --text: #1a1f36; --muted: #6b7280; --border: #e2e4e8;
  --header: #111827; --accent: #3b82f6;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  color: var(--text); line-height: 1.5; margin: 0; padding: 0;
  background: #ffffff; font-size: 14px;
}
main { max-width: 720px; margin: 0 auto; padding: 16px; }
h1,h2,h3,h4 { line-height: 1.3; }
h1 { font-size: 1.5em; color: var(--header); }
h2 { font-size: 1.25em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
h3 { font-size: 1.05em; } h4 { font-size: 0.95em; }
p { margin: 6px 0; } ul,ol { padding-left: 20px; } li { margin: 2px 0; }
hr { border:0; border-top: 1px solid var(--border); margin: 16px 0; }
a { color: var(--accent); text-decoration: none; }
code { font-family: Menlo,Consolas,monospace; font-size: 0.9em; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
pre { background: #f3f4f6; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; }
pre code { background: transparent; padding: 0; }
table { width:100%; border-collapse: collapse; margin: 8px 0; font-size: 0.9em; }
th,td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
th { background: #f9fafb; font-weight: 600; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #C7D2FE; background: #F3F4FF; border-radius: 4px; }
.report-footer-logo { display: block; margin: 10px auto; max-width: 200px; }
.report-footer-text { margin: 4px 0; color: var(--muted); font-size: 0.9em; text-align: center; }
.finding-block { margin: 8px 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.finding-block-title { padding: 6px 10px; font-weight: 600; background: #f9fafb; border-bottom: 1px solid var(--border); font-size: 0.9em; }
.finding-block-body { padding: 8px 10px; font-size: 0.9em; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
.badge-high { background: #fef2f2; color: #dc2626; } .badge-medium { background: #fffbeb; color: #d97706; } .badge-low { background: #eff6ff; color: #2563eb; }
.escalation-tag { font-size: 10px; color: #d97706; cursor: help; margin-left: 2px; }
img { max-width: 100%; }
  `;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title><style>${emailCss}</style></head>
<body><main>
${bodyHtml}
</main></body></html>`;
}

async function loadFooterLogoDataUri(): Promise<string | undefined> {
  // Prefer a stable asset path; keep failure non-fatal.
  const logoPath = path.join(process.cwd(), "assets", "scantrix-logo-wide.svg");
  try {
    const bytes = await fs.readFile(logoPath);
    return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function loadSidebarLogoSvg(): Promise<string | undefined> {
  // Try co-located src/assets first, then fall back to project root assets.
  const candidates = [
    path.join(__dirname, "assets", "scantrix-sidebar.svg"),
    path.join(process.cwd(), "src", "assets", "scantrix-logo.svg"),
  ];
  for (const p of candidates) {
    try {
      let svg = await fs.readFile(p, "utf-8");
      // Strip XML declaration — not valid when inlined in HTML
      svg = svg.replace(/<\?xml[^?]*\?>\s*/g, "").trim();
      return svg;
    } catch { /* try next */ }
  }
  return undefined;
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
    } else if (f.findingId === "PW-FLAKE-009") {
      const n = f.totalOccurrences ?? f.evidence.length;
      actions.push(`Remove ${n} debug pause${n > 1 ? 's' : ''} (page.pause)`);
    } else if (f.findingId === "PW-INSIGHT-001") {
      actions.push("Fix root cause of flaky tests before relying on retries");
    } else if (f.findingId === "PW-INSIGHT-008") {
      actions.push("Enable trace/video capture and publish test artifacts in CI");
    } else if (f.findingId === "PW-STABILITY-001") {
      const n = f.totalOccurrences ?? f.evidence.length;
      actions.push(`Add cleanup hooks to ${n} test file${n > 1 ? 's' : ''}`);
    } else if (f.findingId === "PW-STABILITY-003") {
      const n = f.totalOccurrences ?? f.evidence.length;
      actions.push(`Move page-based setup out of beforeAll in ${n} file${n > 1 ? 's' : ''}`);
    } else if (f.findingId === "CI-002") {
      actions.push("Configure Playwright HTML report publishing in CI");
    } else if (f.findingId === "CI-007") {
      actions.push(`Implement test sharding for faster CI (${f.evidence[0]?.snippet.match(/\d+/)?.[0] || 'many'} test files)`);
    } else if (f.findingId === "CI-009") {
      actions.push("Publish test-results artifacts to debug retry failures");
    } else if (f.findingId === "ARCH-003") {
      const n = f.totalOccurrences ?? f.evidence.length;
      actions.push(`Extract shared code from ${n} test file${n > 1 ? 's' : ''} to utility modules`);
    } else if (f.findingId === "ARCH-005") {
      actions.push("Move hardcoded credentials to environment variables");
    } else if (f.findingId === "DEP-002") {
      const n = f.totalOccurrences ?? f.evidence.length;
      actions.push(`Replace ${n} deprecated npm package${n > 1 ? 's' : ''} with supported alternatives`);
    } else {
      // Generic high-severity action
      actions.push(f.recommendation.split('.')[0]);
    }
  }

  // Fill remaining slots with medium severity items
  if (actions.length < 3) {
    const mediumFindings = findings.filter(f => f.severity === "medium").sort((a, b) => (b.totalOccurrences ?? b.evidence.length) - (a.totalOccurrences ?? a.evidence.length));
    for (const f of mediumFindings) {
      if (actions.length >= 3) break;
      const n = f.totalOccurrences ?? f.evidence.length;

      if (f.findingId === "PW-FLAKE-002" || f.findingId === "CY-FLAKE-003") {
        actions.push(`Remove ${n} force-click pattern${n > 1 ? 's' : ''}`);
      } else if (f.findingId === "PW-STABILITY-001") {
        actions.push(`Add cleanup hooks to ${n} test file${n > 1 ? 's' : ''}`);
      } else if (f.findingId === "PW-STABILITY-002") {
        actions.push(`Organize ${n} test file${n > 1 ? 's' : ''} with describe blocks`);
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
        actions.push(`Add proper TypeScript typing to ${n} fixture file${n > 1 ? 's' : ''}`);
      } else if (f.findingId === "PW-FLAKE-010") {
        actions.push(`Guard ${n} retrieval method${n > 1 ? 's' : ''} with web-first assertions`);
      } else {
        actions.push(f.recommendation.split('.')[0]);
      }
    }
  }

  return actions.slice(0, 3);
}

function getTopHotspotsAcrossFindings(findings: ScanResults["findings"]): Array<{file: string; issueCount: number; findingTypes: string[]; highCount: number; mediumCount: number; lowCount: number}> {
  // Aggregate all files across findings, weighted by severity
  const fileStats = new Map<string, { count: number; findingIds: Set<string>; highCount: number; mediumCount: number; lowCount: number }>();

  for (const f of findings) {
    // Skip CI findings (they're pipeline-level, not code hotspots)
    if (f.findingId.startsWith("CI-") || f.findingId.startsWith("PW-INSIGHT-")) continue;

    const weight = severityScore(f.severity);

    for (const e of f.evidence) {
      // Normalize the file path to avoid path casing issues
      const normalizedFile = e.file.replace(/\\/g, "/");

      // Skip summary/meta evidence lines
      if (normalizedFile.includes("(CI summary)") || normalizedFile.includes("(correlation")) continue;

      const existing = fileStats.get(normalizedFile) || { count: 0, findingIds: new Set<string>(), highCount: 0, mediumCount: 0, lowCount: 0 };
      existing.count += weight;
      existing.findingIds.add(f.findingId);
      if (f.severity === "high") existing.highCount++;
      else if (f.severity === "medium") existing.mediumCount++;
      else existing.lowCount++;
      fileStats.set(normalizedFile, existing);
    }
  }

  // Convert to sorted array
  return [...fileStats.entries()]
    .map(([file, stats]) => ({
      file,
      issueCount: stats.count,
      findingTypes: [...stats.findingIds],
      highCount: stats.highCount,
      mediumCount: stats.mediumCount,
      lowCount: stats.lowCount,
    }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 5);
}

function buildCategoryMatrix(findings: ScanResults["findings"]): Map<string, {high: number; medium: number; low: number}> {
  const matrix = new Map<string, {high: number; medium: number; low: number}>();
  for (const f of findings) {
    const category = f.findingId.startsWith("PW-FLAKE") ? "Flakiness" :
      f.findingId.startsWith("PW-STABILITY") ? "Stability" :
      f.findingId.startsWith("PW-LOC") ? "Locators" :
      f.findingId.startsWith("PW-PERF") ? "Performance" :
      f.findingId.startsWith("PW-INSIGHT") ? "Insights" :
      f.findingId.startsWith("CI-") ? "CI/CD" :
      f.findingId.startsWith("ARCH-") ? "Architecture" :
      f.findingId.startsWith("DEP-") ? "Dependencies" :
      "Other";
    const entry = matrix.get(category) || { high: 0, medium: 0, low: 0 };
    if (f.severity === "high") entry.high++;
    else if (f.severity === "medium") entry.medium++;
    else entry.low++;
    matrix.set(category, entry);
  }
  return matrix;
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
    "PW-FLAKE-009": { min: 0.25, max: 0.5 },  // Debug pauses - simple removal
    "PW-FLAKE-002": { min: 0.5, max: 2 },   // Force clicks
    "CY-FLAKE-003": { min: 0.5, max: 2 },   // Cypress force clicks
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
    "ARCH-008": { min: 1, max: 3 },         // Large inline test data
    "ARCH-009": { min: 0.5, max: 2 },       // Inline config overrides
    "PW-FLAKE-010": { min: 1, max: 3 },     // Retrieval methods - add guards
    "PW-FLAKE-003": { min: 0.5, max: 1 },   // test.only/skip
    "PW-FLAKE-004": { min: 1, max: 3 },     // networkidle
    "PW-STABILITY-004": { min: 2, max: 6 }, // Tests without assertions
    "PW-STABILITY-005": { min: 1, max: 2 }, // Browser resource leaks
    "PW-STABILITY-006": { min: 0.5, max: 2 }, // Too many assertions
    "SE-STABILITY-001": { min: 1, max: 2 }, // WebDriver resource leaks
    "ARCH-010": { min: 1, max: 3 },         // Hardcoded inline test data
    "PW-LOC-002": { min: 1, max: 3 },       // Deep CSS nesting
    "PW-LOC-003": { min: 0.5, max: 2 },     // nth/first/last
    "PW-PERF-003": { min: 1, max: 3 },      // networkidle + high timeout
    "CI-011": { min: 0.25, max: 0.5 },      // Missing playwright install
    "CI-012": { min: 0.25, max: 0.5 },      // CI env mismatch
    "CI-013": { min: 0.25, max: 0.5 },      // Pipeline timeout
    "CI-014": { min: 0.25, max: 0.5 },      // No reporter override
    "DEP-001": { min: 1, max: 4 },            // Outdated dependencies
    "DEP-002": { min: 1, max: 4 },            // Deprecated npm packages
  };

  // Calculate time to address high severity issues (to reach "Good" grade)
  for (const f of highSeverity) {
    const estimate = timeEstimates[f.findingId] ?? { min: 1, max: 3 };
    // Scale by file count for larger scope issues
    const fileCount = f.affectedFiles ?? new Set(f.evidence.map(e => e.file)).size;
    const scale = Math.min(Math.max(1, fileCount / 3), 3); // Cap scaling at 3x
    toGoodMin += estimate.min * scale;
    toGoodMax += estimate.max * scale;
  }

  // Calculate total time for all issues
  for (const f of [...highSeverity, ...mediumSeverity, ...lowSeverity]) {
    const estimate = timeEstimates[f.findingId] ?? { min: 1, max: 3 };
    const fileCount = f.affectedFiles ?? new Set(f.evidence.map(e => e.file)).size;
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
    const fileCount = f.affectedFiles ?? new Set(f.evidence.map(e => e.file)).size;
    const occurrences = f.totalOccurrences ?? f.evidence.length;

    // Categorize based on finding type and scope
    switch (f.findingId) {
      case "PW-FLAKE-002": // Force clicks - usually few occurrences, easy fix
      case "CY-FLAKE-003": // Cypress force clicks
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

      case "PW-FLAKE-009": // Debug pauses
        quickWins.push({
          finding: `Remove ${occurrences} debug pause${occurrences > 1 ? 's' : ''} (page.pause)`,
          effort: "~15 min",
          impact: "Prevents CI hangs from leftover debug pauses",
        });
        break;

      case "PW-FLAKE-010": // Retrieval methods
        if (occurrences <= 5) {
          quickWins.push({
            finding: `Add content guards to ${occurrences} retrieval method call${occurrences > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Prevents empty/stale text extraction",
          });
        } else {
          largerEfforts.push({
            finding: `Add content guards to ${occurrences} retrieval calls across ${fileCount} files`,
            effort: "3-6 hours",
            impact: "Prevents empty/stale text extraction",
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
          // Skip - informational
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

        case "PW-STABILITY-005": // Browser resource leaks
        case "SE-STABILITY-001": // WebDriver resource leaks
          largerEfforts.push({
            finding: `Add resource cleanup to ${fileCount} test file${fileCount > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Prevent memory leaks + zombie processes",
          });
          break;

        case "PW-STABILITY-006": // Too many assertions per test
          quickWins.push({
            finding: `Split ${occurrences} over asserted test${occurrences > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Clearer test failures",
          });
          break;

        case "ARCH-010": // Hardcoded inline test data
          quickWins.push({
            finding: `Extract inline test data from ${fileCount} file${fileCount > 1 ? 's' : ''} to fixtures`,
            effort: "1-2 hours",
            impact: "Easier data maintenance",
          });
          break;

      case "DEP-001": // Outdated dependencies
        if (occurrences <= 3) {
          quickWins.push({
            finding: `Update ${occurrences} outdated Playwright package${occurrences > 1 ? 's' : ''}`,
            effort: "1-2 hours",
            impact: "Stay current, reduce flakiness",
          });
        } else {
          largerEfforts.push({
            finding: `Update ${occurrences} outdated Playwright packages`,
            effort: "2-4 hours",
            impact: "Stay current, reduce flakiness",
          });
        }
        break;

      case "DEP-002": // Deprecated npm packages
        largerEfforts.push({
          finding: `Replace ${occurrences} deprecated npm package${occurrences > 1 ? 's' : ''}`,
          effort: "1-4 hours",
          impact: "Avoid unmaintained/vulnerable deps",
        });
        break;

      default:
        break;
    }
  }

  return { quickWins: quickWins.slice(0, 4), largerEfforts: largerEfforts.slice(0, 4) };
}

export interface ReportOptions {
  /** Path to baseline findings.json for diff/trend tracking */
  baselinePath?: string;
  /** Baseline snapshot meta (used for inventory comparison) */
  baselineMeta?: SnapshotMeta;
  /** Output formats to produce (defaults to all standard formats) */
  formats?: Array<"md" | "html" | "json" | "sarif" | "email">;
}

export async function writeReportArtifacts(outDir: string, results: ScanResults, options?: ReportOptions) {
  await fs.mkdir(outDir, { recursive: true });

  const footerLogoDataUri = await loadFooterLogoDataUri();
  const sidebarLogoSvg = await loadSidebarLogoSvg();

  const findingsSorted = [...results.findings].sort(
    (a, b) => severityScore(b.severity) - severityScore(a.severity)
  );

  const risk = calculateRiskScore(findingsSorted, {
    testFiles: results.inventory.testFiles,
    cypressTestFiles: results.inventory.cypressTestFiles,
    seleniumTestFiles: results.inventory.seleniumTestFiles,
  });
  const topActions = getTopActionItems(findingsSorted);

  const md: string[] = [];

  const highCount = findingsSorted.filter(f => f.severity === "high").length;
  const mediumCount = findingsSorted.filter(f => f.severity === "medium").length;
  const lowCount = findingsSorted.filter(f => f.severity === "low").length;
  const totalFindings = highCount + mediumCount + lowCount;

  // Professional Header
  md.push(`<div align="center">`);
  md.push(``);
  md.push(`# Automation Framework Audit Report`);
  md.push(``);
  md.push(`**Findings, Risks, and Recommendations**`);
  md.push(``);
  md.push(`</div>`);
  md.push(``);

  // Compact metadata bar
  md.push(`<div class="report-meta">`);
  md.push(`<span class="meta-item"><strong>Repository:</strong> <code>${results.repoPath.split(/[/\\]/).pop()}</code></span>`);
  md.push(`<span class="meta-item"><strong>Branch:</strong> <code>${results.gitBranch ?? 'unknown'}</code></span>`);
  md.push(`<span class="meta-item"><strong>Generated:</strong> ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</span>`);
  md.push(`<span class="meta-item"><strong>Playwright:</strong> ${results.inventory.playwrightVersion ?? 'Unknown'}</span>`);
  md.push(`<span class="meta-item"><strong>Files scanned:</strong> ${results.inventory.totalFiles}</span>`);
  md.push(`</div>`);
  md.push(``);

  // ── Section 1: EXECUTIVE SUMMARY ──
  md.push(`## EXECUTIVE SUMMARY`);
  md.push(``);

  const gradeLetter = risk.grade.toUpperCase();
  const gradeClass = `grade-${gradeLetter.toLowerCase()}`;
  md.push(`<div class="hero-card">`);
  md.push(`<div class="hero-grade">`);
  md.push(`<div class="grade-letter ${gradeClass}">${gradeLetter}</div>`);
  md.push(`<div class="grade-detail">`);
  md.push(`<div class="grade-level">${risk.level} (${risk.riskScore}/100)</div>`);
  md.push(`<div class="grade-desc">${risk.description}</div>`);
  md.push(`</div>`);
  md.push(`</div>`);
  md.push(`<div class="hero-stats">`);
  md.push(`<div class="stat-card"><div class="stat-label">Total Findings</div><div class="stat-value">${totalFindings}</div></div>`);
  md.push(`<div class="stat-card stat-card-high"><div class="stat-label">High</div><div class="stat-value stat-high">${highCount}</div></div>`);
  md.push(`<div class="stat-card stat-card-medium"><div class="stat-label">Medium</div><div class="stat-value stat-medium">${mediumCount}</div></div>`);
  md.push(`<div class="stat-card stat-card-low"><div class="stat-label">Low</div><div class="stat-value stat-low">${lowCount}</div></div>`);
  md.push(`</div>`);
  const densityNote = risk.densityInfo
    ? `${risk.densityInfo.effectiveTestFiles} test files (${risk.densityInfo.densityFactor}× scale factor, ${risk.densityInfo.findingDensity} findings/file).`
    : "";
  const tooltipAttr = densityNote
    ? ` title="${escapeHtml(densityNote)}"`
    : "";
  md.push(
    `<div class="hero-footnote">` +
      `Health score (0-100). Scale normalized based on findings per file density.` +
      (densityNote
        ? ` <span class="info-tip"${tooltipAttr} aria-label="Density details">ⓘ</span>`
        : "") +
    `</div>`
  );
  md.push(`</div>`);
  md.push(``);

  // ── Section 2: RECOMMENDED ACTIONS (moved up) ──
  md.push(`## RECOMMENDED ACTIONS`);
  md.push(``);

  if (topActions.length > 0) {
    md.push(`### Top 3 Priority Items`);
    md.push(``);
    topActions.forEach((action, i) => {
      md.push(` **${i + 1}.** ${action}`);
      md.push(``);
    });
  }

  // Consolidated effort table
  const { quickWins, largerEfforts } = categorizeFindings(findingsSorted);
  if (quickWins.length > 0 || largerEfforts.length > 0) {
    md.push(`### Effort Estimation`);
    md.push(``);
    md.push(`| Action Item | Effort | Time Estimate | Expected Impact |`);
    md.push(`|-------------|--------|---------------|-----------------|`);
    for (const qw of quickWins) {
      md.push(`| ${qw.finding} | <span class="badge effort-quick">Quick Win</span> | ${qw.effort} | ${qw.impact} |`);
    }
    for (const le of largerEfforts) {
      md.push(`| ${le.finding} | <span class="badge effort-strategic">Strategic</span> | ${le.effort} | ${le.impact} |`);
    }
    md.push(``);

    // Time Summary
    const timeEstimate = calculateRemediationTime(findingsSorted);
    md.push(`#### Remediation Time Summary`);
    md.push(``);
    md.push(`| Target | Estimated Time | Scope |`);
    md.push(`|--------|----------------|-------|`);
    if (risk.grade !== 'A' && risk.grade !== 'B') {
      md.push(`| **Reach Grade B (Good)** | ${formatTimeRange(timeEstimate.toGoodGrade.minHours, timeEstimate.toGoodGrade.maxHours)} | Address ${timeEstimate.highPriorityCount} high-severity finding${timeEstimate.highPriorityCount !== 1 ? 's' : ''} |`);
    }
    md.push(`| **Address All Issues** | ${formatTimeRange(timeEstimate.toAllResolved.minHours, timeEstimate.toAllResolved.maxHours)} | Resolve all ${timeEstimate.totalIssueCount} finding${timeEstimate.totalIssueCount !== 1 ? 's' : ''} |`);
    md.push(``);
    md.push(`> *Time estimates assume a single engineer familiar with the codebase. Actual time may vary based on complexity and team experience.*`);
    md.push(``);
  }

  // ── Section 3: RISK ASSESSMENT ──
  md.push(`## RISK ASSESSMENT`);
  md.push(``);

  const topHotspots = getTopHotspotsAcrossFindings(findingsSorted);
  if (topHotspots.length > 0) {
    md.push(`### Priority Files`);
    md.push(`> *These files have the highest concentration of issues and should be addressed first.*`);
    md.push(``);
    md.push(`| File | Issues Found |`);
    md.push(`|------|--------------|`);
    for (const hotspot of topHotspots) {
      const fileName = hotspot.file.split('/').pop() || hotspot.file;
      const badges: string[] = [];
      if (hotspot.highCount > 0) badges.push(`<span class="badge badge-high">${hotspot.highCount}</span>`);
      if (hotspot.mediumCount > 0) badges.push(`<span class="badge badge-medium">${hotspot.mediumCount}</span>`);
      if (hotspot.lowCount > 0) badges.push(`<span class="badge badge-low">${hotspot.lowCount}</span>`);
      md.push(`| \`${fileName}\` | ${badges.join(' ')} |`);
    }
    md.push(``);
  }

  // ── Section 4: FINDINGS OVERVIEW (severity×category matrix) ──
  md.push(`## FINDINGS OVERVIEW`);
  md.push(``);

  if (findingsSorted.length > 0) {
    const categoryMatrix = buildCategoryMatrix(findingsSorted);
    md.push(`<div class="severity-matrix">`);
    md.push(``);
    md.push(`| Category | High | Medium | Low | Total |`);
    md.push(`|----------|------|--------|-----|-------|`);
    for (const [cat, counts] of categoryMatrix) {
      const total = counts.high + counts.medium + counts.low;
      const hCell = counts.high > 0 ? `<span class="badge badge-high">${counts.high}</span>` : '\u2014';
      const mCell = counts.medium > 0 ? `<span class="badge badge-medium">${counts.medium}</span>` : '\u2014';
      const lCell = counts.low > 0 ? `<span class="badge badge-low">${counts.low}</span>` : '\u2014';
      md.push(`| ${cat} | ${hCell} | ${mCell} | ${lCell} | ${total} |`);
    }
    md.push(``);
    md.push(`</div>`);
    md.push(``);
  }

  // ── Section 5: DETAILED FINDINGS ──
  md.push(`## DETAILED FINDINGS`);
  md.push(``);

  if (!findingsSorted.length) {
    md.push(`> **Excellent!** No issues were detected by the current audit rules.`);
    md.push(``);
  } else {
    // Filter bar
    md.push(`<div class="filter-bar" role="toolbar" aria-label="Filter findings">`);
    md.push(`<label>Filter:</label>`);
    md.push(`<button class="filter-btn active" data-severity="all" type="button">All (${totalFindings})</button>`);
    if (highCount > 0) md.push(`<button class="filter-btn" data-severity="high" type="button">High (${highCount})</button>`);
    if (mediumCount > 0) md.push(`<button class="filter-btn" data-severity="medium" type="button">Medium (${mediumCount})</button>`);
    if (lowCount > 0) md.push(`<button class="filter-btn" data-severity="low" type="button">Low (${lowCount})</button>`);
    md.push(`<input type="search" class="filter-search" id="finding-search" placeholder="Search findings..." aria-label="Search findings"/>`);
    md.push(`</div>`);
    md.push(`<div class="filter-count" id="filter-count"></div>`);
    md.push(``);

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
      md.push(`### 🔵 Low Severity Issues`);
      md.push(``);
      for (const f of lowFindings) {
        renderFinding(md, f);
      }
    }
  }

  // ── Section 6: CONFIGURATION OVERVIEW ──
  md.push(`## CONFIGURATION OVERVIEW`);
  md.push(``);

  // Playwright Config
  const pw = results.inventory.playwrightConfigSummary as PlaywrightConfigSummary | undefined;
  const allConfigs = results.inventory.playwrightConfigPaths;
  if (pw) {
    md.push(`### Playwright Configuration`);
    md.push(``);
    // Config summary line
    const pwSummaryParts: string[] = [];
    if (pw.workers) pwSummaryParts.push(`Workers: ${pw.workers}`);
    if (pw.retries) pwSummaryParts.push(`Retries: ${pw.retries}`);
    if (pw.timeoutMs) pwSummaryParts.push(`Timeout: ${Math.round(pw.timeoutMs / 1000)}s`);
    if (pw.use?.trace) pwSummaryParts.push(`Trace: ${pw.use.trace}`);
    else pwSummaryParts.push(`Trace: off`);
    if (pwSummaryParts.length > 0) {
      md.push(`<p class="config-summary">${pwSummaryParts.join(' \u00b7 ')}</p>`);
      md.push(``);
    }
    if (allConfigs && allConfigs.length > 1) {
      md.push(`> **${allConfigs.length} config files detected** — showing details for the primary config. All configs listed below.`);
      md.push(``);
    }
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

    if (allConfigs && allConfigs.length > 1) {
      md.push(``);
      md.push(`**All Playwright Config Files:**`);
      for (const cp of allConfigs) {
        md.push(`- \`${cp}\``);
      }
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
    // CI summary line
    const ciPlatform = ci.detectedAzurePipelines ? 'Azure Pipelines' : ci.detectedGitHubActions ? 'GitHub Actions' : 'Unknown';
    const ciSummaryParts = [
      ciPlatform,
      `${ci.files.length} pipeline${ci.files.length !== 1 ? 's' : ''}`,
      ci.usesCache ? 'Caching enabled' : 'No caching',
      ci.usesSharding ? 'Sharding enabled' : 'No sharding',
    ];
    md.push(`<p class="config-summary">${ciSummaryParts.join(' \u00b7 ')}</p>`);
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

  // ── Section 7: Appendix ──
  md.push(`## Appendix`);
  md.push(``);
  md.push(`### Repository Statistics`);
  md.push(``);
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| Total Files Scanned | ${results.inventory.totalFiles} |`);
  md.push(`| Test Files | ${results.inventory.testFiles} |`);
  if (results.inventory.testCases != null) md.push(`| Test Cases | ${results.inventory.testCases} |`);
  md.push(`| Playwright Config | ${results.inventory.hasPlaywrightConfig ? `Found (${results.inventory.playwrightConfigPaths?.length ?? 1} file${(results.inventory.playwrightConfigPaths?.length ?? 1) > 1 ? 's' : ''})` : 'Not found'} |`);
  if (results.gitBranch) md.push(`| Branch | \`${results.gitBranch}\` |`);
  if (results.gitCommit) md.push(`| Commit | \`${results.gitCommit}\` |`);
  md.push(``);

  md.push(`### Score Interpretation Guide`);
  md.push(``);
  md.push(`| Grade | Level | Interpretation |`);
  md.push(`|:-----:|-------|----------------|`);
  md.push(`| **A** | 🟢 Excellent | Well structured framework with strong practices |`);
  md.push(`| **B** | 🟡 Good | Solid foundation with room for improvement |`);
  md.push(`| **C** | 🟠 Fair | Multiple areas need attention |`);
  md.push(`| **D** | 🔴 Poor | Significant issues affecting reliability |`);
  md.push(`| **F** | 🔴 Critical | Widespread issues requiring immediate action |`);
  md.push(``);
  md.push(`> *Grades are calculated using severity weighted findings and evidence concentration.*`);
  md.push(``);

  // Footer
  md.push(`<div align="center">`);
  md.push(``);

  if (footerLogoDataUri) {
    md.push(`<img class="report-footer-logo" src="${footerLogoDataUri}" alt="Scantrix" />`);
    md.push(``);
  }
  md.push(``);
  md.push(`<div class="report-footer-text"><b>Questions?</b> Contact QA Engineering team for remediation guidance.</div>`);
   md.push(`<div class="report-footer-text"><b>https://www.scantrix.app</b></div>`);
  md.push(``);
  md.push(`</div>`);

  const markdownReport = md.join("\n");

  const mdParser = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
  });

  const htmlBody = mdParser.render(markdownReport);
  const fullHtml = linkifyHttpUrlsInRenderedHtml(
    wrapHtmlDocument("Automation Framework Audit Report", htmlBody, "full", { sidebarLogoSvg })
  );

  const emailMarkdown = toEmailFriendlyMarkdown(markdownReport);
  const emailHtmlBody = mdParser.render(emailMarkdown);
  const emailHtml = linkifyHttpUrlsInRenderedHtml(
    wrapHtmlDocument(
      "Automation Framework Audit Report (Email)",
      emailHtmlBody,
      "email"
    )
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

  const repoName = results.repoPath.split(/[/\\]/).pop() || "unknown";
  await fs.writeFile(
    path.join(outDir, "findings.json"),
    JSON.stringify({ repoName, findings: findingsSorted }, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(outDir, "repo_inventory.json"),
    JSON.stringify({
      ...results.inventory,
      gitBranch: results.gitBranch,
      gitCommit: results.gitCommit,
    }, null, 2),
    "utf8"
  );

  // ── SARIF output ──────────────────────────────────────────────────
  const formats = options?.formats ?? ["md", "html", "json", "sarif", "email"];
  if (formats.includes("sarif")) {
    const sarif = toSarif(results);
    await fs.writeFile(
      path.join(outDir, "audit.sarif"),
      JSON.stringify(sarif, null, 2),
      "utf8"
    );
  }

  // ── Diff / trend report ───────────────────────────────────────────
  if (options?.baselinePath) {
    const baseline = await loadBaseline(options.baselinePath);
    if (baseline) {
      const diff = computeDiff(baseline, findingsSorted, {
        baselineInventory: options.baselineMeta,
        currentInventory: results.inventory,
      });
      const diffMd = formatDiffMarkdown(diff);
      await fs.writeFile(
        path.join(outDir, "audit_diff.md"),
        diffMd,
        "utf8"
      );
      await fs.writeFile(
        path.join(outDir, "audit_diff.json"),
        JSON.stringify(diff, null, 2),
        "utf8"
      );
    }
  }
}

function renderFinding(md: string[], f: { findingId: string; severity: string; title: string; description: string; recommendation: string; evidence: Array<{ file: string; line: number; snippet: string }>; totalOccurrences?: number; affectedFiles?: number; baseSeverity?: string; escalationReason?: string }) {
  const category = f.findingId.startsWith("PW-FLAKE") ? "flakiness" :
    f.findingId.startsWith("PW-STABILITY") ? "stability" :
    f.findingId.startsWith("PW-LOC") ? "locators" :
    f.findingId.startsWith("PW-PERF") ? "performance" :
    f.findingId.startsWith("PW-INSIGHT") ? "insights" :
    f.findingId.startsWith("PW-DEPREC") ? "deprecated" :
    f.findingId.startsWith("CI-") ? "ci" :
    f.findingId.startsWith("ARCH-") ? "architecture" :
    f.findingId.startsWith("DEP-") ? "dependencies" :
    "other";
  const badgeClass = f.severity === "high" ? "badge-high" : f.severity === "medium" ? "badge-medium" : "badge-low";
  const badgeLabel = f.severity === "high" ? "High" : f.severity === "medium" ? "Medium" : "Low";
  const escalationNote = f.baseSeverity
    ? ` <span class="escalation-tag" title="${escapeHtml(f.escalationReason ?? '')}">&#9650; from ${f.baseSeverity}</span>`
    : "";

  md.push(`<details class="finding-card" data-severity="${f.severity}" data-category="${category}" data-finding-id="${f.findingId}">`);
  md.push(`<summary><span class="badge ${badgeClass}">${badgeLabel}</span>${escalationNote} <strong>${f.findingId}</strong> &mdash; ${f.title}</summary>`);
  md.push(``);
  md.push(`> ${f.description}`);
  md.push(``);
  md.push(`<div class="finding-block">`);
  md.push(`<div class="finding-block-title"><b>Recommendation</b></div>`);
  // Important: keep the body content as Markdown (not raw HTML) so markdown-it
  // can apply linkify/code spans and produce clickable links in the final HTML.
  // formatRecommendation() converts \n-delimited text into proper Markdown with
  // paragraph breaks and fenced code blocks for indented example lines.
  md.push(`<div class="finding-block-body">`);
  md.push(``);
  md.push(formatRecommendation(f.recommendation));
  md.push(``);
  md.push(`</div>`);
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

  const totalHits = f.totalOccurrences ?? uniqueEvidence.size;
  const affectedFilesCount = f.affectedFiles ?? new Set([...uniqueEvidence.values()].map(e => e.file)).size;

  // Merge top affected files inline into Impact line
  const fileHitCounts = new Map<string, number>();
  for (const e of uniqueEvidence.values()) {
    fileHitCounts.set(e.file, (fileHitCounts.get(e.file) ?? 0) + 1);
  }
  const hotspots = [...fileHitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  let impactLine = `**Impact:** ${totalHits} occurrence${totalHits > 1 ? 's' : ''} across ${affectedFilesCount} file${affectedFilesCount > 1 ? 's' : ''}`;
  if (hotspots.length > 0 && !f.findingId.startsWith("CI-")) {
    const fileList = hotspots.map(([file, count]) => {
      const fileName = file.split(/[/\\]/).pop() || file;
      return `\`${fileName}\` (${count})`;
    }).join(', ');
    impactLine += ` \u2014 ${fileList}`;
  }
  md.push(impactLine);
  md.push(``);

  // Evidence samples (all)
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