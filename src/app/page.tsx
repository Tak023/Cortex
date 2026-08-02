"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  FolderKanban,
  Lightbulb,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityFeed } from "@/components/orchestration/ActivityFeed";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useActivity, useAgents, useMetrics, useProjects } from "@/lib/hooks";
import { cn, formatTokens, statusColor } from "@/lib/utils";

export default function CommandCenterPage() {
  const { agents } = useAgents(5000);
  const { projects } = useProjects(5000);
  const activity = useActivity(30, 4000);
  const metrics = useMetrics(8000);

  const busy = agents.filter((a) => a.status === "busy");
  const activeProjects = projects.filter(
    (p) => p.status === "running" || p.status === "awaiting_approval",
  );

  return (
    <>
      <PageHeader
        title="Command Center"
        description="Unified control plane for your local and cloud AI agents"
        actions={
          <Link href="/ideas">
            <Button>
              <Lightbulb className="h-4 w-4" />
              New idea
            </Button>
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Metrics strip */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Agents online",
              value: metrics?.agentsOnline ?? "—",
              sub: `${metrics?.agentsBusy ?? 0} busy`,
              icon: Bot,
            },
            {
              label: "Active projects",
              value: metrics?.projectsActive ?? "—",
              sub: `${metrics?.projectsTotal ?? 0} total`,
              icon: FolderKanban,
            },
            {
              label: "Tokens used",
              value: metrics ? formatTokens(metrics.totalTokens) : "—",
              sub: `$${metrics?.costUsd?.toFixed(3) ?? "0"} est.`,
              icon: Zap,
            },
            {
              label: "Success rate",
              value: metrics
                ? `${Math.round(metrics.successRate * 100)}%`
                : "—",
              sub: `${metrics?.avgLatencyMs ?? "—"}ms avg`,
              icon: Activity,
            },
          ].map((m) => (
            <Card key={m.label}>
              <CardBody className="flex items-start justify-between !py-3.5">
                <div>
                  <div className="text-xs text-muted">{m.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                    {m.value}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{m.sub}</div>
                </div>
                <div className="rounded-lg border border-border bg-panel-elevated p-2 text-accent">
                  <m.icon className="h-4 w-4" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            {/* Live agents */}
            <Card>
              <CardHeader>
                <span className="text-sm font-medium">Agents</span>
                <Link
                  href="/agents"
                  className="text-xs text-accent hover:underline"
                >
                  View all
                </Link>
              </CardHeader>
              <CardBody className="space-y-2 !pt-2">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-panel-elevated/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{agent.name}</span>
                        <Badge className={statusColor(agent.status)}>
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {agent.currentTaskLabel ||
                          agent.roles.slice(0, 3).join(" · ")}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] tabular-nums text-muted">
                      {formatTokens(agent.metrics.tokensUsed)} tok
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            {/* Active projects */}
            <Card>
              <CardHeader>
                <span className="text-sm font-medium">Live projects</span>
                <Link
                  href="/projects"
                  className="text-xs text-accent hover:underline"
                >
                  All projects
                </Link>
              </CardHeader>
              <CardBody className="space-y-2 !pt-2">
                {activeProjects.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted">
                      No pipelines running. Start from an idea.
                    </p>
                    <Link href="/ideas" className="mt-3 inline-block">
                      <Button size="sm" variant="secondary">
                        Generate concepts <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                )}
                {activeProjects.map((p) => {
                  const done = p.tasks.filter(
                    (t) =>
                      t.status === "completed" || t.status === "approved",
                  ).length;
                  const running = p.tasks.find((t) => t.status === "running");
                  const pct = Math.round((done / p.tasks.length) * 100);
                  return (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="block rounded-lg border border-border-subtle bg-panel-elevated/40 px-3 py-3 transition-colors hover:border-blue-500/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        <Badge className={statusColor(p.status)}>
                          {p.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className={cn(
                            "h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all",
                            p.status === "awaiting_approval" && "from-violet-500 to-amber-400",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
                        <span>
                          {running
                            ? `Working: ${running.title}`
                            : p.status === "awaiting_approval"
                              ? "Needs approval"
                              : `${done}/${p.tasks.length} phases`}
                        </span>
                        <span className="tabular-nums">{pct}%</span>
                      </div>
                    </Link>
                  );
                })}
              </CardBody>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <ActivityFeed activity={activity} maxHeight="max-h-[28rem]" />
            {busy.length > 0 && (
              <Card>
                <CardHeader>
                  <span className="text-sm font-medium">Who is working</span>
                </CardHeader>
                <CardBody className="space-y-2 !pt-2">
                  {busy.map((a) => (
                    <div key={a.id} className="text-xs">
                      <span className="font-medium text-sky-300">{a.name}</span>
                      <span className="text-muted"> — </span>
                      <span className="text-foreground/80">
                        {a.currentTaskLabel}
                      </span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
