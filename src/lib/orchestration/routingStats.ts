/**
 * Per-(agent, task class) outcome history.
 *
 * Cortex already recorded latency, tokens and success — but only as one global
 * number per agent, which cannot answer the question a scheduler actually
 * asks: *"has this local model ever succeeded at test scaffolding?"* Success on
 * summarization tells you nothing about architecture, so the stats are kept per
 * class and never averaged across them.
 *
 * Only real outcomes are recorded. Simulated runs are counted separately and
 * excluded from routing decisions — routing on synthetic wins would let the
 * simulator promote an agent that has never done the work.
 */
import type { RoutingStat, TaskClass } from "../types";
import { getState, updateState } from "../store";

/** Outcomes needed before a stat is trusted instead of the curated default. */
export const DEFAULT_MIN_ATTEMPTS = 3;

export function routingStatKey(agentId: string, taskClass: TaskClass): string {
  return `${agentId}|${taskClass}`;
}

export function listRoutingStats(): RoutingStat[] {
  return getState().routingStats ?? [];
}

export function getRoutingStat(
  agentId: string,
  taskClass: TaskClass,
  stats?: RoutingStat[],
): RoutingStat | null {
  const all = stats ?? listRoutingStats();
  return (
    all.find((s) => s.agentId === agentId && s.taskClass === taskClass) ?? null
  );
}

/** Success rate over real attempts, or null when there is no evidence yet. */
export function observedSuccessRate(stat: RoutingStat | null): number | null {
  if (!stat || stat.attempts <= 0) return null;
  return stat.successes / stat.attempts;
}

export function recordRoutingOutcome(input: {
  agentId: string;
  taskClass: TaskClass;
  ok: boolean;
  tokens?: number;
  latencyMs?: number;
  costUsd?: number;
  /** Simulated runs are tracked but never counted toward routing evidence. */
  simulated?: boolean;
  error?: string;
}): RoutingStat {
  const now = new Date().toISOString();
  let out: RoutingStat | null = null;

  updateState((s) => {
    if (!s.routingStats) s.routingStats = [];
    let stat = s.routingStats.find(
      (x) => x.agentId === input.agentId && x.taskClass === input.taskClass,
    );
    if (!stat) {
      stat = {
        agentId: input.agentId,
        taskClass: input.taskClass,
        attempts: 0,
        successes: 0,
        simulatedAttempts: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        totalCostUsd: 0,
        lastAt: now,
        lastError: null,
      };
      s.routingStats.push(stat);
    }

    if (input.simulated) {
      stat.simulatedAttempts += 1;
    } else {
      stat.attempts += 1;
      if (input.ok) stat.successes += 1;
      stat.totalTokens += Math.max(0, input.tokens ?? 0);
      stat.totalLatencyMs += Math.max(0, input.latencyMs ?? 0);
      stat.totalCostUsd += Math.max(0, input.costUsd ?? 0);
    }
    stat.lastAt = now;
    stat.lastError = input.ok ? null : (input.error?.slice(0, 300) ?? "failed");
    out = stat;
  });

  return (
    out ?? {
      agentId: input.agentId,
      taskClass: input.taskClass,
      attempts: 0,
      successes: 0,
      simulatedAttempts: 0,
      totalTokens: 0,
      totalLatencyMs: 0,
      totalCostUsd: 0,
      lastAt: now,
      lastError: null,
    }
  );
}

export function resetRoutingStats(): void {
  updateState((s) => {
    s.routingStats = [];
  });
}

/** Mean latency per real attempt, or null when unmeasured. */
export function observedLatencyMs(stat: RoutingStat | null): number | null {
  if (!stat || stat.attempts <= 0) return null;
  return Math.round(stat.totalLatencyMs / stat.attempts);
}

/** Mean tokens per real attempt — the basis for pre-run cost estimates. */
export function observedTokens(stat: RoutingStat | null): number | null {
  if (!stat || stat.attempts <= 0) return null;
  return Math.round(stat.totalTokens / stat.attempts);
}
