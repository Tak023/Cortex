import type { Agent, AgentRole, PipelinePhase } from "../types";

const PHASE_PRIMARY_ROLES: Record<PipelinePhase, AgentRole[]> = {
  research: ["researcher", "generalist"],
  planning: ["planner", "architect"],
  architecture: ["architect", "coder"],
  implementation: ["coder", "generalist"],
  testing: ["tester", "coder"],
  polish: ["coder", "critic"],
};

/**
 * Pick the strongest available agent for a pipeline phase.
 * Prefers online/idle over busy; skips disabled and error/offline when alternatives exist.
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

  const scored = candidates.map((agent) => {
    let score = agent.strengths[phase] ?? 40;

    if (phase !== "brainstorm") {
      const roles = PHASE_PRIMARY_ROLES[phase];
      if (agent.roles.some((r) => roles.includes(r))) score += 8;
    }

    if (agent.status === "idle" || agent.status === "online") score += 12;
    else if (agent.status === "busy") score -= 15;
    else if (agent.status === "error" || agent.status === "offline") score -= 40;

    // Slight preference for local when strength is close (local-first)
    if (agent.type === "local") score += 3;

    score += agent.metrics.successRate * 5;
    return { agent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.agent ?? null;
}

/** Select a diverse team for collaborative brainstorming */
export function routeBrainstormTeam(
  agents: Agent[],
  count = 3,
): Agent[] {
  const enabled = agents.filter((a) => a.config.enabled);
  const byScore = [...enabled].sort(
    (a, b) => (b.strengths.brainstorm ?? 0) - (a.strengths.brainstorm ?? 0),
  );

  const team: Agent[] = [];
  const seenTypes = new Set<string>();

  for (const agent of byScore) {
    if (team.length >= count) break;
    // Prefer diversity of type + roles
    const key = `${agent.type}:${agent.roles[0]}`;
    if (seenTypes.has(key) && team.length < count - 1) {
      // still allow if we need fill
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
