/**
 * LM Studio adapter — the six on-device models actually run.
 *
 * Before this, every `agent-lmstudio-*` entry fell through to the simulation
 * adapter: the roster named a model, carried its LM Studio id, and then
 * returned template-synthesized prose. The local-first thesis could not be
 * tested because no local model was ever invoked.
 *
 * Two rules separate this from the Jarvis chat path, and both exist because
 * the router now *learns* from what happens here:
 *
 *  1. **Pinned model.** If the agent's declared model is not loaded in LM
 *     Studio, the call fails. Jarvis chat auto-substitutes another model,
 *     which is right for a chat box and wrong here — crediting Gemma's answer
 *     to Qwen would teach the routing table something false.
 *  2. **Pinned backend.** LM Studio only. No Ollama / `jarvis serve` fallback
 *     chain, for the same reason.
 *
 * A failure is not a dead end: the orchestrator records it against
 * (agent, task class) and escalates to the next rung of the cost ladder.
 */
import type { Agent } from "../../types";
import { getSettings } from "../../store";
import {
  buildChatMessages,
  fetchWithTimeout,
  isGarbageModelContent,
  listBackendModels,
} from "./jarvis";
import { matchPreferredModel } from "./modelMatch";
import type {
  AgentAdapter,
  AgentHealth,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";

const DEFAULT_LM_STUDIO_BASE = "http://127.0.0.1:1234";
const BACKEND = "lmstudio";

/** Registry agents backed by a local LM Studio model. */
export function isLmStudioAgent(agent: Agent): boolean {
  return (
    agent.id.startsWith("agent-lmstudio-") ||
    agent.capabilities.includes("lmstudio")
  );
}

function baseUrl(agent?: Agent): string {
  const extras = agent?.config?.extras ?? {};
  const s = getSettings();
  const url =
    (extras.baseUrl as string) ||
    process.env.LMSTUDIO_BASE_URL ||
    s.jarvisChatBaseUrl ||
    DEFAULT_LM_STUDIO_BASE;
  return url.replace(/\/$/, "");
}

function timeoutMs(): number {
  return getSettings().jarvisTimeoutMs || 120_000;
}

/** The model this agent is declared to be. Never substituted. */
function pinnedModel(agent: Agent): string {
  return (agent.config.modelOverride || agent.model || "").trim();
}

export const lmStudioAdapter: AgentAdapter = {
  id: "lmstudio",

  supports(agent) {
    return isLmStudioAgent(agent);
  },

  async health(agent): Promise<AgentHealth> {
    const root = baseUrl(agent);
    const t0 = Date.now();
    const want = pinnedModel(agent);
    let models: string[] = [];
    try {
      models = await listBackendModels(root, 4000);
    } catch {
      models = [];
    }
    if (!models.length) {
      return {
        ok: false,
        backend: BACKEND,
        endpoint: root,
        detail: `LM Studio is not serving at ${root} — start the local server (Developer → Start Server).`,
        latencyMs: Date.now() - t0,
      };
    }
    const hit = want ? matchPreferredModel(want, models) : models[0];
    if (!hit) {
      return {
        ok: false,
        backend: BACKEND,
        endpoint: root,
        models,
        detail: `LM Studio is up but "${want}" is not loaded. Loaded: ${models.slice(0, 5).join(", ")}`,
        latencyMs: Date.now() - t0,
      };
    }
    return {
      ok: true,
      backend: BACKEND,
      endpoint: root,
      models,
      detail: `LM Studio serving ${hit} at ${root}`,
      latencyMs: Date.now() - t0,
    };
  },

  async invoke(req: AgentInvokeRequest): Promise<AgentInvokeResult> {
    const t0 = Date.now();
    const root = baseUrl(req.agent);
    const want = pinnedModel(req.agent);
    const budget = timeoutMs();

    if (!want) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        error: `${req.agent.name} has no model id configured — set one in Settings.`,
      };
    }

    const available = await listBackendModels(root, Math.min(budget, 5000));
    if (!available.length) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        error: `LM Studio is not reachable at ${root}. Start the local server, or this agent will keep escalating to a paid one.`,
      };
    }

    // Pinned: match the declared model or fail. No silent substitution.
    const model = matchPreferredModel(want, available);
    if (!model) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        error:
          `Model "${want}" is not loaded in LM Studio, so ${req.agent.name} cannot run. ` +
          `Loaded: ${available.slice(0, 6).join(", ")}`,
      };
    }

    const isChat = req.voiceMode || req.phase === "chat";
    const body = {
      model,
      messages: buildChatMessages(req),
      temperature: req.temperature ?? (isChat ? 0.35 : 0.7),
      max_tokens: req.maxTokens ?? (req.voiceMode ? 320 : isChat ? 700 : 2048),
      stream: false,
    };

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${root}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer not-needed",
          },
          body: JSON.stringify(body),
        },
        budget,
      );
    } catch (e) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        model,
        error: `LM Studio request failed: ${e instanceof Error ? e.message : String(e)}`,
        usage: { latencyMs: Date.now() - t0 },
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        model,
        error: `LM Studio HTTP ${res.status} (model=${model}): ${text.slice(0, 200) || res.statusText}`,
        usage: { latencyMs: Date.now() - t0 },
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      model?: string;
      usage?: { total_tokens?: number };
    };
    const content = (data.choices?.[0]?.message?.content ?? "").trim();

    if (!content || isGarbageModelContent(content)) {
      // A refusal or tool-call loop is a real failure for this agent on this
      // class — reporting it as success would corrupt the routing evidence.
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: BACKEND,
        model: data.model || model,
        error: content
          ? `${req.agent.name} returned unusable output: ${content.slice(0, 120)}`
          : `${req.agent.name} returned an empty response.`,
        usage: {
          tokens: data.usage?.total_tokens,
          latencyMs: Date.now() - t0,
        },
      };
    }

    return {
      ok: true,
      content,
      agentId: req.agent.id,
      backend: BACKEND,
      model: data.model || model,
      usage: {
        tokens: data.usage?.total_tokens,
        latencyMs: Date.now() - t0,
      },
      raw: data,
    };
  },
};
