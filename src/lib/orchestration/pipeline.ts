import { nanoid } from "nanoid";
import type {
  Agent,
  Concept,
  PipelinePhase,
  Project,
  Task,
} from "../types";
import { phaseAgentRationale, routeAgent } from "../agents/router";
import { routeTask } from "./routing";

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
      "Cortex scaffolds the app skeleton, then a coding agent implements the concept's " +
      "features into it with write access confined to the project workspace, verifying and " +
      "repairing until the build passes. Falls back to the scaffold alone — and says so — " +
      "when no write-capable agent is available or the approval policy forbids it.",
    requiresApproval: false,
    minutes: 25,
  },
  testing: {
    title: "Testing (scaffold smoke)",
    description:
      "Cortex runs install → build → Vitest (Playwright when available) against the scaffold. " +
      "These are smoke tests for the generated starter, not coverage of the concept's features.",
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

    // The routing policy decides the initial owner. Under quality-first this
    // is exactly the old curated pick; under the cost-aware policies it is the
    // cheapest agent that has proven itself on this task class.
    const decision = routeTask({ phase, projectId, agents });
    let agent = agents.find((a) => a.id === decision.agentId) ?? null;
    let routingReason = decision.reason;

    // Soft diversity is a quality-first nicety — under a cost-aware policy the
    // cheapest proven agent should win every phase it qualifies for, and
    // shuffling to a pricier one to "vary" the roster defeats the point.
    const allowSoftDiversity =
      decision.policy === "quality-first" &&
      (phase === "research" || phase === "planning" || phase === "polish");
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
        routingReason = `${decision.reason} Soft-diversified off ${prevAgentId}.`;
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
      failedAgentIds: [],
      routingReason,
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
