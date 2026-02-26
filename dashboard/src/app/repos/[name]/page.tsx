"use client";

import React from "react";
import Spinner from "@/components/spinner";
import { useNavigationLoading } from "@/components/loading-provider";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import NavLink from "@/components/nav-link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/** Convert plain-text URLs inside a string into clickable <a> elements. */
function linkifyText(text: string): React.ReactNode {
  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    urlRegex.test(part)
      ? React.createElement("a", { key: i, href: part, target: "_blank", rel: "noopener noreferrer", className: "text-blue-400 underline hover:text-blue-300 break-all" }, part)
      : part
  );
}
import {
  ArrowLeft, ShieldCheck, AlertTriangle, Info, FileWarning,
  Clock, ChevronDown, ChevronRight, Settings, GitBranch, Monitor,
  Smartphone, Server, Workflow, Target, Zap, Flame, ListChecks,
  FolderOpen, Package, FileCode, Layers, BarChart3, SearchCode,
  Scan, Hourglass, TrendingDown, Wrench, FlaskConical
} from "lucide-react";

/* ── Types ── */
interface Evidence {
  file: string;
  line: number;
  snippet: string;
}

interface Finding {
  finding_id: string;
  severity: "low" | "medium" | "high";
  title: string;
  description?: string;
  recommendation?: string;
  evidence_count: number;
  evidence: Evidence[];
}

interface ScanSummary {
  id: number;
  scanned_at: string;
  findings_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score?: number;
  risk_grade?: string;
}

interface RepoDetail {
  repo: { id: number; name: string; url?: string; created_at: string; updated_at: string };
  latestScan: ScanSummary | null;
  isHistorical?: boolean;
  findings: Finding[];
  inventory: any | null;
  scanHistory: ScanSummary[];
}

/* ── Helpers ── */
const gradeColor: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const gradeBg: Record<string, string> = {
  A: "bg-emerald-500/15",
  B: "bg-blue-500/15",
  C: "bg-amber-500/15",
  D: "bg-orange-500/15",
  F: "bg-red-500/15",
};

