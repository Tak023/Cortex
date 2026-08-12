import { nanoid } from "nanoid";
import type {
  Agent,
  Concept,
  PipelinePhase,
  Project,
  Task,
} from "../types";
import { phaseAgentRationale, routeAgent } from "../agents/router";

export const PIPELINE_PHASES: PipelinePhase[] = [
  "research",
  "planning",
  "architecture",
  "implementation",
  "testing",
  "polish",
];

const PHASE_META: Record<
  PipelinePhase,
  { title: string; description: string; requiresApproval: boolean; minutes: number }
> = {
  research: {
    title: "Research",
    description: "Map users, constraints, competitors, and success criteria.",
    requiresApproval: false,
    minutes: 8,
  },
  planning: {
    title: "Planning",
    description: "Draft milestones, risks, and the execution plan.",
    requiresApproval: true,
    minutes: 10,
  },
  architecture: {
    title: "Architecture",
    description: "Define modules, data model, APIs, and agent handoffs.",
    requiresApproval: true,
    minutes: 12,
  },
  implementation: {
    title: "Implementation",
    description:
      "Cortex scaffolds a real app and runs install + build smoke (agent label is ownership only).",
    requiresApproval: false,
    minutes: 25,
  },
  testing: {
    title: "Testing",
    description:
      "Cortex runs install → build → Vitest (Playwright when available). Agent label is ownership only.",
    requiresApproval: false,
    minutes: 18,
  },
  polish: {
    title: "Polish",
    description: "UX pass, copy, empty states, and release packaging.",
    requiresApproval: true,
    minutes: 8,
  },
};

export function buildPipelineTasks(
  projectId: string,
  concept: Concept,
  agents: Agent[],
): Task[] {
  const tasks: Task[] = [];
  let prevId: string | null = null;
  // Soft diversity: avoid reusing the same agent twice in a row only
  let prevAgentId: string | null = null;

  for (let i = 0; i < PIPELINE_PHASES.length; i++) {
    const phase = PIPELINE_PHASES[i];
    const meta = PHASE_META[phase];
    // Always pick the best agent for this phase.
    // Implementation/testing/architecture must NOT soft-swap away from the #1 specialist
    // (e.g. Claude Code → Codex) — those stages own the real build/test path and labels
    // must match the intended owner. Soft diversity only for research/planning/polish.
    let agent = routeAgent(agents, phase);
    const allowSoftDiversity =
      phase === "research" || phase === "planning" || phase === "polish";
    if (
      allowSoftDiversity &&
      agent &&
      prevAgentId &&
      agent.id === prevAgentId
    ) {
      const alt = routeAgent(agents, phase, [agent.id]);
      if (
        alt &&
        (alt.strengths[phase] ?? 0) >= (agent.strengths[phase] ?? 0) - 8
      ) {
        agent = alt;
      }
    }
    if (agent) prevAgentId = agent.id;

    const id = `task-${nanoid(8)}`;
    tasks.push({
      id,
      projectId,
      phase,
      title: meta.title,
      description: `${meta.description} Target: ${concept.title} · Specialist: ${phaseAgentRationale(phase)}`,
      status: i === 0 ? "queued" : "pending",
      agentId: agent?.id ?? null,
      dependsOn: prevId ? [prevId] : [],
      artifacts: [],
      progress: 0,
      requiresApproval: meta.requiresApproval,
      outputSummary: null,
      startedAt: null,
      completedAt: null,
      estimatedMinutes: meta.minutes,
      order: i,
      retryCount: 0,
      maxRetries: phase === "implementation" || phase === "testing" ? 3 : 2,
      lastError: null,
    });
    prevId = id;
  }

  return tasks;
}

export function createProjectFromConcept(opts: {
  ideaId: string;
  concept: Concept;
  agents: Agent[];
}): Project {
  const id = `proj-${nanoid(8)}`;
  const now = new Date().toISOString();
  const tasks = buildPipelineTasks(id, opts.concept, opts.agents);

  const assignmentLines = tasks
    .map((t) => {
      const name =
        opts.agents.find((a) => a.id === t.agentId)?.name ?? "Unassigned";
      return `- **${t.title}** → ${name} (${phaseAgentRationale(t.phase)})`;
    })
    .join("\n");

  return {
    id,
    name: opts.concept.title,
    ideaId: opts.ideaId,
    conceptId: opts.concept.id,
    concept: opts.concept,
    status: "running",
    tasks,
    messages: [
      {
        id: `msg-${nanoid(6)}`,
        role: "system",
        content:
          `Project created from concept "${opts.concept.title}".\n\n` +
          `### Agent assignments (best-fit per stage)\n${assignmentLines}`,
        createdAt: now,
      },
    ],
    artifacts: [],
    sharedMemory: {
      concept: JSON.stringify(
        {
          title: opts.concept.title,
          summary: opts.concept.summary,
          features: opts.concept.features,
          stack: opts.concept.stack,
        },
        null,
        2,
      ),
    },
    createdAt: now,
    updatedAt: now,
    paused: false,
    buildStatus: "pending",
    unresolvedErrors: [],
    resolutionGuide: null,
  };
}
