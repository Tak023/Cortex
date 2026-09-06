/**
 * What an agent costs to run.
 *
 * Deliberately *ordinal first, numeric second*. Published per-token prices
 * change without notice and Cortex has no reliable way to know which model a
 * passthrough CLI picked, so inventing a $/1k rate for every agent would just
 * be a confident-looking guess — the exact failure the review flagged
 * elsewhere. Instead:
 *
 *   1. tier      — free-local < included-in-plan < metered. Always known.
 *   2. observed  — real $/1k derived from this machine's own usage records,
 *                  when there are enough of them.
 *   3. declared  — a per-agent override the operator can set.
 *
 * The router orders by tier and only uses numbers to break ties inside a tier.
 *
 * Client-safe: no Node APIs.
 */
import type { Agent, UsageRecord } from "../types";

export type CostTier = "free-local" | "included" | "metered";

export const COST_TIER_RANK: Record<CostTier, number> = {
  "free-local": 0,
  included: 1,
  metered: 2,
};

export const COST_TIER_LABEL: Record<CostTier, string> = {
  "free-local": "local · free",
  included: "plan · included",
  metered: "metered",
};

/** Usage records needed before an observed rate is trusted over the tier. */
const MIN_RECORDS_FOR_OBSERVED_RATE = 5;

export interface AgentCost {
  tier: CostTier;
  rank: number;
  /** Observed $/1k tokens from local usage history; null when unknown. */
  observedPer1kUsd: number | null;
  /** Operator override from agent config; null when unset. */
  declaredPer1kUsd: number | null;
  /** Best available $/1k for tie-breaking. 0 for free tiers. */
  effectivePer1kUsd: number;
  detail: string;
}

/**
 * Billing mode reported by fleet governance for the passthrough CLIs. Passing
 * it in keeps this module free of Node APIs and lets the caller decide how
 * fresh that information needs to be.
 */
export type BillingHint = "subscription" | "metered" | "unknown";

/**
 * `type: "local"` says where the *process* runs, not who pays. Hermes is a
 * local CLI in front of a paid Nous Portal balance; the LM Studio agents are
 * genuinely on-device. The registry already separates them — only true
 * on-device inference carries the `offline` capability — so that is the
 * marker used here rather than the process location.
 */
function isOnDevice(agent: Agent): boolean {
  return (
    agent.type === "local" &&
    (agent.capabilities.includes("offline") ||
      agent.capabilities.includes("local-inference"))
  );
}

function tierFor(agent: Agent, billing: BillingHint | undefined): CostTier {
  // An explicit billing signal always wins, including for local agents.
  if (billing === "metered") return "metered";
  if (billing === "subscription") return "included";
  if (isOnDevice(agent)) return "free-local";
  if (agent.type === "local") {
    // A local runtime with no billing signal and no offline guarantee — e.g.
    // Jarvis, which in hybrid mode can escalate a query to paid Grok. Cheaper
    // than a known-metered cloud agent, but not free enough to claim it is.
    return "included";
  }
  // Cloud agent with unknown auth: assume it costs money. Guessing "free"
  // would silently route spend to it.
  return "metered";
}

function observedRate(
  agentId: string,
  usage: UsageRecord[],
): { rate: number | null; samples: number } {
  let tokens = 0;
  let cost = 0;
  let samples = 0;
  for (const u of usage) {
    if (u.agentId !== agentId) continue;
    samples += 1;
    tokens += u.tokens;
    cost += u.costUsd;
  }
  if (samples < MIN_RECORDS_FOR_OBSERVED_RATE || tokens <= 0) {
    return { rate: null, samples };
  }
  return { rate: (cost / tokens) * 1000, samples };
}

export function agentCost(
  agent: Agent,
  usage: UsageRecord[],
  billing?: BillingHint,
): AgentCost {
  const tier = tierFor(agent, billing);
  const { rate, samples } = observedRate(agent.id, usage);
  const declaredRaw = agent.config.costPer1kUsd;
  const declared =
    typeof declaredRaw === "number" && Number.isFinite(declaredRaw) && declaredRaw >= 0
      ? declaredRaw
      : null;

  const effective =
    tier === "free-local" ? 0 : (declared ?? rate ?? (tier === "included" ? 0 : 0));

  const detail =
    tier === "free-local"
      ? "On-device inference — no marginal token cost."
      : tier === "included"
        ? agent.type === "local"
          ? "Local runtime, but it can proxy to a paid model — not guaranteed free."
          : "Covered by a subscription you already pay for."
        : declared != null
          ? `Declared $${declared.toFixed(4)}/1k tokens.`
          : rate != null
            ? `Observed $${rate.toFixed(4)}/1k over ${samples} runs.`
            : "Metered — no local price data yet.";

  return {
    tier,
    rank: COST_TIER_RANK[tier],
    observedPer1kUsd: rate,
    declaredPer1kUsd: declared,
    effectivePer1kUsd: effective,
    detail,
  };
}

/** Estimated spend for a run of `tokens` tokens on this agent. */
export function estimateCostUsd(cost: AgentCost, tokens: number): number {
  if (cost.tier !== "metered") return 0;
  return (tokens / 1000) * cost.effectivePer1kUsd;
}
