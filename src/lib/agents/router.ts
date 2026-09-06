import type {
  Agent,
  AgentRole,
  PipelinePhase,
  RoutingDecision,
  RoutingPolicy,
  RoutingStat,
  UsageRecord,
} from "../types";
import {
  agentCost,
  estimateCostUsd,
  type AgentCost,
  type BillingHint,
} from "./costModel";
import {
  LOCAL_FIRST_CLASSES,
  TASK_CLASS_ROLES,
  TASK_CLASS_STAKES,
  taskClassForPhase,
  type TaskClass,
} from "./taskClass";

const PHASE_PRIMARY_ROLES: Record<PipelinePhase, AgentRole[]> = {
  research: ["researcher", "generalist"],
  planning: ["planner", "architect"],
  architecture: ["architect", "coder"],
  implementation: ["coder", "generalist"],
  testing: ["tester", "coder"],
  polish: ["coder", "critic"],
};

/**
 * Preferred agent IDs per phase (best-in-class for that work).
 * First match that is enabled wins a large routing boost.
 *
 * | Phase            | Best fit        | Why                                      |
 * |------------------|-----------------|------------------------------------------|
 * | research         | Jarvis Research | Deep research specialist                 |
 * | planning         | Grok            | Strong planning + critique               |
 * | architecture     | Claude Code     | Elite system design                      |
 * | implementation   | Claude Code     | Best code generation                     |
 * | testing          | Codex           | Strong tests + fast iteration            |
 * | polish           | Claude Code     | UX/polish quality                        |
 * | brainstorm       | Grok / Antigravity | Creative ideation                     |
 */
export const PHASE_PREFERRED_AGENT_IDS: Record<
  PipelinePhase | "brainstorm",
  string[]
> = {
  research: [
    "agent-jarvis-research",
    "agent-hermes",
    "agent-grok",
    "agent-lmstudio-nemotron",
  ],
  planning: [
    "agent-grok",
    "agent-lmstudio-nemotron",
    "agent-jarvis",
    "agent-hermes",
  ],
  architecture: [
    "agent-claude-code",
    "agent-jarvis-code",
    "agent-codex",
    "agent-jarvis",
  ],
  implementation: [
    "agent-claude-code",
    "agent-codex",
    "agent-jarvis-code",
    "agent-lmstudio-glm46v",
  ],
  testing: [
    "agent-codex",
    "agent-claude-code",
    "agent-jarvis-code",
    "agent-lmstudio-qwen",
  ],
  polish: [
    "agent-claude-code",
    "agent-lmstudio-glm46v",
    "agent-jarvis-code",
    "agent-codex",
  ],
  brainstorm: [
    "agent-grok",
    "agent-antigravity",
    "agent-hermes",
    "agent-jarvis",
    "agent-lmstudio-gemma4",
  ],
};

/**
 * Pick the strongest available agent for a pipeline phase.
 * Prefers curated phase specialists, then roles/strengths, then idle status.
 */
