"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, BarChart3,
  ShieldCheck, AlertTriangle, Activity, Target,
  ArrowUpRight, ArrowDownRight,
  SearchCodeIcon,
  Scale3dIcon,
  ScanIcon,
  ScalingIcon,
} from "lucide-react";

/* ─────────────────── Types ─────────────────── */
interface TrendPoint {
  key: string;   // unique x-axis identity (ISO ts or date)
  label: string; // human-readable tick label
  date: string;
  findings_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score: number;
  risk_grade?: string;
  files_affected: number;
  files_fixed: number;
}

interface RepoOption {
  id: number;
  name: string;
}

interface DeltaPoint {
  key: string;
  label: string;
  date: string;
  resolved: number;
  introduced: number;
  resolved_high: number;
  resolved_medium: number;
  resolved_low: number;
  new_high: number;
  new_medium: number;
  new_low: number;
}

/* ─────────────────── Helpers ─────────────────── */
const gradeColor: Record<string, string> = {
  A: "text-emerald-400", B: "text-blue-400", C: "text-amber-400",
  D: "text-orange-400", F: "text-red-400",
};

const gradeBg: Record<string, string> = {
  A: "bg-emerald-400/10", B: "bg-blue-400/10", C: "bg-amber-400/10",
  D: "bg-orange-400/10", F: "bg-red-400/10",
};

function riskGrade(score: number): string {
  if (score <= 20) return "A";
  if (score <= 50) return "B";
  if (score <= 85) return "C";
  if (score <= 120) return "D";
  return "F";
}

function DeltaChip({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" /> 0</span>;
  const positive = invert ? value < 0 : value > 0;
  const color = positive ? "text-emerald-400" : "text-red-400";
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value)}
    </span>
  );
}

