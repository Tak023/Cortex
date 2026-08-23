"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitBranch, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { RoutingDecision } from "@/lib/types";

type BudgetState = {
  capUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exhausted: boolean;
  utilization: number | null;
};

type RoutingResponse = {
  policy: {
    routingPolicy: string;
    routingMinSuccessRate: number;
    routingMinAttempts: number;
    routingExploreUnproven: boolean;
  };
  budget: {
    day: BudgetState;
    project: BudgetState | null;
    blocked: boolean;
    reason: string | null;
  };
  table: Array<{
    taskClass: string;
    label: string;
    stakes: string;
    decision: RoutingDecision;
  }>;
  agents: Array<{
    id: string;
    name: string;
    type: string;
    cost: { tier: string; detail: string };
    perClass: Array<{
      taskClass: string;
      attempts: number;
      successRate: number | null;
    }>;
  }>;
};

const TIER_STYLE: Record<string, string> = {
  "free-local": "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  included: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  metered: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

const TIER_LABEL: Record<string, string> = {
  "free-local": "local · free",
  included: "plan",
  metered: "metered",
};

const POLICY_LABEL: Record<string, string> = {
  "quality-first": "Quality first",
  "cost-aware": "Cost aware",
  "local-first": "Local first",
};

function BudgetBar({ label, state }: { label: string; state: BudgetState }) {
  if (state.capUsd == null) {
    return (
      <div className="text-[11px] text-muted">
        {label}: <span className="tabular-nums">${state.spentUsd.toFixed(2)}</span>{" "}
        spent · no cap
      </div>
    );
  }
  const pct = Math.min(100, Math.round((state.utilization ?? 0) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span
          className={cn(
            "tabular-nums",
            state.exhausted ? "text-rose-300" : "text-muted",
          )}
        >
          ${state.spentUsd.toFixed(2)} / ${state.capUsd.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            state.exhausted
              ? "bg-rose-500"
              : pct > 80
                ? "bg-amber-400"
                : "bg-emerald-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function RoutingPanel({ projectId }: { projectId?: string }) {
  const [data, setData] = useState<RoutingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const res = await fetch(`/api/routing${q}`, { cache: "no-store" });
      const json = (await res.json()) as RoutingResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `Routing failed (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const policy = data?.policy.routingPolicy ?? "quality-first";

  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="h-4 w-4 text-accent" />
          Routing policy
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              policy === "quality-first"
                ? "border-border bg-white/5 text-muted"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {POLICY_LABEL[policy] ?? policy}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/settings#routing-budgets"
            className="text-xs text-accent hover:underline"
          >
            Configure
          </Link>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Refresh routing table"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3 !pt-3">
        {error ? <p className="text-xs text-amber-300/90">{error}</p> : null}

        {data ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <BudgetBar label="Metered spend today" state={data.budget.day} />
            {data.budget.project ? (
              <BudgetBar label="This project" state={data.budget.project} />
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <Wallet className="h-3 w-3" />
                Only metered tokens count — local and plan-covered work is free.
              </div>
            )}
          </div>
        ) : null}

        {data?.budget.blocked ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {data.budget.reason} Metered agents are blocked; work routes to local
            models until the cap resets or is raised.
          </p>
        ) : null}

        {policy === "quality-first" ? (
          <p className="rounded-lg border border-border bg-panel-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
            Every phase goes to its curated specialist and cost is not
            considered. Switch to <strong>Cost aware</strong> or{" "}
            <strong>Local first</strong> in Settings to route cheap classes to
            local models once they have proven themselves.
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Class</th>
                <th className="py-1.5 pr-3 font-medium">Routes to</th>
                <th className="py-1.5 pr-3 font-medium">Cost</th>
                <th className="py-1.5 pr-3 font-medium">Evidence</th>
                <th className="py-1.5 font-medium">Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {(data?.table ?? []).map((row) => {
                const d = row.decision;
                const open = expanded === row.taskClass;
                return (
                  <Fragment key={row.taskClass}>
                    <tr
                      className="cursor-pointer hover:bg-white/[0.02]"
                      onClick={() =>
                        setExpanded(open ? null : row.taskClass)
                      }
                    >
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{row.label}</span>
                        {row.stakes === "high" ? (
                          <span className="ml-1 text-[9px] uppercase text-amber-300/80">
                            high stakes
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3">{d.agentName}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[9px]",
                            TIER_STYLE[d.costTier] ??
                              "border-border bg-white/5 text-muted",
                          )}
                        >
                          {TIER_LABEL[d.costTier] ?? d.costTier}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-muted">
                        {d.successRate == null
                          ? "unproven"
                          : `${Math.round(d.successRate * 100)}% · ${d.attempts} runs`}
                      </td>
                      <td className="py-1.5 tabular-nums text-muted">
                        {d.estimatedCostUsd > 0
                          ? `$${d.estimatedCostUsd.toFixed(3)}`
                          : "free"}
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={5} className="pb-2.5 pr-3 text-[11px]">
                          <div className="space-y-1.5 rounded-lg border border-border-subtle bg-panel-elevated/40 px-3 py-2">
                            <p className="text-foreground/80">{d.reason}</p>
                            {d.escalationPath.length > 1 ? (
                              <p className="text-muted">
                                Escalation on failure:{" "}
                                <span className="font-mono">
                                  {d.escalationPath.slice(0, 4).join(" → ")}
                                </span>
                              </p>
                            ) : null}
                            {d.rejected.length ? (
                              <ul className="space-y-0.5 text-muted">
                                {d.rejected.slice(0, 5).map((r) => (
                                  <li key={r.agentId}>
                                    <span className="text-foreground/70">
                                      {r.name}
                                    </span>{" "}
                                    — {r.reason}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!data?.table.length && !loading ? (
                <tr>
                  <td colSpan={5} className="py-3 text-muted">
                    No routing table yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted">
          Click a class to see why. Evidence counts real runs only — simulated
          phases never promote an agent.
        </p>
      </CardBody>
    </Card>
  );
}