export function routeAgent(
  agents: Agent[],
  phase: PipelinePhase | "brainstorm",
  excludeIds: string[] = [],
): Agent | null {
  const candidates = agents.filter(
    (a) => a.config.enabled && !excludeIds.includes(a.id),
  );
  if (candidates.length === 0) return null;

  const preferred = PHASE_PREFERRED_AGENT_IDS[phase] ?? [];

  const scored = candidates.map((agent) => {
    let score = agent.strengths[phase] ?? 40;

    // Hard preference for curated specialists (dominates soft status noise)
    const prefIdx = preferred.indexOf(agent.id);
    if (prefIdx === 0) score += 55;
    else if (prefIdx === 1) score += 32;
    else if (prefIdx === 2) score += 18;
    else if (prefIdx >= 3) score += 10;

    if (phase !== "brainstorm") {
      const roles = PHASE_PRIMARY_ROLES[phase];
      if (agent.roles.some((r) => roles.includes(r))) score += 10;
    }

    // Status: prefer idle, but don't let "offline" wipe a #1 specialist
    // (pipeline phases often use simulation fallback when live agent is down)
    if (agent.status === "idle" || agent.status === "online") score += 12;
    else if (agent.status === "busy") score -= 15;
    else if (agent.status === "error") score -= 30;
    else if (agent.status === "offline") score -= prefIdx === 0 ? 8 : 25;

    // Prefer cloud coding agents for implementation/testing when strengths close
    if (
      (phase === "implementation" || phase === "testing" || phase === "architecture") &&
      (agent.id === "agent-claude-code" ||
        agent.id === "agent-codex" ||
        agent.id === "agent-antigravity")
    ) {
      score += 8;
    }

    // Local-first only for research/planning when not a dedicated coding phase
    if (
      agent.type === "local" &&
      (phase === "research" || phase === "planning" || phase === "brainstorm")
    ) {
      score += 4;
    }

    score += agent.metrics.successRate * 5;
    return { agent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.agent ?? null;
}

// ── Cost-aware routing ──────────────────────────────────────────────────────

/** Tokens assumed for a phase before an agent has any measured history. */
const ASSUMED_TOKENS_PER_RUN = 2000;

/** Stricter bars for classes where a wrong answer is expensive to undo. */
const STAKES_SUCCESS_FLOOR: Record<"low" | "medium" | "high", number> = {
  low: 0.55,
  medium: 0.7,
  high: 0.85,
};

export interface RouteForClassInput {
  agents: Agent[];
  taskClass: TaskClass;
  policy: RoutingPolicy;
  stats: RoutingStat[];
  usage: UsageRecord[];
  /** Billing mode per agent id, from fleet governance. */
  billing?: Record<string, BillingHint>;
  minSuccessRate: number;
  minAttempts: number;
  exploreUnproven: boolean;
  /** Agents excluded because they already failed this task. */
  excludeIds?: string[];
  /** When true, metered agents are unroutable (a budget cap is spent). */
  meteredBlocked?: boolean;
  /** Phase used for the curated fallback ranking. */
  phase: PipelinePhase | "brainstorm";
}

type Candidate = {
  agent: Agent;
  cost: AgentCost;
  stat: RoutingStat | null;
  successRate: number | null;
  attempts: number;
  proven: boolean;
  capable: boolean;
  /** Curated quality rank for the phase — lower is better, 99 = unranked. */
  specialistRank: number;
  estimatedCostUsd: number;
};

function clearsBar(
  c: Candidate,
  taskClass: TaskClass,
  minSuccessRate: number,
): boolean {
  if (c.successRate == null) return false;
  const floor = Math.max(
    minSuccessRate,
    STAKES_SUCCESS_FLOOR[TASK_CLASS_STAKES[taskClass]],
  );
  return c.successRate >= floor;
}

function isCapable(agent: Agent, taskClass: TaskClass): boolean {
  const roles = TASK_CLASS_ROLES[taskClass] ?? [];
  if (!roles.length) return true;
  return agent.roles.some((r) => roles.includes(r));
}

function cheapestFirst(a: Candidate, b: Candidate): number {
  if (a.cost.rank !== b.cost.rank) return a.cost.rank - b.cost.rank;
  if (a.estimatedCostUsd !== b.estimatedCostUsd) {
    return a.estimatedCostUsd - b.estimatedCostUsd;
  }
  // Same price: prefer the better-evidenced agent, then the curated specialist.
  const ar = a.successRate ?? -1;
  const br = b.successRate ?? -1;
  if (ar !== br) return br - ar;
  return a.specialistRank - b.specialistRank;
}

/**
 * Pick an agent for a task class under the active policy.
 *
 * `quality-first` reproduces the original behaviour exactly. The cost-aware
 * policies walk candidates cheapest-first and take the first one that has
 * *proven* it can do this class, falling back to the curated specialist when
 * nothing cheap has earned the work yet. Nothing is ever routed to a cheap
 * agent on the strength of a seeded number — only real attempts count.
 */
export function routeForClass(input: RouteForClassInput): RoutingDecision {
  const {
    agents,
    taskClass,
    policy,
    stats,
    usage,
    billing = {},
    minSuccessRate,
    minAttempts,
    exploreUnproven,
    excludeIds = [],
    meteredBlocked = false,
    phase,
  } = input;

  const preferred = PHASE_PREFERRED_AGENT_IDS[phase] ?? [];
  const pool = agents.filter(
    (a) => a.config.enabled && !excludeIds.includes(a.id),
  );

  const candidates: Candidate[] = pool.map((agent) => {
    const cost = agentCost(agent, usage, billing[agent.id]);
    const stat =
      stats.find((s) => s.agentId === agent.id && s.taskClass === taskClass) ??
      null;
    const attempts = stat?.attempts ?? 0;
    const successRate = attempts > 0 ? stat!.successes / attempts : null;
    const perRunTokens =
      attempts > 0 && stat!.totalTokens > 0
        ? stat!.totalTokens / attempts
        : ASSUMED_TOKENS_PER_RUN;
    const specialistIdx = preferred.indexOf(agent.id);
    return {
      agent,
      cost,
      stat,
      successRate,
      attempts,
      proven: attempts >= minAttempts,
      capable: isCapable(agent, taskClass),
      specialistRank: specialistIdx === -1 ? 99 : specialistIdx,
      estimatedCostUsd: estimateCostUsd(cost, perRunTokens),
    };
  });

  const byId = new Map(candidates.map((c) => [c.agent.id, c]));
  const rejected: RoutingDecision["rejected"] = [];

  const routable = candidates.filter((c) => {
    if (meteredBlocked && c.cost.tier === "metered") {
      rejected.push({
        agentId: c.agent.id,
        name: c.agent.name,
        reason: "budget cap spent — metered agents are blocked",
      });
      return false;
    }
    if (c.agent.status === "error") {
      rejected.push({
        agentId: c.agent.id,
        name: c.agent.name,
        reason: "agent is in an error state",
      });
      return false;
    }
    return true;
  });

  // Cost ladder: everything routable, cheapest first. Drives the initial pick.
  const ladder = [...routable].sort(cheapestFirst);

  /**
   * Escalation is a *quality* decision, not a cost one. When the chosen agent
   * fails, the next attempt should be the best remaining agent for the class —
   * not the cheapest.
   *
   * Walking the cost ladder instead put a coder-only local model on an
   * architecture phase after Claude Code timed out: the ladder was unfiltered
   * by capability and ordered cheapest-first, so "escalate" moved *down* in
   * both cost and competence. Only capable agents appear here, best first.
   */
  const escalationPath = [...routable]
    .filter((c) => c.capable)
    .sort((a, b) =>
      a.specialistRank !== b.specialistRank
        ? a.specialistRank - b.specialistRank
        : a.cost.rank - b.cost.rank,
    )
    .map((c) => c.agent.id);

  /**
   * Curated ranking is only ever applied to agents that survived the routable
   * filter. Handing `routeAgent` the raw pool would let the quality ranking
   * re-select a metered agent after a spent budget had excluded it — turning
   * the hard stop into a suggestion.
   */
  const routablePool = routable.map((c) => c.agent);

  const decide = (
    agentId: string | null,
    reason: string,
  ): RoutingDecision => {
    const c = agentId ? byId.get(agentId) : null;
    const report = budgetlessDecision(
      c,
      taskClass,
      policy,
      reason,
      rejected,
      escalationPath,
      meteredBlocked,
    );
    return report;
  };

  if (!routable.length) {
    return decide(
      null,
      meteredBlocked
        ? "No agent available: every candidate is metered and the budget cap is spent."
        : "No enabled agent is available for this class.",
    );
  }

  if (policy === "quality-first") {
    const best = routeAgent(routablePool, phase, excludeIds);
    return decide(
      best?.id ?? ladder[0].agent.id,
      meteredBlocked
        ? "Quality-first, but a spend cap is exhausted — best agent that is still free to run."
        : "Quality-first: curated specialist for this phase, cost not considered.",
    );
  }

  const localFirst = policy === "local-first";

  // 1. Cheapest agent that has *proven* it can do this class.
  for (const c of ladder) {
    if (!c.capable) {
      rejected.push({
        agentId: c.agent.id,
        name: c.agent.name,
        reason: `no role suited to ${taskClass}`,
      });
      continue;
    }
    if (!c.proven) {
      rejected.push({
        agentId: c.agent.id,
        name: c.agent.name,
        reason: `unproven on ${taskClass} (${c.attempts}/${minAttempts} runs)`,
      });
      continue;
    }
    if (!clearsBar(c, taskClass, minSuccessRate)) {
      rejected.push({
        agentId: c.agent.id,
        name: c.agent.name,
        reason: `${Math.round((c.successRate ?? 0) * 100)}% success on ${taskClass} is below the bar`,
      });
      continue;
    }
    return decide(
      c.agent.id,
      `${c.cost.tier === "metered" ? "Cheapest" : "Free"} agent proven on ${taskClass}: ` +
        `${Math.round((c.successRate ?? 0) * 100)}% over ${c.attempts} runs.`,
    );
  }

  // 2. Nothing has proven itself. Optionally let a free agent try a low-stakes
  //    class so the router can ever acquire evidence — exploration is only
  //    allowed where a bad answer is cheap to throw away.
  if (
    exploreUnproven &&
    (TASK_CLASS_STAKES[taskClass] === "low" ||
      (localFirst && LOCAL_FIRST_CLASSES.includes(taskClass)))
  ) {
    const explorer = ladder.find(
      (c) => c.capable && c.cost.tier === "free-local" && c.agent.status !== "offline",
    );
    if (explorer) {
      return decide(
        explorer.agent.id,
        `Exploring: ${explorer.agent.name} is unproven on ${taskClass}, but the class is low-stakes ` +
          `and a local run is free. Escalates on failure.`,
      );
    }
  }

  // 3. Fall back to the curated specialist — with the cheap agents recorded as
  //    rejected so the Orchestration page can show why.
  const best = routeAgent(routablePool, phase, excludeIds);
  const chosen = best && byId.get(best.id) ? best.id : ladder[0].agent.id;
  return decide(
    chosen,
    meteredBlocked
      ? `No cheaper agent has cleared the bar on ${taskClass}, and a spend cap blocks the paid ones — using the best free agent.`
      : `No cheaper agent has cleared the bar on ${taskClass} yet — using the curated specialist.`,
  );
}

function budgetlessDecision(
  c: Candidate | null | undefined,
  taskClass: TaskClass,
  policy: RoutingPolicy,
  reason: string,
  rejected: RoutingDecision["rejected"],
  escalationPath: string[],
  budgetBlocked: boolean,
): RoutingDecision {
  return {
    agentId: c?.agent.id ?? null,
    agentName: c?.agent.name ?? "Unassigned",
    taskClass,
    policy,
    costTier: c?.cost.tier ?? "unknown",
    successRate: c?.successRate ?? null,
    attempts: c?.attempts ?? 0,
    reason,
    rejected,
    escalationPath,
    estimatedCostUsd: c?.estimatedCostUsd ?? 0,
    budgetBlocked,
  };
}

/**
 * Next agent to try after `failedAgentIds` have failed this task — one rung up
 * the escalation ladder, never the agent that just failed.
 */
export function escalateFrom(
  decision: RoutingDecision,
  failedAgentIds: string[],
): string | null {
  for (const id of decision.escalationPath) {
    if (!failedAgentIds.includes(id)) return id;
  }
  return null;
}

export { taskClassForPhase };

/** Select a diverse team for collaborative brainstorming */
export function routeBrainstormTeam(agents: Agent[], count = 3): Agent[] {
  const enabled = agents.filter((a) => a.config.enabled);
  const preferred = PHASE_PREFERRED_AGENT_IDS.brainstorm;
  const byScore = [...enabled].sort((a, b) => {
    const ap = preferred.indexOf(a.id);
    const bp = preferred.indexOf(b.id);
    const aBoost = ap >= 0 ? 100 - ap * 10 : 0;
    const bBoost = bp >= 0 ? 100 - bp * 10 : 0;
    return (
      (b.strengths.brainstorm ?? 0) +
      bBoost -
      ((a.strengths.brainstorm ?? 0) + aBoost)
    );
  });

  const team: Agent[] = [];
  const seenTypes = new Set<string>();

  for (const agent of byScore) {
    if (team.length >= count) break;
    const key = `${agent.type}:${agent.roles[0]}`;
    if (seenTypes.has(key) && team.length < count - 1) {
      if (byScore.indexOf(agent) > count) continue;
    }
    team.push(agent);
    seenTypes.add(key);
  }

  return team.slice(0, count);
}

export function bestAgentLabel(agent: Agent | null): string {
  return agent?.name ?? "Unassigned";
}

/** Human-readable assignment rationale for project messages */
export function phaseAgentRationale(phase: PipelinePhase): string {
  const map: Record<PipelinePhase, string> = {
    research: "Jarvis Research / Hermes — deep research specialists",
    planning: "Grok — strongest planning + critique",
    architecture: "Claude Code — elite system design",
    implementation: "Claude Code / Codex — production code generation",
    testing: "Codex / Claude Code — tests and verification",
    polish: "Claude Code — UX polish and release quality",
  };
  return map[phase];
}
