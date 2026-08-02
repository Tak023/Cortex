import { nanoid } from "nanoid";
import type {
  Agent,
  Concept,
  PipelinePhase,
  Project,
  Task,
} from "../types";
import { routeAgent } from "../agents/router";

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
    description: "Build core features and wire the primary flows.",
    requiresApproval: false,
    minutes: 25,
  },
  testing: {
    title: "Testing",
    description: "Validate critical paths, edge cases, and regressions.",
    requiresApproval: false,
    minutes: 10,
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
  const used = new Set<string>();

  for (let i = 0; i < PIPELINE_PHASES.length; i++) {
    const phase = PIPELINE_PHASES[i];
    const meta = PHASE_META[phase];
    const agent = routeAgent(agents, phase, [...used]);
    // Allow reuse if needed, but prefer rotation for parallel feel
    if (agent && i > 0 && Math.random() > 0.4) {
      // don't permanently exclude — only soft diversity on first pass
    }
    if (agent) used.add(agent.id);

    const id = `task-${nanoid(8)}`;
    tasks.push({
      id,
      projectId,
      phase,
      title: meta.title,
      description: `${meta.description} Target: ${concept.title}`,
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
        content: `Project created from concept "${opts.concept.title}". Pipeline assigned across ${tasks.filter((t) => t.agentId).length} agents.`,
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
  };
}
