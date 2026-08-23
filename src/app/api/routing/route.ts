import { NextResponse } from "next/server";
import { getSettings, getState } from "@/lib/store";
import { agentCost } from "@/lib/agents/costModel";
import {
  TASK_CLASSES,
  TASK_CLASS_LABEL,
  TASK_CLASS_STAKES,
  type TaskClass,
} from "@/lib/agents/taskClass";
import { billingHints, routeTask } from "@/lib/orchestration/routing";
import { budgetReport } from "@/lib/orchestration/budget";
import {
  listRoutingStats,
  observedLatencyMs,
  observedSuccessRate,
  resetRoutingStats,
} from "@/lib/orchestration/routingStats";
import type { PipelinePhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The phase each class is reached through, for the curated fallback ranking. */
const CLASS_PHASE: Record<TaskClass, PipelinePhase | "brainstorm"> = {
  research: "research",
  draft: "planning",
  summarize: "planning",
  architect: "architecture",
  implement: "implementation",
  refactor: "polish",
  test: "testing",
  critique: "polish",
  brainstorm: "brainstorm",
};

/**
 * GET /api/routing — the live routing table.
 *
 * For every task class: who would take it right now, why, what it is expected
 * to cost, and which agents were passed over. Plus per-agent evidence and the
 * current budget state, so the policy is inspectable rather than implicit.
 */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const settings = getSettings();
  const state = getState();
  const stats = listRoutingStats();
  const billing = billingHints();

  const table = TASK_CLASSES.map((taskClass) => {
    const decision = routeTask({
      phase: CLASS_PHASE[taskClass],
      projectId,
    });
    return {
      taskClass,
      label: TASK_CLASS_LABEL[taskClass],
      stakes: TASK_CLASS_STAKES[taskClass],
      decision,
    };
  });

  const agents = state.agents
    .filter((a) => a.config.enabled)
    .map((agent) => {
      const cost = agentCost(agent, state.usage, billing[agent.id]);
      const perClass = TASK_CLASSES.map((taskClass) => {
        const stat =
          stats.find(
            (s) => s.agentId === agent.id && s.taskClass === taskClass,
          ) ?? null;
        return {
          taskClass,
          attempts: stat?.attempts ?? 0,
          simulatedAttempts: stat?.simulatedAttempts ?? 0,
          successRate: observedSuccessRate(stat),
          avgLatencyMs: observedLatencyMs(stat),
          totalCostUsd: stat?.totalCostUsd ?? 0,
          lastError: stat?.lastError ?? null,
        };
      }).filter((c) => c.attempts > 0 || c.simulatedAttempts > 0);

      return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        status: agent.status,
        cost: {
          tier: cost.tier,
          detail: cost.detail,
          observedPer1kUsd: cost.observedPer1kUsd,
          declaredPer1kUsd: cost.declaredPer1kUsd,
        },
        perClass,
      };
    });

  return NextResponse.json({
    policy: {
      routingPolicy: settings.routingPolicy ?? "quality-first",
      routingMinSuccessRate: settings.routingMinSuccessRate ?? 0.7,
      routingMinAttempts: settings.routingMinAttempts ?? 3,
      routingExploreUnproven: settings.routingExploreUnproven !== false,
    },
    budget: budgetReport(projectId),
    table,
    agents,
    fetchedAt: new Date().toISOString(),
  });
}

/** DELETE /api/routing — clear learned per-class evidence and start over. */
export async function DELETE() {
  resetRoutingStats();
  return NextResponse.json({ ok: true, stats: listRoutingStats() });
}
