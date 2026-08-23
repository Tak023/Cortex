import { NextResponse } from "next/server";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Fleet metrics, split by provenance.
 *
 * These are Cortex's own counters for work Cortex orchestrated — they are not
 * provider billing. The Command Center labels them that way so they can never
 * be read as a second opinion on the provider credit cards.
 *
 * Latency and success rate are averaged over *measured* agents only; averaging
 * registry placeholders into a fleet-wide success rate produced a number that
 * looked authoritative and meant nothing.
 */
export async function GET() {
  const state = getState();
  const agents = state.agents;
  const usage = state.usage;

  const measured = agents.filter((a) => a.metrics.source === "measured");
  const simulated = agents.filter((a) => a.metrics.source === "simulated");
  const seeded = agents.filter(
    (a) => (a.metrics.source ?? "seeded") === "seeded",
  );

  const sumTokens = (list: typeof agents) =>
    list.reduce((s, a) => s + a.metrics.tokensUsed, 0);

  const measuredTokens = sumTokens(measured);
  const simulatedTokens = sumTokens(simulated);
  const seededTokens = sumTokens(seeded);

  const costUsd = usage.reduce((s, u) => s + u.costUsd, 0);

  const avg = (list: typeof agents, pick: (a: (typeof agents)[number]) => number) =>
    list.length
      ? list.reduce((s, a) => s + pick(a), 0) / list.length
      : null;

  const avgLatency = avg(measured, (a) => a.metrics.avgLatencyMs);
  const successRate = avg(measured, (a) => a.metrics.successRate);

  const busy = agents.filter((a) => a.status === "busy").length;
  const online = agents.filter(
    (a) => a.status === "idle" || a.status === "online" || a.status === "busy",
  ).length;

  return NextResponse.json({
    metrics: {
      /** Tokens Cortex actually observed. */
      measuredTokens,
      /** Tokens produced by the simulation adapter. */
      simulatedTokens,
      /** Registry placeholders that were never observed. */
      seededTokens,
      /** Everything on screen today, for backwards compatibility. */
      totalTokens: measuredTokens + simulatedTokens + seededTokens,
      measuredAgents: measured.length,
      simulatedAgents: simulated.length,
      seededAgents: seeded.length,
      costUsd: Number(costUsd.toFixed(4)),
      avgLatencyMs: avgLatency == null ? null : Math.round(avgLatency),
      successRate: successRate == null ? null : Number(successRate.toFixed(3)),
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
