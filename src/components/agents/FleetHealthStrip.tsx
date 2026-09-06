"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { FleetHealthRow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function FleetHealthStrip({
  rows,
  loading,
  error,
  onRefresh,
}: {
  rows: FleetHealthRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const metered = rows.filter(
    (r) => r.installed && r.auth.billing === "metered",
  ).length;
  const homeScoped = rows.filter(
    (r) => r.installed && r.workspace.scope === "home",
  ).length;

  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Fleet health
          <span className="text-[11px] font-normal text-muted">
            live from this machine — nothing seeded
          </span>
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/settings#fleet-governance"
            className="text-xs text-accent hover:underline"
          >
            Governance
          </Link>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={loading}
            onClick={onRefresh}
            aria-label="Refresh fleet health"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-2 !pt-2">
        {error ? <p className="text-xs text-amber-300/90">{error}</p> : null}

        {metered > 0 || homeScoped > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {metered > 0 ? (
              <span>
                {metered} agent{metered > 1 ? "s" : ""} billing metered API usage.
              </span>
            ) : null}
            {homeScoped > 0 ? (
              <span>
                {homeScoped} agent{homeScoped > 1 ? "s" : ""} scoped to the whole
                home folder.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Agent</th>
                <th className="py-1.5 pr-3 font-medium">Version</th>
                <th className="py-1.5 pr-3 font-medium">Auth</th>
                <th className="py-1.5 pr-3 font-medium">Approval</th>
                <th className="py-1.5 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.installed && "opacity-50")}>
                  <td className="py-1.5 pr-3 font-medium" title={r.command || r.detail}>
                    {r.label}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted">
                    {r.installed ? (r.version ?? "—") : "not installed"}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 pr-3",
                      r.auth.billing === "metered"
                        ? "text-amber-300"
                        : r.auth.billing === "subscription"
                          ? "text-emerald-300"
                          : "text-muted",
                    )}
                    title={r.auth.detail}
                  >
                    {r.installed ? r.auth.label : "—"}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 pr-3",
                      r.approval.applied === "auto"
                        ? "text-rose-300"
                        : r.approval.applied === "inherit"
                          ? "text-muted"
                          : "text-sky-300",
                    )}
                    title={r.approval.detail}
                  >
                    {r.approval.applied === "inherit"
                      ? "CLI default"
                      : r.approval.applied}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 font-mono",
                      r.workspace.scope === "home"
                        ? "text-amber-300"
                        : "text-muted",
                    )}
                    title={`${r.workspace.cwd} — ${r.workspace.detail}`}
                  >
                    {shortPath(r.workspace.cwd)}
                  </td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan={5} className="py-3 text-muted">
                    No agent CLIs detected on PATH.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