/* ─────────────── Custom Tooltip ────────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-xl">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────── Delta Tooltip ─────────────── */
function DeltaTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{d.label}</p>
      <div className="space-y-1.5">
        <div>
          <p className="text-xs font-semibold text-emerald-400">✓ Resolved: {d.resolved}</p>
          {d.resolved > 0 && (
            <p className="ml-3 text-[11px] text-muted-foreground">
              {d.resolved_high} high · {d.resolved_medium} med · {d.resolved_low} low
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-red-400">✗ Introduced: {d.introduced}</p>
          {d.introduced > 0 && (
            <p className="ml-3 text-[11px] text-muted-foreground">
              {d.new_high} high · {d.new_medium} med · {d.new_low} low
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Donut Chart ────────────────── */
const SEVERITY_COLORS = [
  "hsl(0 84% 60%)",   // High — red
  "hsl(45 93% 56%)",  // Medium — amber
  "hsl(224 70% 65%)", // Low — blue
];

function SeverityDonut({ high, medium, low, compact = false }: { high: number; medium: number; low: number; compact?: boolean }) {
  const data = [
    { name: "High", value: high },
    { name: "Medium", value: medium },
    { name: "Low", value: low },
  ].filter((d) => d.value > 0);
  const total = high + medium + low;
  if (total === 0) return <p className="text-sm text-muted-foreground">No findings</p>;

  const h = compact ? 110 : 200;
  const inner = compact ? 32 : 60;
  const outer = compact ? 48 : 85;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={SEVERITY_COLORS[data[i].name === "High" ? 0 : data[i].name === "Medium" ? 1 : 2]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${compact ? "text-base" : "text-2xl"} font-bold`}>{total}</span>
        {!compact && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Findings</span>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════ */
export default function TrendsPage() {
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("__all__");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [deltaData, setDeltaData] = useState<DeltaPoint[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Fetch repos ── */
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        const repoList: RepoOption[] = (data.repos ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
        }));
        setRepos(repoList);
        // Default to "All Repos" aggregate
        setSelectedRepo("__all__");
      })
      .catch(() => setLoading(false));
  }, []);

  /* ── Fetch trend data ── */
  useEffect(() => {
    setLoading(true);
    const url =
      selectedRepo === "__all__"
        ? "/api/trends?limit=30"
        : `/api/trends?repo=${encodeURIComponent(selectedRepo)}&limit=30`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const raw: any[] = data.trends ?? [];
        // Normalise keys (aggregate endpoint uses total_* / avg_*)
        const withFiles: TrendPoint[] = raw.map((r, idx, arr) => {
          const filesAffected = r.files_affected ?? r.total_files_affected ?? 0;
          // files_fixed = how many fewer affected files vs previous scan (min 0)
          const prevFiles = idx > 0 ? (arr[idx - 1].files_affected ?? arr[idx - 1].total_files_affected ?? 0) : filesAffected;
          const filesFixed = Math.max(0, prevFiles - filesAffected);

          // Per-repo rows have scanned_at (unique); aggregate rows only have date
          const ts = r.scanned_at as string | undefined;
          const dateStr = r.date as string;
          const key = ts ?? dateStr; // unique identity
          // Format label: "Feb 14 17:03" for per-repo, "Feb 14" for aggregate
          let label = dateStr;
          try {
            const d = new Date(ts ?? dateStr);
            label = ts
              ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
              : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          } catch { /* keep raw */ }

          return {
            key,
            label,
            date: dateStr,
            findings_count: r.findings_count ?? r.total_findings ?? 0,
            high_count: r.high_count ?? r.total_high ?? 0,
            medium_count: r.medium_count ?? r.total_medium ?? 0,
            low_count: r.low_count ?? r.total_low ?? 0,
            risk_score: Math.round((r.risk_score ?? r.avg_risk_score ?? 0) * 10) / 10,
            risk_grade: r.risk_grade ?? riskGrade(r.risk_score ?? r.avg_risk_score ?? 0),
            files_affected: filesAffected,
            files_fixed: filesFixed,
          };
        });
        setTrendData(withFiles);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedRepo]);

  /* ── Fetch delta (resolved vs introduced) data ── */
  useEffect(() => {
    const url =
      selectedRepo === "__all__"
        ? "/api/trends/deltas?limit=30"
        : `/api/trends/deltas?repo=${encodeURIComponent(selectedRepo)}&limit=30`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const raw: any[] = data.deltas ?? [];
        setDeltaData(
          raw.map((r) => {
            const ts = r.scanned_at as string | undefined;
            const dateStr = r.date as string;
            const key = ts ?? dateStr;
            let label = dateStr;
            try {
              const d = new Date(ts ?? dateStr);
              label = ts
                ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                  " " +
                  d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
                : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            } catch { /* keep raw */ }
            return {
              key,
              label,
              date: dateStr,
              resolved: (r.resolved_high ?? 0) + (r.resolved_medium ?? 0) + (r.resolved_low ?? 0),
              introduced: (r.new_high ?? 0) + (r.new_medium ?? 0) + (r.new_low ?? 0),
              resolved_high: r.resolved_high ?? 0,
              resolved_medium: r.resolved_medium ?? 0,
              resolved_low: r.resolved_low ?? 0,
              new_high: r.new_high ?? 0,
              new_medium: r.new_medium ?? 0,
              new_low: r.new_low ?? 0,
            };
          }),
        );
      })
      .catch(() => {});
  }, [selectedRepo]);

  /* ── Computed KPIs ── */
  const kpis = useMemo(() => {
    if (trendData.length === 0)
      return { scans: 0, grade: "—", score: 0, scoreDelta: 0, highDelta: 0, findingsDelta: 0, velocity: 0 };

    const latest = trendData[trendData.length - 1];
    const prev = trendData.length >= 2 ? trendData[trendData.length - 2] : latest;
    const first = trendData[0];
    const avgFindings =
      Math.round(trendData.reduce((s, t) => s + t.findings_count, 0) / trendData.length * 10) / 10;

    return {
      scans: trendData.length,
      grade: latest.risk_grade ?? riskGrade(latest.risk_score),
      score: latest.risk_score,
      scoreDelta: Math.round((latest.risk_score - prev.risk_score) * 10) / 10,
      highDelta: latest.high_count - prev.high_count,
      findingsDelta: latest.findings_count - first.findings_count,
      velocity: avgFindings,
    };
  }, [trendData]);

  const latestPoint = trendData.length > 0 ? trendData[trendData.length - 1] : null;

  /* ── Reversed data for table (newest first) with deltas ── */
  const tableRows = useMemo(() => {
    const rev = [...trendData].reverse();
    return rev.map((t, i) => {
      const prev = rev[i + 1]; // older scan
      return {
        ...t,
        findingsDelta: prev ? t.findings_count - prev.findings_count : 0,
        scoreDelta: prev ? Math.round((t.risk_score - prev.risk_score) * 10) / 10 : 0,
      };
    });
  }, [trendData]);

  /* ─────────────────── Render ─────────────────── */
  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Header + Repo Selector ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
          <p className="mt-1 text-muted-foreground">
            Analyse risk trajectory, severity breakdown, and scan-over-scan changes
          </p>
        </div>

        <Select value={selectedRepo} onValueChange={setSelectedRepo}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select repository" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Repositories (Aggregate)</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">Loading...</div>
      ) : trendData.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <TrendingUp className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-muted-foreground">No trend data available</h3>
          <p className="mt-1 text-sm text-muted-foreground/70">Run multiple scans over time to see trends.</p>
        </Card>
      ) : (
        <>
          {/* ══════════ KPI Summary Cards ══════════ */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Scans */}
            <Card className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Scans</CardTitle>
                <ScanIcon className="h-[28px] w-[28px] text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">{kpis.scans}</div>
                <p className="mt-1 text-xs text-muted-foreground">data points in range</p>
              </CardContent>
              <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
            </Card>

            {/* Current Grade */}
            <Card className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Current Grade</CardTitle>
                <ShieldCheck className={`h-[28px] w-[28px] ${gradeColor[kpis.grade] ?? "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${gradeColor[kpis.grade] ?? ""}`}>{kpis.grade}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${gradeBg[kpis.grade] ?? ""} ${gradeColor[kpis.grade] ?? ""}`}>
                    {kpis.score}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">latest risk score</p>
              </CardContent>
              <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500/40 via-emerald-500/15 to-transparent" />
            </Card>

            {/* Risk Δ */}
            <Card className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Risk Score Δ</CardTitle>
                {kpis.scoreDelta <= 0
                  ? <TrendingDown className="h-[28px] w-[28px] text-emerald-400" />
                  : <TrendingUp className="h-[28px] w-[28px] text-red-400" />
                }
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${kpis.scoreDelta <= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {kpis.scoreDelta > 0 ? "+" : ""}{kpis.scoreDelta}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">vs. previous scan</p>
              </CardContent>
              <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${kpis.scoreDelta <= 0 ? "from-emerald-500/40 via-emerald-500/15" : "from-red-500/40 via-red-500/15"} to-transparent`} />
            </Card>

            {/* High Severity Δ */}
            <Card className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">High Severity Δ</CardTitle>
                <AlertTriangle className={`h-[28px] w-[28px] ${kpis.highDelta <= 0 ? "text-emerald-400" : "text-red-400"}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${kpis.highDelta <= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {kpis.highDelta > 0 ? "+" : ""}{kpis.highDelta}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">high findings vs. previous</p>
              </CardContent>
              <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${kpis.highDelta <= 0 ? "from-emerald-500/40 via-emerald-500/15" : "from-red-500/40 via-red-500/15"} to-transparent`} />
            </Card>
          </div>

          {/* ══════════ Charts Row: Findings + Severity Donut ══════════ */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Stacked bar chart: findings over time (takes 2 cols) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Findings Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={trendData} barCategoryGap="12%">
                    <defs>
                      <linearGradient id="highGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.6} />
                      </linearGradient>
                      <linearGradient id="medGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(45 93% 56%)" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="hsl(45 93% 56%)" stopOpacity={0.6} />
                      </linearGradient>
                      <linearGradient id="lowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(224 70% 65%)" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="hsl(224 70% 65%)" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="key" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                      tickFormatter={(_, idx) => trendData[idx]?.label ?? ""} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""} />
                    <Legend iconType="circle" iconSize={8} />
                    <Bar dataKey="high_count"   name="High"   stackId="sev" fill="url(#highGrad)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="medium_count" name="Medium" stackId="sev" fill="url(#medGrad)"  radius={[0, 0, 0, 0]} />
                    <Bar dataKey="low_count"    name="Low"    stackId="sev" fill="url(#lowGrad)"  radius={[3, 3, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Right column: Severity donut (compact) + Files chart stacked */}
            <div className="flex flex-col gap-6">
              {/* Severity donut for latest scan — compact */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Latest Severity Mix</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-4 py-2">
                  {latestPoint && (
                    <>
                      <div className="w-28 shrink-0">
                        <SeverityDonut
                          high={latestPoint.high_count}
                          medium={latestPoint.medium_count}
                          low={latestPoint.low_count}
                          compact
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant="high">{latestPoint.high_count}</Badge>
                          <span className="text-muted-foreground">High</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="medium">{latestPoint.medium_count}</Badge>
                          <span className="text-muted-foreground">Medium</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="low">{latestPoint.low_count}</Badge>
                          <span className="text-muted-foreground">Low</span>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Resolved vs Introduced findings per scan */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Resolved vs Introduced</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={deltaData} barCategoryGap="18%">
                      <defs>
                        <linearGradient id="resolvedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0.5} />
                        </linearGradient>
                        <linearGradient id="introducedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="key" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                        tickFormatter={(_, idx) => deltaData[idx]?.label ?? ""} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<DeltaTooltip />} />
                      <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="resolved" name="Resolved" fill="url(#resolvedGrad)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="introduced" name="Introduced" fill="url(#introducedGrad)" radius={[3, 3, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ══════════ Risk Score Area Chart ══════════ */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Risk Score Trajectory</CardTitle>
              {trendData.length >= 2 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Overall:</span>
                  <DeltaChip value={kpis.findingsDelta} invert />
                  <span className="text-xs text-muted-foreground">findings since first scan</span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(224 90% 63%)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(224 90% 63%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="key" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={(_, idx) => trendData[idx]?.label ?? ""} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""} />
                  <Area
                    type="monotone"
                    dataKey="risk_score"
                    name="Risk Score"
                    stroke="hsl(224 90% 63%)"
                    strokeWidth={2.5}
                    fill="url(#riskGrad)"
                    dot={{ r: 4, fill: "hsl(224 90% 63%)", strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "hsl(224 90% 63%)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ══════════ Grade Progression ══════════ */}
          {trendData.some((t) => t.risk_grade) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Grade Progression</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 overflow-x-auto pb-2">
                  {trendData.map((t, i) => {
                    const g = t.risk_grade ?? riskGrade(t.risk_score);
                    return (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold
                            ${gradeBg[g] ?? ""} ${gradeColor[g] ?? "text-muted-foreground"}
                            ring-1 ring-inset ${g === "A" ? "ring-emerald-400/30" : g === "B" ? "ring-blue-400/30" : g === "C" ? "ring-amber-400/30" : g === "D" ? "ring-orange-400/30" : "ring-red-400/30"}`}
                        >
                          {g}
                        </div>
                        <span className="text-[9px] text-muted-foreground whitespace-nowrap">{t.label}</span>
                        {i < trendData.length - 1 && (
                          <div className="absolute" style={{ display: "none" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ══════════ Scan History Table (with deltas) ══════════ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scan History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-right">High</TableHead>
                    <TableHead className="text-right">Medium</TableHead>
                    <TableHead className="text-right">Low</TableHead>
                    <TableHead className="text-right">Risk Score</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-center">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{t.label}</TableCell>
                      <TableCell className="text-right font-medium">{t.findings_count}</TableCell>
                      <TableCell className="text-right"><DeltaChip value={t.findingsDelta} invert /></TableCell>
                      <TableCell className="text-right">
                        <Badge variant="high">{t.high_count}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="medium">{t.medium_count}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="low">{t.low_count}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{t.risk_score}</TableCell>
                      <TableCell className="text-right"><DeltaChip value={t.scoreDelta} invert /></TableCell>
                      <TableCell className="text-center">
                        <span className={`text-sm font-bold ${gradeColor[t.risk_grade ?? ""] ?? ""}`}>
                          {t.risk_grade ?? riskGrade(t.risk_score)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
