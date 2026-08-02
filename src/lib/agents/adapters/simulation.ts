/**
 * Default adapter when no live integration is available.
 * Keeps the pipeline moving with synthesized phase docs.
 */
import { synthesizePhaseOutput } from "../../ai/client";
import type { PipelinePhase } from "../../types";
import type {
  AgentAdapter,
  AgentHealth,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";

const PHASES = new Set<string>([
  "research",
  "planning",
  "architecture",
  "implementation",
  "testing",
  "polish",
]);

export const simulationAdapter: AgentAdapter = {
  id: "simulation",

  supports() {
    // Fallback — registry uses this when no other adapter matches
    return true;
  },

  async health() {
    return {
      ok: true,
      backend: "simulation",
      detail: "Local simulation adapter (no external runtime)",
    };
  },

  async invoke(req: AgentInvokeRequest): Promise<AgentInvokeResult> {
    const t0 = Date.now();
    const phase = req.phase && PHASES.has(req.phase)
      ? (req.phase as PipelinePhase)
      : "research";
    const projectName =
      (req.extras?.projectName as string) || "Cortex project";
    const concept =
      (req.extras?.conceptSummary as string) ||
      req.prompt.slice(0, 500);
    const memory = req.context ?? {};

    const output = synthesizePhaseOutput(
      phase,
      projectName,
      concept,
      memory,
    );

    return {
      ok: true,
      content: output.content,
      agentId: req.agent.id,
      backend: "simulation",
      usage: { latencyMs: Date.now() - t0, tokens: 1200 },
      simulated: true,
      raw: output,
    };
  },
};
