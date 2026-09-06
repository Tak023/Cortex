/**
 * Server-side glue between the pure router and live machine state.
 *
 * Assembles the inputs `routeForClass` needs — settings, per-class outcome
 * history, usage records, budget state and the billing mode of each cloud
 * agent — and hands back a decision the engine can act on and the UI can
 * explain.
 *
 * Server-only: reads fleet governance, which shells out to detect auth mode.
 */
import type {
  Agent,
  PipelinePhase,
  RoutingDecision,
  UsageRecord,
} from "../types";
import { getSettings, getState } from "../store";
import { routeForClass, taskClassForPhase } from "../agents/router";
import { agentCost, estimateCostUsd } from "../agents/costModel";
import type { BillingHint } from "../agents/costModel";
import { detectAgentAuth } from "../agents/governance";
import type { ExternalAgentId } from "../agents/externalAgents";
import type { TaskClass } from "../agents/taskClass";
import { listRoutingStats } from "./routingStats";
import { budgetReport, wouldExceedBudget } from "./budget";

/** Registry agents that are really a passthrough CLI with its own billing. */
const CLI_AGENT_IDS: Record<string, ExternalAgentId> = {
  "agent-hermes": "hermes",
  "agent-claude-code": "claude-code",
  "agent-codex": "codex",
  "agent-grok": "grok",
  "agent-antigravity": "antigravity",
};

/**
 * Auth detection touches the keychain, so it is cached. Billing mode changes
 * when someone logs in or out — minutes-scale, not seconds-scale.
 */
const BILLING_TTL_MS = 2 * 60_000;
let billingCache: { at: number; map: Record<string, BillingHint> } | null = null;

export function billingHints(): Record<string, BillingHint> {
  if (billingCache && Date.now() - billingCache.at < BILLING_TTL_MS) {
    return billingCache.map;
  }
  const map: Record<string, BillingHint> = {};
  const preference = getSettings().claudeAuthPreference ?? "auto";
  for (const [agentId, cliId] of Object.entries(CLI_AGENT_IDS)) {
    try {
      const auth = detectAgentAuth(cliId, preference);
      map[agentId] =
        auth.billing === "subscription"
          ? "subscription"
          : auth.billing === "metered"
            ? "metered"
            : "unknown";
    } catch {
      map[agentId] = "unknown";
    }
  }
  billingCache = { at: Date.now(), map };
  return map;
}

/** Drop the cache after a settings change that could flip billing. */
export function invalidateBillingHints(): void {
  billingCache = null;
}

export interface RouteOptions {
  phase: PipelinePhase | "brainstorm";
  projectId?: string | null;
  /** Agents that already failed this task and must not be picked again. */
  excludeIds?: string[];
  agents?: Agent[];
  usage?: UsageRecord[];
}

/**
 * Resolve who should do this phase, under the active policy and budget.
 *
 * Always returns a decision — including when nothing is routable, so callers
 * can surface the reason instead of failing silently.
 */
export function routeTask(opts: RouteOptions): RoutingDecision {
  const settings = getSettings();
  const state = getState();
  const agents = opts.agents ?? state.agents;
  const usage = opts.usage ?? state.usage;
  const taskClass = taskClassForPhase(opts.phase);
  const budget = budgetReport(opts.projectId);

  return routeForClass({
    agents,
    taskClass,
    phase: opts.phase,
    policy: settings.routingPolicy ?? "quality-first",
    stats: listRoutingStats(),
    usage,
    billing: billingHints(),
    minSuccessRate: settings.routingMinSuccessRate ?? 0.7,
    minAttempts: settings.routingMinAttempts ?? 3,
    exploreUnproven: settings.routingExploreUnproven !== false,
    excludeIds: opts.excludeIds,
    meteredBlocked: budget.blocked,
  });
}

/**
 * Marginal cost of a completed run. Local and plan-covered work is $0 — only
 * metered tokens consume a budget, so only they are priced.
 */
export function costForRun(
  agentId: string,
  tokens: number,
): { costUsd: number; tier: string } {
  const state = getState();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return { costUsd: 0, tier: "unknown" };
  const cost = agentCost(agent, state.usage, billingHints()[agentId]);
  return { costUsd: estimateCostUsd(cost, tokens), tier: cost.tier };
}

/** Would dispatching this agent break a cap? */
export function budgetGate(
  agentId: string | null,
  projectId: string | null | undefined,
  estimatedTokens = 2000,
): { blocked: boolean; reason: string | null } {
  if (!agentId) return { blocked: false, reason: null };
  const { costUsd } = costForRun(agentId, estimatedTokens);
  if (costUsd <= 0) {
    // Free work is never gated — a spent budget must not stop local models.
    return { blocked: false, reason: null };
  }
  const check = wouldExceedBudget(costUsd, projectId);
  return { blocked: check.exceeds, reason: check.reason };
}

export type { TaskClass };
