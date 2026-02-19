"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { SafeChart } from "@/components/safe-chart";
import {
  ArrowDown, ArrowUp, ArrowRight, Star,
  GitCompare, TrendingDown, TrendingUp, Award,
} from "lucide-react";

interface RepoComparison {
  repo_name: string;
  latest_scan: string;
  findings_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score: number;
  risk_grade: string;
  trend_direction: "improving" | "degrading" | "stable" | "new";
}

const gradeColor: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

function TrendBadge({ dir }: { dir: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; variant: "success" | "high" | "outline" | "low" }> = {
    improving: { icon: <ArrowDown className="h-3 w-3" />, label: "Improving", variant: "success" },
    degrading: { icon: <ArrowUp className="h-3 w-3" />,   label: "Degrading", variant: "high" },
    stable:    { icon: <ArrowRight className="h-3 w-3" />, label: "Stable",    variant: "outline" },
    new:       { icon: <Star className="h-3 w-3" />,       label: "New",       variant: "low" },
  };
  const { icon, label, variant } = map[dir] ?? map.stable;
  return (
    <Badge variant={variant} className="gap-1">
      {icon} {label}
    </Badge>
  );
}

type SortField = "repo_name" | "findings_count" | "high_count" | "risk_score" | "risk_grade";

function riskBarFill(score: number) {
  if (score <= 20) return "hsl(160 84% 39%)";
  if (score <= 50) return "hsl(224 90% 63%)";
  if (score <= 85) return "hsl(45 93% 56%)";
  return "hsl(0 84% 60%)";
}

export default function ComparePage() {
  const [data, setData] = useState<RepoComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>("risk_score");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    fetch("/api/compare")
      .then((r) => r.json())
      .then((d) => {
        setData(d.comparisons ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSort = (field: SortField) => {
    if (sortBy === field) setSortAsc(!sortAsc);
    else { setSortBy(field); setSortAsc(field === "repo_name"); }
  };

  const sorted = [...data].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "repo_name") cmp = a.repo_name.localeCompare(b.repo_name);
    else cmp = (a[sortBy] as number) - (b[sortBy] as number);
    return sortAsc ? cmp : -cmp;
  });

  const bestRepo       = data.length > 0 ? [...data].sort((a, b) => a.risk_score - b.risk_score)[0] : null;
  const improvingCount = data.filter((d) => d.trend_direction === "improving").length;
  const degradingCount = data.filter((d) => d.trend_direction === "degrading").length;

  const sortArrow = (field: SortField) =>
    sortBy === field ? (sortAsc ? " ▲" : " ▼") : "";

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compare</h1>
        <p className="mt-1 text-muted-foreground">Cross-repository comparison and health overview</p>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">Loading...</div>
      ) : data.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <GitCompare className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-muted-foreground">No data to compare</h3>
          <p className="mt-1 text-sm text-muted-foreground/70">Push scans from multiple repositories to see comparisons.</p>
        </Card>
      ) : (
        <>
          {/* ── Summary stat cards ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Repositories</CardTitle>
                <GitCompare className="h-5 w-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Improving</CardTitle>
                <TrendingDown className="h-5 w-5 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-emerald-400">{improvingCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Degrading</CardTitle>
                <TrendingUp className="h-5 w-5 text-red-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-400">{degradingCount}</div>
              </CardContent>
            </Card>
            {bestRepo && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Best Repo</CardTitle>
                  <Award className="h-5 w-5 text-amber-400" />
                </CardHeader>
                <CardContent>
                  <div className="truncate text-lg font-semibold text-emerald-400">{bestRepo.repo_name}</div>
                  <p className="text-xs text-muted-foreground">Score {bestRepo.risk_score}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Rankings table ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Repository Rankings</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("repo_name")}>
                      Repository{sortArrow("repo_name")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-center" onClick={() => handleSort("risk_grade")}>
                      Grade{sortArrow("risk_grade")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("risk_score")}>
                      Risk Score{sortArrow("risk_score")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("findings_count")}>
                      Findings{sortArrow("findings_count")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("high_count")}>
                      High{sortArrow("high_count")}
                    </TableHead>
                    <TableHead className="text-center">Trend</TableHead>
                    <TableHead className="text-right">Last Scan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => (
                    <TableRow key={r.repo_name}>
                      <TableCell className="font-medium">
                        <Link href={`/repos/${encodeURIComponent(r.repo_name)}`} className="text-primary hover:underline">
                          {r.repo_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xl font-bold ${gradeColor[r.risk_grade] ?? ""}`}>
                          {r.risk_grade}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.risk_score}</TableCell>
                      <TableCell className="text-right">{r.findings_count}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="high">{r.high_count}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <TrendBadge dir={r.trend_direction} />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(r.latest_scan).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ── Risk score comparison bar chart ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Risk Score Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <SafeChart height={Math.max(200, sorted.length * 48)}>
                <BarChart data={sorted} layout="vertical" barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="repo_name"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={160}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(216 46% 13%)",
                      border: "1px solid hsl(213 52% 24%)",
                      borderRadius: 8,
                    }}
                    formatter={(value) => [`${value}`, "Risk Score"]}
                  />
                  <Bar dataKey="risk_score" name="Risk Score" radius={[0, 4, 4, 0]}>
                    {sorted.map((entry, i) => (
                      <Cell key={i} fill={riskBarFill(entry.risk_score)} />
                    ))}
                  </Bar>
                </BarChart>
              </SafeChart>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
