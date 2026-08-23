/**
 * Adapter registry — single entry point for all agent runtimes.
 * Future features should call `invokeAgent` / `getAdapterFor` rather than
 * hard-coding OpenJarvis, Grok, etc.
 */
import type { Agent } from "../../types";
import { getAgents } from "../../store";
import { jarvisAdapter, isJarvisAgent } from "./jarvis";
import { lmStudioAdapter, isLmStudioAgent } from "./lmstudio";
import { cliAgentAdapter, isCliAgent } from "./cliAgent";
import { simulationAdapter } from "./simulation";
import type {
  AgentAdapter,
  AgentHealth,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";

export type {
  AgentAdapter,
  AgentChatMessage,
  AgentHealth,
  AgentInvokePhase,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";
export { isJarvisAgent, JARVIS_AGENT_IDS } from "./jarvis";
export { isLmStudioAgent } from "./lmstudio";
export { isCliAgent } from "./cliAgent";

/** Ordered adapters (first match wins). Add new integrations here. */
const ADAPTERS: AgentAdapter[] = [
  jarvisAdapter,
  lmStudioAdapter,
  cliAgentAdapter,
  // Future: hermesAdapter, antigravityAdapter
  simulationAdapter,
];

/** True when this agent has a real runtime rather than the simulator. */
export function hasLiveAdapter(agent: Agent): boolean {
  return isJarvisAgent(agent) || isLmStudioAgent(agent) || isCliAgent(agent);
}

export function listAdapters(): AgentAdapter[] {
  return [...ADAPTERS];
}

export function getAdapterFor(agent: Agent): AgentAdapter {
  for (const a of ADAPTERS) {
    if (a.id === "simulation") continue;
    if (a.supports(agent)) return a;
  }
  return simulationAdapter;
}

export function getAdapterById(id: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/**
 * Invoke any registered agent through its adapter.
 * This is the primary API for pipeline, Ideas, chat, and future features.
 */
export async function invokeAgent(
  req: Omit<AgentInvokeRequest, "agent"> & { agentId: string },
): Promise<AgentInvokeResult> {
  const agent = getAgents().find((a) => a.id === req.agentId);
  if (!agent) {
    return {
      ok: false,
      content: "",
      agentId: req.agentId,
      backend: "none",
      error: `Unknown agent: ${req.agentId}`,
    };
  }
  if (!agent.config.enabled) {
    return {
      ok: false,
      content: "",
      agentId: agent.id,
      backend: "none",
      error: `Agent ${agent.name} is disabled`,
    };
  }

  const adapter = getAdapterFor(agent);
  return adapter.invoke({ ...req, agent });
}

export async function checkAgentHealth(agentId: string): Promise<AgentHealth> {
  const agent = getAgents().find((a) => a.id === agentId);
  if (!agent) {
    return {
      ok: false,
      backend: "none",
      detail: `Unknown agent: ${agentId}`,
    };
  }
  return getAdapterFor(agent).health(agent);
}

/** Probe all non-simulation adapters for dashboard status. */
export async function probeLiveIntegrations(): Promise<
  Array<{ adapterId: string; agentId: string; health: AgentHealth }>
> {
  const results: Array<{
    adapterId: string;
    agentId: string;
    health: AgentHealth;
  }> = [];
  for (const agent of getAgents()) {
    if (!isJarvisAgent(agent)) continue;
    const adapter = getAdapterFor(agent);
    if (adapter.id === "simulation") continue;
    const health = await adapter.health(agent);
    results.push({ adapterId: adapter.id, agentId: agent.id, health });
  }
  return results;
}
