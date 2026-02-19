"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart3, AlertTriangle, Activity, ShieldCheck, SearchCode, LineChart, TrendingDown, TrendingUp, Search, Filter
} from "lucide-react";
import {
  Area,
  AreaChart,
  XAxis,
} from "recharts";
import { SafeChart } from "@/components/safe-chart";

interface RepoRow {
  id: number;
  name: string;
  scan_count?: number;
  last_scanned_at?: string;
  findings_count?: number;
  high_count?: number;
  medium_count?: number;
  low_count?: number;
  risk_grade?: string;
  risk_score?: number;
}

interface TrendRow {
  date: string;
  avg_risk_score?: number;
}

const gradeColor: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const healthTier = (grade?: string) => {
  switch (grade) {
    case "A":
      return { label: "Excellent", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
    case "B":
      return { label: "Healthy", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" };
    case "C":
      return { label: "Watch", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
    case "D":
      return { label: "At Risk", className: "border-orange-500/30 bg-orange-500/10 text-orange-400" };
    case "F":
      return { label: "Critical", className: "border-red-500/30 bg-red-500/10 text-red-400" };
    default:
      return { label: "Unknown", className: "border-border/60 bg-muted/30 text-muted-foreground" };
  }
};


export default function DashboardPage() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/trends?limit=24")
      .then((r) => r.json())
      .then((data) => setTrends(data.trends ?? []))
      .catch(() => setTrends([]));
  }, []);

  const totalRepos    = repos.length;
  const totalFindings = repos.reduce((s, r) => s + (r.findings_count ?? 0), 0);
  const totalHigh     = repos.reduce((s, r) => s + (r.high_count ?? 0), 0);
  const totalScans    = repos.reduce((s, r) => s + (r.scan_count ?? 0), 0);
  const avgScore      = totalRepos > 0
    ? repos.reduce((s, r) => s + (r.risk_score ?? 0), 0) / totalRepos
    : 0;
  const avgScoreDisplay = totalRepos > 0 ? avgScore.toFixed(1) : "—";
  const avgGrade = avgScore <= 20 ? "A" : avgScore <= 50 ? "B" : avgScore <= 85 ? "C" : avgScore <= 120 ? "D" : "F";
  const lastScanDate = repos.reduce<string | undefined>((latest, r) => {
    if (!r.last_scanned_at) return latest;
    if (!latest) return r.last_scanned_at;
    return new Date(r.last_scanned_at) > new Date(latest) ? r.last_scanned_at : latest;
  }, undefined);

  const filteredRepos = repos.filter((r) => {
    const matchesQuery = r.name.toLowerCase().includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (tierFilter === "all") return true;
    return healthTier(r.risk_grade).label.toLowerCase() === tierFilter;
  });

  const trendChartData = trends
    .filter((t) => typeof t.avg_risk_score === "number")
    .map((t) => ({ date: t.date, score: t.avg_risk_score as number }))
    .slice(-24);

  const trendScores = trendChartData.map((t) => t.score);

  // --- Per-segment gradient: green for improving segments, red for declining ---
  // Build gradient stops so each segment between consecutive data points gets its
  // own color based on whether risk_score went down (green/improving) or up (red/declining).
  const TREND_GREEN = "hsl(152 76% 45%)";
  const TREND_RED   = "hsl(0 84% 60%)";
  const TREND_BLUE  = "hsl(224 90% 63%)";

  const segmentStops: { offset: string; color: string }[] = [];
  if (trendScores.length > 1) {
    const n = trendScores.length;
    for (let i = 0; i < n - 1; i++) {
      const segColor = trendScores[i + 1] < trendScores[i]
        ? TREND_GREEN                       // score went down → improving
        : trendScores[i + 1] > trendScores[i]
          ? TREND_RED                       // score went up → declining
          : TREND_BLUE;                     // flat
      const startPct = `${((i / (n - 1)) * 100).toFixed(1)}%`;
      const endPct   = `${(((i + 1) / (n - 1)) * 100).toFixed(1)}%`;
      segmentStops.push({ offset: startPct, color: segColor });
      segmentStops.push({ offset: endPct,   color: segColor });
    }
  } else {
    segmentStops.push({ offset: "0%", color: TREND_BLUE });
    segmentStops.push({ offset: "100%", color: TREND_BLUE });
  }

  // Latest-segment direction for the indicator badge
  const latestSegmentDir = trendScores.length > 1
    ? trendScores[trendScores.length - 1] < trendScores[trendScores.length - 2]
      ? "improving"
      : trendScores[trendScores.length - 1] > trendScores[trendScores.length - 2]
        ? "declining"
        : "flat"
    : "flat";

  const statCards = [
    {
      label: "Repositories",
      value: totalRepos,
      icon: BarChart3,
      color: "text-primary",
      hint: "Active repos",
      gradient: "from-primary/80 via-primary/40 to-transparent",
    },
    {
      label: "Total Findings",
      value: totalFindings,
      icon: SearchCode,
      color: "text-blue-400",
      hint: "All open issues",
      gradient: "from-blue-500/80 via-blue-500/40 to-transparent",
    },
    {
      label: "High Severity",
      value: totalHigh,
      icon: AlertTriangle,
      color: "text-red-400",
      hint: "Immediate risk",
      gradient: "from-red-500/80 via-red-500/40 to-transparent",
    },
    {
      label: "Avg Grade",
      value: totalRepos > 0 ? avgGrade : "—",
      icon: ShieldCheck,
      color: gradeColor[avgGrade] ?? "text-muted-foreground",
      hint: "Portfolio grade",
      gradient:
        avgGrade === "A" ? "from-emerald-500/80 via-emerald-500/40 to-transparent"
        : avgGrade === "B" ? "from-blue-500/80 via-blue-500/40 to-transparent"
        : avgGrade === "C" ? "from-amber-500/80 via-amber-500/40 to-transparent"
        : avgGrade === "D" ? "from-orange-500/80 via-orange-500/40 to-transparent"
        : avgGrade === "F" ? "from-red-500/80 via-red-500/40 to-transparent"
        : "from-muted-foreground/40 via-muted-foreground/20 to-transparent",
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" />
            Portfolio intelligence
          </div>
          <h1 className="title-font text-4xl font-semibold tracking-tight">Dashboard</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Frameworks health snapshot.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground">
            <ShieldCheck className={`h-3.5 w-3.5 ${gradeColor[avgGrade] ?? "text-muted-foreground"}`} />
            Avg score {avgScoreDisplay}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            {totalScans} Total scans
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Last scan {lastScanDate ? new Date(lastScanDate).toLocaleDateString() : "—"}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="group relative overflow-hidden border border-border/50 bg-gradient-to-br from-card/90 via-card/70 to-background/30 shadow-[0_25px_60px_-45px_rgba(10,20,40,0.8)]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className={`h-[30px] w-[30px] ${s.color}`} />
            </CardHeader>
            <CardContent className="space-y-1">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground/70">{s.hint}</div>
            </CardContent>
            <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
              <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
            </div>
            <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${s.gradient}`} />
          </Card>
        ))}
      </div>

      {/* Risk trend */}
      <Card className="overflow-hidden border border-border/60">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <LineChart className="relative -top-0.5 h-[30px] w-[30px] text-primary" />
            <div>
              <CardTitle className="text-lg title-font">Risk Trend</CardTitle>
              <p className="text-xs text-muted-foreground">Average risk score by scan date</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3.5 py-1.5 text-sm text-muted-foreground">
            {latestSegmentDir === "improving" ? (
              <TrendingDown className="h-[30px] w-[30px] text-emerald-400" />
            ) : latestSegmentDir === "declining" ? (
              <TrendingUp className="h-[30px] w-[30px] text-red-400" />
            ) : (
              <Activity className="h-[30px] w-[30px] text-blue-400" />
            )}
            <span className="font-medium">
              {latestSegmentDir === "improving" && "Improving"}
              {latestSegmentDir === "declining" && "Declining"}
              {latestSegmentDir === "flat" && "Stable"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
            {trendChartData.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No trend data available yet
              </div>
            ) : (
              <SafeChart height={160}>
                <AreaChart data={trendChartData} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    {/* Horizontal stroke gradient: per-segment direction coloring */}
                    <linearGradient id="riskStrokeGrad" x1="0" y1="0" x2="1" y2="0">
                      {segmentStops.map((s, i) => (
                        <stop key={`s${i}`} offset={s.offset} stopColor={s.color} />
                      ))}
                    </linearGradient>
                    {/* Vertical fill gradient: per-segment color fading to transparent */}
                    <linearGradient id="riskFillGrad" x1="0" y1="0" x2="1" y2="0">
                      {segmentStops.map((s, i) => (
                        <stop key={`f${i}`} offset={s.offset} stopColor={s.color} stopOpacity={0.30} />
                      ))}
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="url(#riskStrokeGrad)"
                    strokeWidth={2}
                    fill="url(#riskFillGrad)"
                  />
                </AreaChart>
              </SafeChart>
            )}
        </CardContent>
      </Card>

      {/* Repo table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      ) : repos.length === 0 ? (
        <Card className="relative overflow-hidden flex flex-col items-center justify-center py-16">
          <div className="absolute -right-20 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
          <BarChart3 className="mb-4 h-6 w-6 text-muted-foreground/40" />
          <h3 className="title-font text-lg font-semibold text-muted-foreground">No repositories tracked yet</h3>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Push your first scan with: <code className="rounded bg-muted px-2 py-0.5 text-xs">qaverity push findings.json --key YOUR_API_KEY</code>
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden border border-border/60">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-lg title-font">Repositories</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search repos"
                  className="bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/60"
                />
              </div>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-muted-foreground/10">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  className="appearance-none bg-transparent text-xs text-muted-foreground outline-none cursor-pointer pr-4"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
                >
                  <option value="all" className="bg-[hsl(var(--card))] text-muted-foreground px-2">All Health</option>
                  <option value="excellent" className="bg-[hsl(var(--card))] text-muted-foreground px-2">Excellent</option>
                  <option value="healthy" className="bg-[hsl(var(--card))] text-muted-foreground px-2">Healthy</option>
                  <option value="watch" className="bg-[hsl(var(--card))] text-muted-foreground px-2">Watch</option>
                  <option value="at risk" className="bg-[hsl(var(--card))] text-muted-foreground px-2">At Risk</option>
                  <option value="critical" className="bg-[hsl(var(--card))] text-muted-foreground px-2">Critical</option>
                  <option value="unknown" className="bg-[hsl(var(--card))] text-muted-foreground px-2">Unknown</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead className="text-center">Grade</TableHead>
                  <TableHead className="text-center">Health</TableHead>
                  <TableHead className="text-right">Findings</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Medium</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">Last Scan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRepos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      No repositories match the current search or filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRepos.map((r) => (
                    <TableRow key={r.id} className="transition-colors hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <Link href={`/repos/${encodeURIComponent(r.name)}`} className="text-primary hover:underline">
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xl font-bold ${gradeColor[r.risk_grade ?? ""] ?? ""}`}>
                          {r.risk_grade ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const tier = healthTier(r.risk_grade);
                          return (
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tier.className}`}>
                              {tier.label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">{r.findings_count ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="high">{r.high_count ?? 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="medium">{r.medium_count ?? 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="low">{r.low_count ?? 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        {r.last_scanned_at
                          ? new Date(r.last_scanned_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
