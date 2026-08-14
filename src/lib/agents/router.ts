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
