"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityFeed } from "@/components/orchestration/ActivityFeed";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useActivity, useAgents, useMetrics, useProjects } from "@/lib/hooks";
import { formatTokens, statusColor } from "@/lib/utils";
import Link from "next/link";

export default function OrchestrationPage() {
  const { agents } = useAgents(5000);
  const { projects } = useProjects(5000);
  const activity = useActivity(60, 4000);
  const metrics = useMetrics(8000);

  const working = agents.filter((a) => a.status === "busy");
  const live = projects.filter(
    (p) =>
      p.status === "running" ||
      p.status === "awaiting_approval" ||
      p.status === "paused",
  );

  return (
    <>
      <PageHeader
        title="Live Orchestration"
        description="Who is working on what — current steps, handoffs, and estimated remaining work"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody className="!py-3">
              <div className="text-xs text-muted">Busy agents</div>
              <div className="text-2xl font-semibold tabular-nums">
                {working.length}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="!py-3">
              <div className="text-xs text-muted">Live pipelines</div>
              <div className="text-2xl font-semibold tabular-nums">
                {live.length}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="!py-3">
              <div className="text-xs text-muted">Fleet success</div>
              <div className="text-2xl font-semibold tabular-nums">
                {metrics
                  ? `${Math.round(metrics.successRate * 100)}%`
                  : "—"}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <span className="text-sm font-medium">Agent assignments</span>
            </CardHeader>
            <CardBody className="space-y-2 !pt-2">
              {agents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <Badge className={statusColor(a.status)}>
                        {a.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {a.currentTaskLabel || "Standing by"}
                    </p>
                  </div>
                  <div className="text-right text-[11px] tabular-nums text-muted">
                    <div>{formatTokens(a.metrics.tokensUsed)}</div>
                    <div>{a.metrics.avgLatencyMs}ms</div>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-medium">Pipeline status</span>
            </CardHeader>
            <CardBody className="space-y-3 !pt-2">
              {live.length === 0 && (
                <p className="py-8 text-center text-sm text-muted">
                  No active pipelines.{" "}
                  <Link href="/ideas" className="text-accent hover:underline">
                    Start from Ideas
                  </Link>
                </p>
              )}
              {live.map((p) => {
                const done = p.tasks.filter(
                  (t) =>
                    t.status === "completed" || t.status === "approved",
                ).length;
                const running = p.tasks.find((t) => t.status === "running");
                const awaiting = p.tasks.find(
                  (t) => t.status === "awaiting_approval",
                );
                const remaining = p.tasks
                  .filter(
                    (t) =>
                      t.status !== "completed" && t.status !== "approved",
                  )
                  .reduce((s, t) => s + t.estimatedMinutes, 0);
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block rounded-lg border border-border-subtle px-3 py-3 hover:border-blue-500/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge className={statusColor(p.status)}>
                        {p.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {awaiting
                        ? `Gate: approve ${awaiting.title}`
                        : running
                          ? `Step: ${running.title} (${running.progress}%)`
                          : `${done}/${p.tasks.length} phases`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      ~{remaining} min remaining (sim)
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.tasks.map((t) => (
                        <span
                          key={t.id}
                          className={`h-1.5 w-6 rounded-full ${
                            t.status === "completed" ||
                            t.status === "approved"
                              ? "bg-emerald-400"
                              : t.status === "running"
                                ? "bg-sky-400 animate-pulse"
                                : t.status === "awaiting_approval"
                                  ? "bg-violet-400"
                                  : "bg-border"
                          }`}
                          title={`${t.title}: ${t.status}`}
                        />
                      ))}
                    </div>
                  </Link>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <ActivityFeed
          activity={activity}
          title="Global activity stream"
          maxHeight="max-h-80"
        />
      </div>
    </>
  );
}
