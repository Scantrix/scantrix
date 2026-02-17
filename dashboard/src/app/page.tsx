"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart3, AlertTriangle, Activity, ShieldCheck, SearchCode
} from "lucide-react";

interface RepoRow {
  id: number;
  name: string;
  last_scanned_at?: string;
  findings_count?: number;
  high_count?: number;
  medium_count?: number;
  low_count?: number;
  risk_grade?: string;
  risk_score?: number;
}

const gradeColor: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

export default function DashboardPage() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalRepos    = repos.length;
  const totalFindings = repos.reduce((s, r) => s + (r.findings_count ?? 0), 0);
  const totalHigh     = repos.reduce((s, r) => s + (r.high_count ?? 0), 0);
  const avgScore      = totalRepos > 0
    ? repos.reduce((s, r) => s + (r.risk_score ?? 0), 0) / totalRepos
    : 0;
  const avgGrade = avgScore <= 20 ? "A" : avgScore <= 50 ? "B" : avgScore <= 85 ? "C" : avgScore <= 120 ? "D" : "F";

  const statCards = [
    { label: "Repositories",  value: totalRepos,    icon: BarChart3,     color: "text-primary" },
    { label: "Total Findings", value: totalFindings, icon: SearchCode,      color: "text-blue-400" },
    { label: "High Severity",  value: totalHigh,     icon: AlertTriangle, color: "text-red-400" },
    { label: "Avg Grade",      value: totalRepos > 0 ? avgGrade : "—", icon: ShieldCheck, color: gradeColor[avgGrade] ?? "text-muted-foreground" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">Overview of all tracked repositories</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-[30px] w-[30px] ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            </CardContent>
            {/* Decorative gradient bar */}
            <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
          </Card>
        ))}
      </div>

      {/* Repo table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      ) : repos.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <BarChart3 className="mb-4 h-[18px] w-[18px] text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-muted-foreground">No repositories tracked yet</h3>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Push your first scan with: <code className="rounded bg-muted px-2 py-0.5 text-xs">qaverity push findings.json --key YOUR_API_KEY</code>
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Repositories</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead className="text-center">Grade</TableHead>
                  <TableHead className="text-right">Findings</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Medium</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">Last Scan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repos.map((r) => (
                  <TableRow key={r.id}>
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
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
