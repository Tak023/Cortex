import { NextResponse } from "next/server";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getState();
  const agents = state.agents;
  const usage = state.usage;

  const totalTokens =
    agents.reduce((s, a) => s + a.metrics.tokensUsed, 0) +
    usage.reduce((s, u) => s + u.tokens, 0) / 2; // rough

  const costUsd = usage.reduce((s, u) => s + u.costUsd, 0);
  const avgLatency =
    agents.reduce((s, a) => s + a.metrics.avgLatencyMs, 0) /
    Math.max(agents.length, 1);

  const successRate =
    agents.reduce((s, a) => s + a.metrics.successRate, 0) /
    Math.max(agents.length, 1);

  const busy = agents.filter((a) => a.status === "busy").length;
  const online = agents.filter(
    (a) => a.status === "idle" || a.status === "online" || a.status === "busy",
  ).length;

  return NextResponse.json({
    metrics: {
      totalTokens: Math.round(totalTokens),
      costUsd: Number(costUsd.toFixed(4)),
      avgLatencyMs: Math.round(avgLatency),
      successRate: Number(successRate.toFixed(3)),
      agentsOnline: online,
      agentsBusy: busy,
      projectsActive: state.projects.filter(
        (p) => p.status === "running" || p.status === "awaiting_approval",
      ).length,
      projectsTotal: state.projects.length,
      ideasTotal: state.ideas.length,
    },
    usage: usage.slice(0, 30),
  });
}
