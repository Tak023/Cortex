/**
 * Pluggable agent adapter contract.
 * Future agents (Claude CLI, Codex, Hermes, custom) implement the same surface
 * so orchestration / Ideas / chat can call one API: invokeAgent().
 */
import type { Agent, PipelinePhase } from "../../types";

export type AgentInvokePhase =
  | PipelinePhase
  | "brainstorm"
  | "chat"
  | "research-query"
  | "code"
  | "general";

/** Prior turns for multi-turn chat (roles mirror OpenAI chat messages). */
export type AgentChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export interface AgentInvokeRequest {
  agent: Agent;
  prompt: string;
  systemPrompt?: string;
  phase?: AgentInvokePhase;
  /** OpenJarvis / tool-using agents */
  tools?: string[];
  projectId?: string;
  /** Shared memory or prior phase docs */
  context?: Record<string, string>;
  /**
   * Prior conversation turns (excluding the current user prompt).
   * Used by interactive Jarvis chat / voice mode.
   */
  history?: AgentChatMessage[];
  /**
   * When true, adapters should bias toward concise, speakable replies
   * (no heavy markdown, short sentences).
   */
  voiceMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Adapter-specific overrides (e.g. jarvisAgent: "orchestrator") */
  extras?: Record<string, unknown>;
}

export interface AgentInvokeResult {
  ok: boolean;
  content: string;
  agentId: string;
  backend: string;
  model?: string;
  usage?: {
    tokens?: number;
    latencyMs?: number;
  };
  toolResults?: unknown[];
  raw?: unknown;
  error?: string;
  /** True when we fell back to local synthesis / mock */
  simulated?: boolean;
}

export interface AgentHealth {
  ok: boolean;
  backend: string;
  detail: string;
  models?: string[];
  latencyMs?: number;
  /**
   * The endpoint that actually answered, which may not be the one configured:
   * the chat path tries LM Studio, the configured URL, Ollama and `jarvis
   * serve` in order. Reporting only the configured URL made three different
   * ports appear across the UI with no way to tell which one was live.
   */
  endpoint?: string;
}

export interface AgentAdapter {
  /** Unique adapter id, e.g. "jarvis", "simulation" */
  id: string;
  /** Return true if this adapter handles the given agent */
  supports(agent: Agent): boolean;
  health(agent: Agent): Promise<AgentHealth>;
  invoke(req: AgentInvokeRequest): Promise<AgentInvokeResult>;
}
