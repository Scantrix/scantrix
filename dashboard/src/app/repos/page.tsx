"use client";

import { useEffect, useState, useCallback } from "react";
import NavLink from "@/components/nav-link";
import { useNavigationLoading } from "@/components/loading-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderGit2, Trash2 } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import Spinner from "@/components/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface RepoRow {
  id: number;
  name: string;
  url?: string;
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

function riskBarColor(score: number) {
  if (score <= 20) return "bg-emerald-500";
  if (score <= 50) return "bg-blue-500";
  if (score <= 85) return "bg-amber-500";
  return "bg-red-500";
}

export default function ReposPage() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoToDelete, setRepoToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { stopLoading } = useNavigationLoading();

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos ?? []);
        setLoading(false);
        stopLoading();
      })
      .catch(() => { setLoading(false); stopLoading(); });
  }, [stopLoading]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!repoToDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoToDelete)}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Remove from local state
      setRepos((prev) => prev.filter((r) => r.name !== repoToDelete));
      setRepoToDelete(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  }, [repoToDelete]);

  const handleDeleteCancel = useCallback(() => {
    if (deleting) return;
    setRepoToDelete(null);
    setDeleteError(null);
  }, [deleting]);

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="space-y-8 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
          <p className="mt-1 text-muted-foreground">All tracked repositories and their latest scan results</p>
        </div>

        {loading ? (
          <Spinner />
        ) : repos.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-16">
            <FolderGit2 className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold text-muted-foreground">No repositories tracked yet</h3>
            <p className="mt-1 text-sm text-muted-foreground/70">Run a scan and push findings to get started.</p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {repos.map((r) => (
              <Card key={r.id} className="group relative overflow-hidden transition-colors hover:border-primary/40">
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      <NavLink href={`/repos/${encodeURIComponent(r.name)}`} className="text-primary hover:underline">
                        {r.name}
                      </NavLink>
                    </CardTitle>
                    {r.last_scanned_at && (
                      <p className="text-xs text-muted-foreground">
                        Last scan: {new Date(r.last_scanned_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className={`text-2xl font-bold ${gradeColor[r.risk_grade ?? ""] ?? "text-muted-foreground"}`}>
                    {r.risk_grade ?? "—"}
                  </span>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Severity badges */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className="gap-1">
                      Total <strong>{r.findings_count ?? 0}</strong>
                    </Badge>
                    <Badge variant="high" className="gap-1">H {r.high_count ?? 0}</Badge>
                    <Badge variant="medium" className="gap-1">M {r.medium_count ?? 0}</Badge>
                    <Badge variant="low" className="gap-1">L {r.low_count ?? 0}</Badge>
                  </div>

                  {/* Risk score bar */}
                  {r.risk_score !== undefined && (
                    <div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${riskBarColor(r.risk_score)}`}
                          style={{ width: `${Math.min(100, (r.risk_score / 150) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">Risk score: {r.risk_score}</p>
                    </div>
                  )}
                </CardContent>

                {/* Delete button — bottom-right of card */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Delete repository ${r.name}`}
                      onClick={() => setRepoToDelete(r.name)}
                      className="absolute bottom-2.5 right-2.5 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      sideOffset={6}
                      className="z-50 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
                    >
                      Delete repository
                      <Tooltip.Arrow className="fill-border" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* Hover accent */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              </Card>
            ))}
          </div>
        )}

        {/* Delete error toast */}
        {deleteError && (
          <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg">
            <p className="font-medium">Delete failed</p>
            <p className="mt-0.5 text-xs opacity-80">{deleteError}</p>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              className="absolute right-2 top-2 text-destructive/60 hover:text-destructive"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Confirmation dialog */}
        <ConfirmDialog
          open={repoToDelete !== null}
          title={`Delete repository ${repoToDelete ?? ""}?`}
          description="Are you sure you want to delete this repository? This action can't be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          loading={deleting}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      </div>
    </Tooltip.Provider>
  );
}
