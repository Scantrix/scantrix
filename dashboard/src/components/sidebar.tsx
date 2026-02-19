"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderGit2,
  TrendingUp,
  GitCompareArrows,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Navigation config (auto-generated menu) ── */
const navItems = [
  { href: "/",        label: "Dashboard",  icon: LayoutDashboard },
  { href: "/repos",   label: "Repos",      icon: FolderGit2 },
  { href: "/trends",  label: "Trends",     icon: TrendingUp },
  { href: "/compare", label: "Compare",    icon: GitCompareArrows },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  /** Match active route — exact for "/" , startsWith for sub-pages */
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "sticky top-0 z-40 flex h-screen flex-col border-r border-border/50 bg-card/70 backdrop-blur-xl transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      {/* ── Brand ── */}
      <div className="flex h-16 items-center gap-3 border-b border-border/40 px-4">
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <img
            src="/assets/scantrix-logo.svg"
            alt="SCANTRIX"
            className={cn(
              "h-8 w-auto shrink-0 transition-transform hover:scale-105",
              collapsed && "hidden",
            )}
          />
          {collapsed && (
            <img
              src="/assets/scantrix-logo.svg"
              alt="SCANTRIX"
              className="h-8 w-8 shrink-0 rounded transition-transform hover:scale-105"
            />
          )}
        </Link>
      </div>

      {/* ── Nav items ── */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-primary/12 text-primary shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              {!collapsed && (
                <span className="truncate transition-opacity duration-200">
                  {label}
                </span>
              )}
              {/* Active indicator dot (collapsed mode) */}
              {active && collapsed && (
                <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Collapse toggle ── */}
      <div className="border-t border-border/40 p-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-5 w-5 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5 shrink-0" />
              <span className="truncate">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