const severityIcon: Record<string, React.ReactNode> = {
  high:   <AlertTriangle className="h-4 w-4 text-red-400" />,
  medium: <FileWarning className="h-4 w-4 text-amber-400" />,
  low:    <Info className="h-4 w-4 text-blue-400" />,
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatMs(ms: number) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

/* ── Hotspot / Priority Files computation ── */
interface Hotspot {
  file: string;
  fileName: string;
  issueCount: number;
  findingTypes: string[];
}

function severityWeight(s: string): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function computeHotspots(findings: Finding[]): Hotspot[] {
  const fileStats = new Map<string, { count: number; ids: Set<string> }>();

  for (const f of findings) {
    // Skip CI / insight findings — they are pipeline-level, not code hotspots
    if (f.finding_id.startsWith("CI-") || f.finding_id.startsWith("PW-INSIGHT-")) continue;

    const weight = severityWeight(f.severity);

    for (const e of f.evidence) {
      const normalized = e.file.replace(/\\/g, "/");
      if (normalized.includes("(CI summary)") || normalized.includes("(correlation")) continue;

      const existing = fileStats.get(normalized) || { count: 0, ids: new Set<string>() };
      existing.count += weight;
      existing.ids.add(f.finding_id);
      fileStats.set(normalized, existing);
    }
  }

  return [...fileStats.entries()]
    .map(([file, stats]) => ({
      file,
      fileName: file.split("/").pop() || file,
      issueCount: stats.count,
      findingTypes: [...stats.ids],
    }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 8);
}

/* ── Recommended Actions computation ── */
interface ActionItem {
  label: string;
  severity: "high" | "medium" | "low";
  findingId: string;
}

function computeActions(findings: Finding[]): ActionItem[] {
  const actions: ActionItem[] = [];
  const sorted = [...findings].sort((a, b) => {
    const sw = severityWeight(b.severity) - severityWeight(a.severity);
    return sw !== 0 ? sw : b.evidence_count - a.evidence_count;
  });

  const actionMap: Record<string, (f: Finding) => string> = {
    "PW-FLAKE-001": (f) => {
      const top = topEvidenceFile(f);
      return top
        ? `Remove ${top.count} hard wait${top.count > 1 ? "s" : ""} from ${top.name}`
        : "Remove hard waits (waitForTimeout/setTimeout)";
    },
    "PW-FLAKE-002": (f) => `Remove ${f.evidence_count} force-click pattern${f.evidence_count > 1 ? "s" : ""}`,
    "PW-FLAKE-005": (f) => `Replace ${f.evidence_count} page.pause() call${f.evidence_count > 1 ? "s" : ""}`,
    "PW-INSIGHT-001": () => "Fix root cause of flaky tests before relying on retries",
    "PW-INSIGHT-002": () => "Review and reduce excessive test timeouts",
    "PW-INSIGHT-008": () => "Enable trace/video capture and publish test artifacts in CI",
    "PW-STABILITY-001": (f) => `Add cleanup hooks to ${fileCount(f)} test file${fileCount(f) > 1 ? "s" : ""}`,
    "PW-STABILITY-002": (f) => `Organize ${fileCount(f)} test file${fileCount(f) > 1 ? "s" : ""} with describe blocks`,
    "PW-STABILITY-003": (f) => `Move page-based setup out of beforeAll in ${fileCount(f)} file${fileCount(f) > 1 ? "s" : ""}`,
    "CI-002": () => "Configure Playwright HTML report publishing in CI",
    "CI-005": () => "Add dependency caching to CI",
    "CI-006": () => "Standardize WORKERS env across all CI pipelines",
    "CI-007": (f) => `Implement test sharding for faster CI (${f.evidence[0]?.snippet?.match(/\\d+/)?.[0] || "many"} test files)`,
    "CI-009": () => "Publish test-results artifacts to debug retry failures",
    "ARCH-001": () => "Create BasePage class for consistent POM patterns",
    "ARCH-003": (f) => `Extract shared code from ${fileCount(f)} test file${fileCount(f) > 1 ? "s" : ""} to utility modules`,
    "ARCH-004": (f) => `Add proper TypeScript typing to ${fileCount(f)} fixture file${fileCount(f) > 1 ? "s" : ""}`,
    "ARCH-005": () => "Move hardcoded credentials to environment variables",
  };

  for (const f of sorted) {
    if (actions.length >= 5) break;
    const generator = actionMap[f.finding_id];
    const label = generator ? generator(f) : f.recommendation?.split(".")[0] ?? f.title;
    // Deduplicate
    if (!actions.some((a) => a.label === label)) {
      actions.push({ label, severity: f.severity, findingId: f.finding_id });
    }
  }

  return actions;
}

/* ── Effort Estimation & Remediation Time ── */
interface EffortItem { finding: string; effort: string; impact: string }
interface TimeEstimate {
  toGoodGrade: { minHours: number; maxHours: number };
  toAllResolved: { minHours: number; maxHours: number };
  highPriorityCount: number;
  totalIssueCount: number;
}

function categorizeFindings(findings: Finding[]): { quickWins: EffortItem[]; largerEfforts: EffortItem[] } {
  const quickWins: EffortItem[] = [];
  const largerEfforts: EffortItem[] = [];

  for (const f of findings) {
    const fc = new Set(f.evidence.map(e => e.file)).size;
    const occ = f.evidence_count;

    switch (f.finding_id) {
      case "PW-FLAKE-002":
      case "CY-FLAKE-003":
        if (occ <= 5) quickWins.push({ finding: `Fix ${occ} force-click${occ > 1 ? "s" : ""}`, effort: "~30 min", impact: "Reduces hidden UI issues" });
        else largerEfforts.push({ finding: `Fix ${occ} force-clicks across ${fc} files`, effort: "2–4 hours", impact: "Reduces hidden UI issues" });
        break;
      case "PW-LOC-001":
        if (fc <= 2) quickWins.push({ finding: `Refactor ${occ} XPath selectors in ${fc} file${fc > 1 ? "s" : ""}`, effort: "1–2 hours", impact: "More maintainable locators" });
        else largerEfforts.push({ finding: `Refactor ${occ} XPath selectors across ${fc} files`, effort: "4–8 hours", impact: "More maintainable locators" });
        break;
      case "PW-FLAKE-001":
        if (occ <= 5) quickWins.push({ finding: `Remove ${occ} hard wait${occ > 1 ? "s" : ""}`, effort: "1–2 hours", impact: "Faster, more stable tests" });
        else largerEfforts.push({ finding: `Remove ${occ} hard waits across ${fc} files`, effort: "4–8 hours", impact: "Faster, more stable tests" });
        break;
      case "PW-STABILITY-001":
        largerEfforts.push({ finding: `Add cleanup hooks to ${fc} test file${fc > 1 ? "s" : ""}`, effort: "2–4 hours", impact: "Better test isolation" });
        break;
      case "PW-STABILITY-003":
        largerEfforts.push({ finding: `Move page-based setup out of beforeAll in ${fc} file${fc > 1 ? "s" : ""}`, effort: "2–6 hours", impact: "Prevents shared state + flaky cascades" });
        break;
      case "CI-006":
        quickWins.push({ finding: "Standardize WORKERS env across pipelines", effort: "30 min", impact: "Consistent CI behavior" });
        break;
      case "CI-007":
        largerEfforts.push({ finding: "Implement test sharding in CI", effort: "2–4 hours", impact: "50–75% faster CI" });
        break;
      case "CI-005":
        quickWins.push({ finding: "Add dependency caching to CI", effort: "30 min", impact: "Faster CI install phase" });
        break;
      case "PW-INSIGHT-002":
        quickWins.push({ finding: "Reduce test timeout configuration", effort: "15 min", impact: "Faster failure feedback" });
        break;
      case "ARCH-001":
        largerEfforts.push({ finding: `Create BasePage pattern for ${fc} POM${fc > 1 ? "s" : ""}`, effort: "2–4 hours", impact: "Consistent POM patterns" });
        break;
      case "ARCH-002":
        if (occ <= 3) quickWins.push({ finding: `Encapsulate locators in ${fc} POM${fc > 1 ? "s" : ""}`, effort: "1–2 hours", impact: "Better encapsulation" });
        else largerEfforts.push({ finding: `Encapsulate locators in ${fc} POMs`, effort: "4–8 hours", impact: "Better encapsulation" });
        break;
      case "ARCH-003":
        largerEfforts.push({ finding: `Decouple ${fc} test file${fc > 1 ? "s" : ""} from test imports`, effort: "2–4 hours", impact: "Better test isolation" });
        break;
      case "ARCH-004":
        if (fc <= 2) quickWins.push({ finding: `Add fixture typing to ${fc} file${fc > 1 ? "s" : ""}`, effort: "1 hour", impact: "Type safety in tests" });
        else largerEfforts.push({ finding: `Add fixture typing to ${fc} files`, effort: "2–4 hours", impact: "Type safety in tests" });
        break;
      case "ARCH-005":
        quickWins.push({ finding: "Move credentials to env variables", effort: "30 min", impact: "Security + env flexibility" });
        break;
      case "ARCH-005a":
        if (occ <= 10) quickWins.push({ finding: `Replace ${occ} hardcoded email${occ > 1 ? "s" : ""} with faker/factory`, effort: "1 hour", impact: "Fewer test conflicts" });
        else largerEfforts.push({ finding: `Replace ${occ} hardcoded emails with data factory`, effort: "2–4 hours", impact: "Fewer test conflicts" });
        break;
      case "ARCH-006":
        largerEfforts.push({ finding: "Implement API mocking patterns", effort: "4–8 hours", impact: "Faster, isolated tests" });
        break;
      case "ARCH-007":
        largerEfforts.push({ finding: `Create custom error types for ${fc} POM${fc > 1 ? "s" : ""}`, effort: "2–4 hours", impact: "Better error handling" });
        break;
      case "DEP-001":
        if (occ <= 3) quickWins.push({ finding: `Update ${occ} outdated package${occ > 1 ? "s" : ""}`, effort: "1–2 hours", impact: "Stay current, reduce flakiness" });
        else largerEfforts.push({ finding: `Update ${occ} outdated packages`, effort: "2–4 hours", impact: "Stay current, reduce flakiness" });
        break;
      case "DEP-002":
        largerEfforts.push({ finding: `Replace ${occ} deprecated npm package${occ > 1 ? "s" : ""}`, effort: "1–4 hours", impact: "Avoid unmaintained/vulnerable deps" });
        break;
    }
  }
  return { quickWins: quickWins.slice(0, 4), largerEfforts: largerEfforts.slice(0, 4) };
}

const EFFORT_ESTIMATES: Record<string, { min: number; max: number }> = {
  "PW-FLAKE-001": { min: 1, max: 4 }, "PW-FLAKE-002": { min: 0.5, max: 2 },
  "CY-FLAKE-003": { min: 0.5, max: 2 }, "PW-LOC-001": { min: 1, max: 4 },
  "PW-STABILITY-001": { min: 2, max: 4 }, "PW-STABILITY-001a": { min: 0.5, max: 1 },
  "PW-STABILITY-003": { min: 2, max: 6 }, "CI-005": { min: 0.5, max: 1 },
  "CI-006": { min: 0.5, max: 1 }, "CI-007": { min: 2, max: 4 },
  "PW-INSIGHT-001": { min: 2, max: 6 }, "PW-INSIGHT-002": { min: 0.25, max: 0.5 },
  "PW-INSIGHT-003": { min: 4, max: 8 }, "ARCH-001": { min: 2, max: 4 },
  "ARCH-002": { min: 1, max: 4 }, "ARCH-003": { min: 2, max: 4 },
  "ARCH-004": { min: 1, max: 2 }, "ARCH-005": { min: 0.5, max: 1 },
  "ARCH-005a": { min: 1, max: 3 }, "ARCH-006": { min: 4, max: 8 },
  "ARCH-007": { min: 2, max: 4 }, "ARCH-008": { min: 1, max: 3 },
  "ARCH-009": { min: 0.5, max: 2 }, "PW-FLAKE-003": { min: 0.5, max: 1 },
  "PW-FLAKE-004": { min: 1, max: 3 }, "PW-STABILITY-004": { min: 2, max: 6 },
  "PW-LOC-002": { min: 1, max: 3 }, "PW-LOC-003": { min: 0.5, max: 2 },
  "PW-PERF-003": { min: 1, max: 3 }, "CI-011": { min: 0.25, max: 0.5 },
  "CI-012": { min: 0.25, max: 0.5 }, "CI-013": { min: 0.25, max: 0.5 },
  "CI-014": { min: 0.25, max: 0.5 }, "DEP-001": { min: 1, max: 4 },
  "DEP-002": { min: 1, max: 4 },
};

function calculateRemediationTime(findings: Finding[]): TimeEstimate {
  let toGoodMin = 0, toGoodMax = 0, toAllMin = 0, toAllMax = 0;
  const high = findings.filter(f => f.severity === "high");

  for (const f of high) {
    const est = EFFORT_ESTIMATES[f.finding_id] ?? { min: 1, max: 3 };
    const fc = new Set(f.evidence.map(e => e.file)).size;
    const scale = Math.min(Math.max(1, fc / 3), 3);
    toGoodMin += est.min * scale; toGoodMax += est.max * scale;
  }
  for (const f of findings) {
    const est = EFFORT_ESTIMATES[f.finding_id] ?? { min: 1, max: 3 };
    const fc = new Set(f.evidence.map(e => e.file)).size;
    const scale = Math.min(Math.max(1, fc / 3), 3);
    toAllMin += est.min * scale; toAllMax += est.max * scale;
  }
  return {
    toGoodGrade: { minHours: Math.round(toGoodMin), maxHours: Math.round(toGoodMax) },
    toAllResolved: { minHours: Math.round(toAllMin), maxHours: Math.round(toAllMax) },
    highPriorityCount: high.length,
    totalIssueCount: findings.length,
  };
}

function formatTimeRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "No remediation needed";
  if (max <= 4) return `${min}–${max} hours`;
  if (max <= 16) return `${Math.round(min / 4)}–${Math.round(max / 4)} half-days`;
  return `${Math.round(min / 8)}–${Math.round(max / 8)} days`;
}

function topEvidenceFile(f: Finding): { name: string; count: number } | null {
  if (!f.evidence.length) return null;
  const counts = new Map<string, number>();
  for (const e of f.evidence) {
    const file = e.file.replace(/\\/g, "/");
    counts.set(file, (counts.get(file) || 0) + 1);
  }
  let best: [string, number] = ["", 0];
  for (const [file, count] of counts) {
    if (count > best[1]) best = [file, count];
  }
  return { name: best[0].split("/").pop() || best[0], count: best[1] };
}

function fileCount(f: Finding): number {
  return new Set(f.evidence.map((e) => e.file)).size;
}

/* ── Configuration Overview ── */
function ConfigOverview({ inventory }: { inventory: any }) {
  const pw = inventory.playwrightConfigSummary;
  const ci = inventory.ciSummary;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Playwright Configuration */}
      {pw && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-4">
            <Settings className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Playwright Configuration</CardTitle>
              <CardDescription>Detected settings from primary config</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Core settings */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {pw.configPath && (
                <ConfigRow label="Config File" value={pw.configPath.split(/[/\\]/).pop()} />
              )}
              {pw.testDir && <ConfigRow label="Test Directory" value={pw.testDir} />}
              {pw.timeoutMs && <ConfigRow label="Test Timeout" value={formatMs(pw.timeoutMs)} />}
              {pw.expectTimeoutMs && <ConfigRow label="Expect Timeout" value={formatMs(pw.expectTimeoutMs)} />}
              {pw.workers && <ConfigRow label="Workers" value={String(pw.workers)} />}
              {pw.retries && <ConfigRow label="Retries" value={String(pw.retries)} />}
              {pw.globalSetup && <ConfigRow label="Global Setup" value={pw.globalSetup.split(/[/\\]/).pop()!} />}
            </div>

            {/* Use options */}
            {pw.use && (
              <>
                <div className="border-t border-border/40 pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Runtime Options</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {pw.use.headless !== undefined && <ConfigRow label="Headless" value={String(pw.use.headless)} />}
                    {pw.use.actionTimeoutMs && <ConfigRow label="Action Timeout" value={formatMs(pw.use.actionTimeoutMs)} />}
                    {pw.use.trace && <ConfigRow label="Trace" value={pw.use.trace} />}
                    {pw.use.video && <ConfigRow label="Video" value={pw.use.video} />}
                    {pw.use.screenshot && <ConfigRow label="Screenshot" value={pw.use.screenshot} />}
                    {pw.use.baseURL && <ConfigRow label="Base URL" value={pw.use.baseURL} />}
                  </div>
                </div>
              </>
            )}

            {/* Reporters */}
            {pw.reporters?.length > 0 && (
              <div className="border-t border-border/40 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reporters</h4>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(pw.reporters.map((r: any) => r.name))] .map((name) => (
                    <Badge key={String(name)} variant="secondary" className="text-xs">{String(name)}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Projects */}
            {pw.projects?.length > 0 && (
              <div className="border-t border-border/40 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Projects</h4>
                <div className="flex flex-wrap gap-2">
                  {pw.projects.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs">
                      {p.isMobile ? (
                        <Smartphone className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <Monitor className="h-3.5 w-3.5 text-blue-400" />
                      )}
                      <span className="font-medium">{p.name}</span>
                      {p.browserName && <span className="text-muted-foreground">({p.browserName})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CI/CD Configuration */}
      {ci && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-4">
            <Workflow className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">CI/CD Configuration</CardTitle>
              <CardDescription>Pipeline and automation details</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Platform */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <ConfigRow
                label="Platform"
                value={
                  ci.detectedAzurePipelines ? "Azure Pipelines"
                  : ci.detectedGitHubActions ? "GitHub Actions"
                  : "Not detected"
                }
              />
              <ConfigRow label="Pipeline Files" value={String(ci.files?.length ?? 0)} />
            </div>

            {/* Feature matrix */}
            <div className="border-t border-border/40 pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Features</h4>
              <div className="grid grid-cols-2 gap-2">
                <CiFeature label="HTML Report" enabled={ci.publishesPlaywrightReport} />
                <CiFeature label="JUnit Publishing" enabled={ci.publishesJUnit} />
                <CiFeature label="Trace/Artifacts" enabled={ci.publishesTracesOrTestResultsDir} />
                <CiFeature label="Artifacts on Failure" enabled={ci.publishesArtifactsOnFailure} />
                <CiFeature label="Dependency Caching" enabled={ci.usesCache} />
                <CiFeature label="Test Sharding" enabled={ci.usesSharding} />
                <CiFeature label="WORKERS Env Var" enabled={ci.setsWorkersEnv} />
                <CiFeature label="Failure Handling" enabled={ci.hasFailureHandling} />
              </div>
            </div>

            {/* Pipeline files */}
            {ci.files?.length > 0 && (
              <div className="border-t border-border/40 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pipeline Files</h4>
                <div className="space-y-1">
                  {ci.files.map((f: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono truncate">{f.file?.split(/[/\\]/).pop()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pool / hosting */}
            {(ci.usesSelfHostedPool !== undefined || ci.hasPipelineTimeout) && (
              <div className="border-t border-border/40 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Infrastructure</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {ci.usesSelfHostedPool && <ConfigRow label="Agent Pool" value="Self-hosted" />}
                  {ci.usesMicrosoftHostedPool && <ConfigRow label="Agent Pool" value="Microsoft-hosted" />}
                  {ci.hasPipelineTimeout && ci.pipelineTimeoutMinutes && (
                    <ConfigRow label="Pipeline Timeout" value={`${ci.pipelineTimeoutMinutes} min`} />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Small helper subcomponents ── */
function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium font-mono text-xs truncate" title={value}>{value}</span>
    </>
  );
}

function CiFeature({ label, enabled }: { label: string; enabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={enabled ? "text-emerald-400" : "text-muted-foreground/50"}>
        {enabled ? "✓" : "✗"}
      </span>
      <span className={enabled ? "text-foreground/80" : "text-muted-foreground/60"}>{label}</span>
    </div>
  );
}

/* ── Collapsible Finding Row ── */
function FindingRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <TableCell className="w-8">
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {severityIcon[f.severity]}
            <Badge variant={f.severity as any}>{f.severity}</Badge>
          </div>
        </TableCell>
        <TableCell>
          <code className="text-xs font-mono text-muted-foreground">{f.finding_id}</code>
        </TableCell>
        <TableCell className="font-medium">{f.title}</TableCell>
        <TableCell className="text-right text-muted-foreground">{f.evidence_count}</TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={5} className="py-4 px-8">
            <div className="space-y-4">
              {f.description && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</h4>
                  <p className="text-sm text-foreground/80">{linkifyText(f.description)}</p>
                </div>
              )}
              {f.recommendation && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recommendation</h4>
                  <p className="text-sm text-foreground/80 whitespace-pre-line">{linkifyText(f.recommendation)}</p>
                </div>
              )}
              {f.evidence.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Evidence ({f.evidence.length})
                  </h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {f.evidence.map((e, i) => (
                      <div key={i} className="rounded-lg border border-border/50 bg-background/50 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span className="font-mono">{e.file}</span>
                          {e.line > 0 && <span className="text-primary/70">L{e.line}</span>}
                        </div>
                        {e.snippet && (
                          <pre className="text-xs font-mono text-foreground/70 overflow-x-auto whitespace-pre-wrap">
                            {e.snippet}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ── Main Page ── */
export default function RepoDetailPage() {
  const params = useParams<{ name: string }>();
  const searchParams = useSearchParams();
  const repoName = decodeURIComponent(params.name);
  const scanIdParam = searchParams.get("scan");

  const [data, setData] = useState<RepoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { stopLoading } = useNavigationLoading();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = scanIdParam
      ? `/api/repos/${encodeURIComponent(repoName)}?scan=${encodeURIComponent(scanIdParam)}`
      : `/api/repos/${encodeURIComponent(repoName)}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Repository not found" : "Failed to load");
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); stopLoading(); })
      .catch((e) => { setError(e.message); setLoading(false); stopLoading(); });
  }, [repoName, scanIdParam, stopLoading]);

  if (loading) {
    return (
      <div className="animate-fade-in">
        <Spinner size={80} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 animate-fade-in">
        <AlertTriangle className="h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-muted-foreground">{error ?? "Repository not found"}</h2>
        <NavLink href="/repos" className="text-sm text-primary hover:underline">
          &larr; Back to Repositories
        </NavLink>
      </div>
    );
  }

  const { repo, latestScan, findings, inventory, scanHistory } = data;
  const isHistorical = data.isHistorical ?? false;
  const grade = latestScan?.risk_grade ?? "—";
  const score = latestScan?.risk_score ?? 0;

  // Group findings by severity
  const highFindings   = findings.filter((f) => f.severity === "high");
  const mediumFindings = findings.filter((f) => f.severity === "medium");
  const lowFindings    = findings.filter((f) => f.severity === "low");

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Breadcrumb & Header ── */}
      <div>
        <NavLink
          href="/repos"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Repositories
        </NavLink>
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{repo.name}</h1>
          {grade !== "—" && (
            <span className={`text-4xl font-black ${gradeColor[grade] ?? ""}`}>
              {grade}
            </span>
          )}
        </div>
        {latestScan && (
          <div className="mt-4 flex flex-wrap items-center rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            <Clock className="h-4.5 w-4.5 text-blue-400"/>
            <code className="rounded bg-primary/0 px-2 py-0.5 text-xs font-mono font-small text-primary"></code>            
            {isHistorical ? "Scan from" : "Scan date:"} {formatDate(latestScan.scanned_at)}
          </div>
        )}
        {isHistorical && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            You are viewing a historical scan report.
            <NavLink
              href={`/repos/${encodeURIComponent(repo.name)}`}
              className="ml-auto text-xs text-blue-400 hover:underline whitespace-nowrap"
            >
              View latest &rarr;
            </NavLink>
          </div>
        )}
      </div>

      {/* ── Overview Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Risk Grade */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Health Grade</CardTitle>
            <ShieldCheck className={`h-[30px] w-[30px] ${gradeColor[grade] ?? "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${gradeColor[grade] ?? ""}`}>{grade}</span>
              <span className="text-sm text-muted-foreground">/ {Math.round(score)}/100</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-blue-500" : score >= 30 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${Math.min(100, score)}%` }}
              />
            </div>
          </CardContent>
          <div
            className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${
              grade === "A" ? "from-emerald-500/80 via-emerald-500/40 to-transparent"
              : grade === "B" ? "from-blue-500/80 via-blue-500/40 to-transparent"
              : grade === "C" ? "from-amber-500/80 via-amber-500/40 to-transparent"
              : grade === "D" ? "from-orange-500/80 via-orange-500/40 to-transparent"
              : grade === "F" ? "from-red-500/80 via-red-500/40 to-transparent"
              : "from-muted-foreground/40 via-muted-foreground/20 to-transparent"
            }`}
          />
        </Card>

        {/* Total Findings */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Findings</CardTitle>
            <SearchCode className="h-[30px] w-[30px] text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-400">{latestScan?.findings_count ?? 0}</div>
          </CardContent>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
        </Card>

        {/* High Severity */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">High Severity</CardTitle>
            <AlertTriangle className="h-[30px] w-[30px] text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{latestScan?.high_count ?? 0}</div>
          </CardContent>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
        </Card>

        {/* Scans */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Scans</CardTitle>
            <Scan className="h-[30px] w-[30px] text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{scanHistory.length}</div>
          </CardContent>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />
        </Card>
      </div>

      {/* ── Repository Statistics ── */}
      {inventory && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-4">
            <BarChart3 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Repository Statistics</CardTitle>
              <CardDescription>Codebase overview from the latest scan</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {/* Total Files */}
              {inventory.totalFiles != null && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <FolderOpen className="h-5 w-5 text-blue-400 shrink-0" />
                  <div>
                    <div className="text-lg font-bold">{inventory.totalFiles.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Total Files</div>
                  </div>
                </div>
              )}
              {/* Test Files */}
              {inventory.testFiles != null && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <FileCode className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-lg font-bold">{inventory.testFiles.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Test Files</div>
                  </div>
                </div>
              )}
              {/* Test Cases */}
              {inventory.testCases != null && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <FlaskConical className="h-5 w-5 text-teal-400 shrink-0" />
                  <div>
                    <div className="text-lg font-bold">{inventory.testCases.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Test Cases</div>
                  </div>
                </div>
              )}
              {/* Playwright Version */}
              {inventory.playwrightVersion && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <Package className="h-5 w-5 text-purple-400 shrink-0" />
                  <div>
                    <div className="text-lg font-bold font-mono">{inventory.playwrightVersion}</div>
                    <div className="text-xs text-muted-foreground">Playwright</div>
                  </div>
                </div>
              )}
              {/* Config Files */}
              {inventory.playwrightConfigPaths?.length > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <Settings className="h-5 w-5 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-lg font-bold">{inventory.playwrightConfigPaths.length}</div>
                    <div className="text-xs text-muted-foreground">Config File{inventory.playwrightConfigPaths.length > 1 ? "s" : ""}</div>
                  </div>
                </div>
              )}
              {/* Frameworks */}
              {inventory.detectedFrameworks?.length > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <Layers className="h-5 w-5 text-cyan-400 shrink-0" />
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {inventory.detectedFrameworks.map((fw: string) => (
                        <Badge key={fw} variant="secondary" className="text-xs capitalize">{fw}</Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">Framework{inventory.detectedFrameworks.length > 1 ? "s" : ""}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Git info */}
            {(inventory.gitBranch || inventory.gitCommit) && (
              <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                {inventory.gitBranch && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs text-muted-foreground">Branch</span>
                    <code className="rounded bg-primary/10 px-2 py-0.5 text-xs font-mono font-medium text-primary">
                      {inventory.gitBranch}
                    </code>
                  </div>
                )}
                {inventory.gitCommit && (
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">Commit</span>
                    <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-foreground/70">
                      {inventory.gitCommit.length > 8 ? inventory.gitCommit.slice(0, 8) : inventory.gitCommit}
                    </code>
                  </div>
                )}
              </div>
            )}

            {/* Test-to-total ratio bar */}
            {inventory.totalFiles > 0 && inventory.testFiles != null && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Test file ratio</span>
                  <span>{((inventory.testFiles / inventory.totalFiles) * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, (inventory.testFiles / inventory.totalFiles) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Severity Breakdown ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Severity Breakdown</CardTitle>
          <CardDescription>Distribution of findings by severity level</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 flex-wrap">
            {[
              { label: "High",   count: latestScan?.high_count ?? 0,   color: "bg-red-500",   textColor: "text-red-400" },
              { label: "Medium", count: latestScan?.medium_count ?? 0, color: "bg-amber-500",  textColor: "text-amber-400" },
              { label: "Low",    count: latestScan?.low_count ?? 0,    color: "bg-blue-500",   textColor: "text-blue-400" },
            ].map((s) => {
              const total = latestScan?.findings_count || 1;
              const pct = ((s.count / total) * 100).toFixed(0);
              return (
                <div key={s.label} className="flex-1 min-w-[140px]">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-medium ${s.textColor}`}>{s.label}</span>
                    <span className="text-sm text-muted-foreground">{s.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${s.color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Risk Assessment: Priority Files ── */}
      {(() => {
        const hotspots = computeHotspots(findings);
        const actions = computeActions(findings);

        return hotspots.length > 0 || actions.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Priority Files */}
            {hotspots.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center gap-3 pb-4">
                  <Flame className="h-5 w-5 text-orange-400" />
                  <div>
                    <CardTitle className="text-lg">Priority Files</CardTitle>
                    <CardDescription>Highest concentration of issues — address first</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead className="text-right w-20">Score</TableHead>
                        <TableHead>Issues</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hotspots.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {i < 3 && <Target className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                              <span className="font-mono text-xs truncate max-w-[200px]" title={h.file}>
                                {h.fileName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-sm font-medium">{h.issueCount}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {h.findingTypes.map((id) => (
                                <Badge key={id} variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {id}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Recommended Actions */}
            {actions.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center gap-3 pb-4">
                  <ListChecks className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-lg">Recommended Actions</CardTitle>
                    <CardDescription>Top priority items to improve your score</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          i === 0 ? "bg-red-500/20 text-red-400"
                          : i === 1 ? "bg-orange-500/20 text-orange-400"
                          : "bg-blue-500/20 text-blue-400"
                        }`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">{a.label}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={a.severity as any} className="text-[10px]">{a.severity}</Badge>
                            <span className="text-[11px] text-muted-foreground font-mono">{a.findingId}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null;
      })()}

      {/* ── Effort Estimation & Remediation Time ── */}
      {(() => {
        const { quickWins, largerEfforts } = categorizeFindings(findings);
        const timeEst = calculateRemediationTime(findings);
        const hasEffortData = quickWins.length > 0 || largerEfforts.length > 0;

        if (!hasEffortData && timeEst.totalIssueCount === 0) return null;

        return (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Effort Estimation */}
            {hasEffortData && (
              <Card>
                <CardHeader className="flex flex-row items-center gap-3 pb-4">
                  <Wrench className="h-5 w-5 text-amber-400" />
                  <div>
                    <CardTitle className="text-lg">Effort Estimation</CardTitle>
                    <CardDescription>Quick wins vs strategic improvements</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {quickWins.length > 0 && (
                    <div>
                      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-3">
                        <Zap className="h-3.5 w-3.5" />
                        Quick Wins <span className="text-muted-foreground font-normal normal-case">(&#60; 2 hours each)</span>
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/40">
                              <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground">Action Item</th>
                              <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground w-28">Time Est.</th>
                              <th className="text-left py-1.5 text-xs font-medium text-muted-foreground w-40">Impact</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quickWins.map((qw, i) => (
                              <tr key={i} className="border-b border-border/20 last:border-0">
                                <td className="py-2 pr-3 text-foreground/80">{qw.finding}</td>
                                <td className="py-2 pr-3 font-mono text-xs text-emerald-400">{qw.effort}</td>
                                <td className="py-2 text-xs text-muted-foreground">{qw.impact}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {largerEfforts.length > 0 && (
                    <div>
                      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400 mb-3">
                        <TrendingDown className="h-3.5 w-3.5" />
                        Strategic Improvements <span className="text-muted-foreground font-normal normal-case">(half-day to multi-day)</span>
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/40">
                              <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground">Action Item</th>
                              <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground w-28">Time Est.</th>
                              <th className="text-left py-1.5 text-xs font-medium text-muted-foreground w-40">Impact</th>
                            </tr>
                          </thead>
                          <tbody>
                            {largerEfforts.map((le, i) => (
                              <tr key={i} className="border-b border-border/20 last:border-0">
                                <td className="py-2 pr-3 text-foreground/80">{le.finding}</td>
                                <td className="py-2 pr-3 font-mono text-xs text-blue-400">{le.effort}</td>
                                <td className="py-2 text-xs text-muted-foreground">{le.impact}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Remediation Time Summary */}
            <Card>
              <CardHeader className="flex flex-row items-center gap-3 pb-4">
                <Hourglass className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-lg">Remediation Time Summary</CardTitle>
                  <CardDescription>Estimated engineering effort to improve</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground">Target</th>
                        <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground w-36">Estimated Time</th>
                        <th className="text-left py-1.5 text-xs font-medium text-muted-foreground">Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grade !== "A" && grade !== "B" && timeEst.highPriorityCount > 0 && (
                        <tr className="border-b border-border/20">
                          <td className="py-2.5 pr-3 font-medium text-foreground/90">Reach Grade B (Good)</td>
                          <td className="py-2.5 pr-3">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-mono font-medium text-amber-400">
                              <Clock className="h-3 w-3" />
                              {formatTimeRange(timeEst.toGoodGrade.minHours, timeEst.toGoodGrade.maxHours)}
                            </span>
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            Address {timeEst.highPriorityCount} high-severity finding{timeEst.highPriorityCount !== 1 ? "s" : ""}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-border/20 last:border-0">
                        <td className="py-2.5 pr-3 font-medium text-foreground/90">Address All Issues</td>
                        <td className="py-2.5 pr-3">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-medium text-primary">
                            <Clock className="h-3 w-3" />
                            {formatTimeRange(timeEst.toAllResolved.minHours, timeEst.toAllResolved.maxHours)}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          Resolve all {timeEst.totalIssueCount} finding{timeEst.totalIssueCount !== 1 ? "s" : ""}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-muted-foreground/60 italic leading-relaxed">
                  Time estimates assume a single engineer familiar with the codebase. Actual time may vary based on complexity and team experience.
                </p>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* ── Findings Table ── */}
      {findings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Findings ({findings.length})</CardTitle>
            <CardDescription>Click a row to expand details and evidence</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-28">Severity</TableHead>
                  <TableHead className="w-40">Rule ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right w-24">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((f, i) => (
                  <FindingRow key={`${f.finding_id}-${i}`} f={f} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Configuration Overview ── */}
      {inventory && (inventory.playwrightConfigSummary || inventory.ciSummary) && (
        <ConfigOverview inventory={inventory} />
      )}

      {/* ── Scan History ── */}
      {scanHistory.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scan History</CardTitle>
            <CardDescription>Previous scans for this repository</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">Grade</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Findings</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Medium</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scanHistory.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-muted-foreground text-sm">
                      <NavLink
                        href={`/repos/${encodeURIComponent(repo.name)}?scan=${s.id}`}
                        className="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                      >
                        {formatDate(s.scanned_at)}
                      </NavLink>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-bold ${gradeColor[s.risk_grade ?? ""] ?? ""}`}>
                        {s.risk_grade ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {s.risk_score?.toFixed(1) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{s.findings_count}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="high">{s.high_count}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="medium">{s.medium_count}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="low">{s.low_count}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
