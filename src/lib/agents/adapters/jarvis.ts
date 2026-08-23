/**
 * OpenJarvis adapter — https://github.com/open-jarvis/OpenJarvis
 *
 * Connection order:
 * 1) OpenAI-compatible HTTP API (`jarvis serve`, default http://127.0.0.1:8000)
 * 2) CLI fallback: `jarvis ask --json ...`
 *
 * Settings live on AppSettings.jarvis*; agent config.extras may override.
 *
 * Electron/macOS GUI apps often ship a minimal PATH (no ~/.local/bin), so we
 * resolve the jarvis binary against common install locations before spawn.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Agent, AppSettings } from "../../types";
import { getSettings, mergeMcpStates } from "../../store";
import { mcpToolsPromptSummary } from "../../mcp/export";
import {
  chatWithGrok,
  isAiConfigured,
  getGrokChatModel,
} from "../../ai/client";
import {
  fetchLiveContext,
  formatClockContext,
  needsLiveData,
} from "../../search/realtime";
import { searchVault } from "../../vault/vault";
import { matchPreferredModel } from "./modelMatch";
import type {
  AgentAdapter,
  AgentHealth,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";

export const JARVIS_AGENT_IDS = new Set([
  "agent-jarvis",
  "agent-jarvis-research",
  "agent-jarvis-code",
]);

export function isJarvisAgent(agent: Agent): boolean {
  return (
    JARVIS_AGENT_IDS.has(agent.id) ||
    agent.slug.startsWith("jarvis") ||
    agent.capabilities.includes("openjarvis")
  );
}

/** PATH that includes common install dirs (Electron GUI apps strip these). */
function enrichedPath(): string {
  const home = os.homedir();
  const extras = [
    path.join(home, ".local", "bin"),
    path.join(home, ".openjarvis", ".venv", "bin"),
    path.join(home, ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const parts = [
    ...(process.env.PATH ? process.env.PATH.split(":") : []),
    ...extras,
  ];
  const seen = new Set<string>();
  return parts
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join(":");
}

function jarvisSpawnEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: enrichedPath() };
}

/**
 * Resolve a jarvis CLI path for spawn.
 * Accepts absolute paths as-is when they exist; otherwise probes well-known
 * install locations then `which` against an enriched PATH.
 */
function resolveJarvisCli(configured: string): string | null {
  const home = os.homedir();
  const candidates: string[] = [];

  if (configured && configured !== "jarvis") {
    if (path.isAbsolute(configured)) candidates.push(configured);
    else candidates.push(configured);
  }

  candidates.push(
    path.join(home, ".local", "bin", "jarvis"),
    path.join(home, ".openjarvis", ".venv", "bin", "jarvis"),
    "/opt/homebrew/bin/jarvis",
    "/usr/local/bin/jarvis",
    "jarvis",
  );

  // Prefer existing absolute files / resolvable relative names
  for (const c of candidates) {
    if (!c) continue;
    if (path.isAbsolute(c) || c.includes(path.sep)) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        /* continue */
      }
    }
  }

  return null;
}

function jarvisConfig(agent?: Agent) {
  const s = getSettings();
  const extras = agent?.config?.extras ?? {};
  const configured =
    (extras.cliPath as string) ||
    s.jarvisCliPath ||
    process.env.JARVIS_CLI ||
    "jarvis";
  const resolved = resolveJarvisCli(configured);
  return {
    baseUrl: (
      (extras.baseUrl as string) ||
      s.jarvisBaseUrl ||
      process.env.JARVIS_BASE_URL ||
      "http://127.0.0.1:8000"
    ).replace(/\/$/, ""),
    agentName:
      (extras.jarvisAgent as string) ||
      s.jarvisDefaultAgent ||
      "orchestrator",
    /** User-configured value (may be bare "jarvis") */
    cliPath: configured,
    /** Absolute path when found; null if missing */
    resolvedCliPath: resolved,
    preferCli: Boolean(s.jarvisPreferCli),
    enabled: s.jarvisEnabled !== false,
    timeoutMs: s.jarvisTimeoutMs || 120_000,
  };
}

/** Hermes 3 Llama 3.1 8B Abliterated (LM Studio / gulan28 GGUF) */
const DEFAULT_LMSTUDIO_MODEL =
  "gulan28/Hermes-3-Llama-3.1-8B-abliterated-GGUF";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";
const LM_STUDIO_BASE = "http://127.0.0.1:1234";

/**
 * User/agent preferred model id, or undefined when fully auto.
 * Does not validate against a backend — use resolveModelForBackend for that.
 */
function preferredChatModel(agentModel?: string): string | undefined {
  const s = getSettings() as { jarvisChatModel?: string };
  const m = (agentModel || "").trim();
  const fromAgent =
    !m || m === "jarvis-auto" || m === "auto" || m === "default"
      ? ""
      : m;
  const fromSettings = (
    process.env.JARVIS_MODEL ||
    process.env.JARVIS_CHAT_MODEL ||
    s.jarvisChatModel ||
    ""
  ).trim();
  const pick = fromAgent || fromSettings;
  if (!pick || pick === "auto" || pick === "jarvis-auto" || pick === "default") {
    return undefined;
  }
  return pick;
}

/** @deprecated Prefer resolveModelForBackend — kept for non-chat jarvis serve paths */
function resolveJarvisModel(agentModel?: string): string {
  return (
    preferredChatModel(agentModel) ||
    DEFAULT_LMSTUDIO_MODEL
  );
}

/** @internal shared with the LM Studio adapter */
export async function listBackendModels(
  baseUrl: string,
  timeoutMs: number,
): Promise<string[]> {
  const root = baseUrl.replace(/\/$/, "");
  const probeMs = Math.min(Math.max(timeoutMs, 500), 4000);

  try {
    const res = await fetchWithTimeout(
      `${root}/v1/models`,
      { method: "GET" },
      probeMs,
    );
    if (res.ok) {
      const body = (await res.json()) as {
        data?: Array<{ id?: string }>;
      };
      const ids = (body.data ?? [])
        .map((d) => d.id)
        .filter((x): x is string => Boolean(x && x.trim()));
      if (ids.length) return ids;
    }
  } catch {
    /* try Ollama native API */
  }

  // Ollama native tags (when OpenAI layer is missing or empty)
  try {
    const res = await fetchWithTimeout(
      `${root}/api/tags`,
      { method: "GET" },
      probeMs,
    );
    if (res.ok) {
      const body = (await res.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      return (body.models ?? [])
        .map((m) => m.name || m.model)
        .filter((x): x is string => Boolean(x && x.trim()));
    }
  } catch {
    /* empty */
  }

  return [];
}

/**
 * Rank available models for interactive chat. Deprioritize image/embed models.
 */
function pickBestChatModel(
  available: string[],
  backend: string,
): string | undefined {
  if (!available.length) return undefined;

  const scored = available.map((id) => {
    const lower = id.toLowerCase();
    let score = 0;
    if (
      /stable-diffusion|sdxl|image|embed|whisper|tts|nomic-embed|bge-|clip|prompt-generator/i.test(
        lower,
      )
    ) {
      score -= 100;
    }
    if (
      /llama3\.2|llama3\.1|llama3|phi-?3|phi-?4|qwen|mistral|gemma|hermes|command-r|deepseek|gpt-oss|codellama|codegeex/i.test(
        lower,
      )
    ) {
      score += 40;
    }
    if (/70b|72b|65b/i.test(lower)) score += 25;
    else if (/30b|32b|34b|27b/i.test(lower)) score += 18;
    else if (/13b|14b|12b|medium/i.test(lower)) score += 12;
    else if (/7b|8b|9b/i.test(lower)) score += 6;
    else if (/3b|3\.2b|1b|mini|tiny/i.test(lower)) score += 2;
    if (lower.includes("latest")) score += 2;
    if (backend === "ollama" && /llama3\.2/.test(lower)) score += 35;
    // Prefer Hermes 3 8B Abliterated on LM Studio
    if (backend === "lmstudio") {
      if (/hermes.*3\.1.*8b.*abliter/i.test(lower) || /abliterated.*8b/i.test(lower))
        score += 80;
      else if (/hermes.*8b/i.test(lower)) score += 50;
      else if (/hermes/.test(lower)) score += 35;
    }
    // General chat over pure code models for voice/chat
    if (/code|coder|codellama|codegeex|starcoder/i.test(lower)) score -= 8;
    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored[0]?.id;
}


/**
 * Resolve a model id that the target backend actually serves.
 * Preferred settings/agent model wins when present; otherwise auto-pick.
 */
async function resolveModelForBackend(
  baseUrl: string,
  agentModel: string | undefined,
  timeoutMs: number,
): Promise<{ model: string; available: string[]; auto: boolean }> {
  const backend = labelHttpBackend(baseUrl);
  const preferred = preferredChatModel(agentModel);
  const available = await listBackendModels(baseUrl, timeoutMs);

  if (preferred) {
    const hit = matchPreferredModel(preferred, available);
    if (hit) return { model: hit, available, auto: false };
    // Preferred not installed on this backend — fall through to auto
  }

  const best = pickBestChatModel(available, backend);
  if (best) return { model: best, available, auto: true };

  // Backend did not list models — send preferred or a backend-typical default
  if (preferred) return { model: preferred, available, auto: false };
  return {
    model:
      backend === "ollama" ? DEFAULT_OLLAMA_MODEL : DEFAULT_LMSTUDIO_MODEL,
    available,
    auto: true,
  };
}

function mapPhaseToJarvisAgent(
  phase: AgentInvokeRequest["phase"],
  fallback: string,
): string {
  switch (phase) {
    case "research":
    case "research-query":
      return "deep_research";
    case "implementation":
    case "code":
      return "orchestrator";
    case "brainstorm":
    case "chat":
      return "simple";
    default:
      return fallback;
  }
}

function toolsForPhase(phase: AgentInvokeRequest["phase"]): string[] | undefined {
  switch (phase) {
    case "research":
    case "research-query":
      return ["web_search", "retrieval", "think"];
    case "implementation":
    case "code":
      return ["file_read", "think", "calculator"];
    case "planning":
    case "architecture":
      return ["think", "retrieval"];
    default:
      return undefined;
  }
}

/** @internal shared with the LM Studio adapter */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function labelHttpBackend(baseUrl: string): string {
  const u = baseUrl.toLowerCase();
  if (u.includes(":1234") || u.includes("lmstudio")) return "lmstudio";
  if (u.includes(":11434") || u.includes("ollama")) return "ollama";
  if (u.includes(":8000") || u.includes("jarvis")) return "jarvis-http";
  return "openai-compat";
}

/**
 * Probe an OpenAI-compatible HTTP endpoint (LM Studio, Ollama, jarvis serve).
 * Prefer /v1/models (universal); fall back to /health for OpenJarvis.
 * Uses a short connect window so hung listeners do not block the whole check.
 */
/** @internal shared with the LM Studio adapter */
export async function healthHttp(
  baseUrl: string,
  timeoutMs: number,
): Promise<AgentHealth> {
  const t0 = Date.now();
  const probeMs = Math.min(Math.max(timeoutMs, 500), 3500);
  const backend = labelHttpBackend(baseUrl);

  // 1) /v1/models — works for LM Studio, Ollama, OpenJarvis OpenAI layer
  try {
    const modelsRes = await fetchWithTimeout(
      `${baseUrl}/v1/models`,
      { method: "GET" },
      probeMs,
    );
    if (modelsRes.ok) {
      let models: string[] | undefined;
      try {
        const body = (await modelsRes.json()) as {
          data?: Array<{ id?: string }>;
        };
        models = (body.data ?? [])
          .map((d) => d.id)
          .filter((x): x is string => Boolean(x));
      } catch {
        /* optional */
      }
      return {
        ok: true,
        backend,
        detail: `Chat API reachable at ${baseUrl}`,
        endpoint: baseUrl,
        models,
        latencyMs: Date.now() - t0,
      };
    }
  } catch {
    /* try /health next */
  }

  // 2) /health — OpenJarvis serve
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/health`,
      { method: "GET" },
      probeMs,
    );
    if (res.ok) {
      return {
        ok: true,
        backend,
        detail: `Health OK at ${baseUrl}`,
        endpoint: baseUrl,
        latencyMs: Date.now() - t0,
      };
    }
    return {
      ok: false,
      backend,
      detail: `HTTP ${res.status} from ${baseUrl}`,
      endpoint: baseUrl,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      backend,
      detail:
        e instanceof Error ? e.message : `Cannot reach ${baseUrl}`,
      latencyMs: Date.now() - t0,
    };
  }
}

function whichCli(cliPath: string): Promise<string | null> {
  // Fast path: absolute / known install locations (works under Electron PATH)
  const direct = resolveJarvisCli(cliPath);
  if (direct) return Promise.resolve(direct);

  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = spawn(cmd, [cliPath || "jarvis"], {
      env: jarvisSpawnEnv(),
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code === 0 && out.trim()) resolve(out.trim().split("\n")[0]!);
      else resolve(null);
    });
  });
}

async function healthCli(cliPath: string): Promise<AgentHealth> {
  const t0 = Date.now();
  const resolved = await whichCli(cliPath);
  if (!resolved) {
    return {
      ok: false,
      backend: "jarvis-cli",
      detail: `CLI not found (${cliPath}). Install OpenJarvis or set jarvisCliPath to ~/.local/bin/jarvis.`,
      latencyMs: Date.now() - t0,
    };
  }
  return {
    ok: true,
    backend: "jarvis-cli",
    detail: `CLI available: ${resolved}`,
    latencyMs: Date.now() - t0,
  };
}

const CHAT_SYSTEM = `You are Jarvis, a personal AI assistant inside Cortex (hybrid: local LM Studio + cloud Grok for live facts).

Core rules:
- Answer the user's latest message accurately and directly.
- Stay on topic. Do not invent tools, tool calls, APIs, or function names.
- Never output JSON for tools (no {"name":...} payloads). Speak in plain language only.
- Prefer Live web results and the current date/time block over training memory for anything that changes (news, prices, weather, scores, "today").
- When the user message includes a LIVE DATA section, treat it as verified realtime ground truth (especially Open-Meteo weather readings). Never say you lack access if that section is present.
- If live results are missing and you are unsure, say you cannot verify live data — do not invent current events.
- Keep replies concise: a few sentences unless the user asks for depth.
- Use conversation history only as context; prioritize the latest user message.`;

const VOICE_CHAT_SYSTEM = `${CHAT_SYSTEM}

You are in a live spoken conversation:
- Prefer natural spoken English and short sentences.
- No markdown, bullet lists, code fences, or long URLs unless the user asks for them.
- Sound warm and capable, like a helpful aide.`;

type EnrichedChat = {
  req: AgentInvokeRequest;
  /** True when the user question likely needs current facts */
  wantsLive: boolean;
  /** True when search returned at least one hit */
  hasLiveHits: boolean;
  /** True when the second brain (Obsidian vault) had relevant notes */
  hasVaultHits: boolean;
  liveProvider?: string;
};

function resolveChatMode(): AppSettings["jarvisChatMode"] {
  const fromEnv = process.env.JARVIS_CHAT_MODE?.trim().toLowerCase();
  if (fromEnv === "local" || fromEnv === "lmstudio" || fromEnv === "ollama") {
    return "local";
  }
  if (fromEnv === "grok" || fromEnv === "cloud" || fromEnv === "xai") {
    return "grok";
  }
  if (fromEnv === "hybrid") return "hybrid";
  const s = getSettings() as { jarvisChatMode?: string };
  const m = (s.jarvisChatMode || "hybrid").toLowerCase();
  if (m === "local" || m === "grok") return m;
  return "hybrid";
}

/** Enrich chat requests with clock + optional live web search. */
async function enrichChatRequest(
  req: AgentInvokeRequest,
): Promise<EnrichedChat> {
  const isChat = req.voiceMode || req.phase === "chat";
  if (!isChat) {
    return { req, wantsLive: false, hasLiveHits: false, hasVaultHits: false };
  }

  const context: Record<string, string> = { ...(req.context ?? {}) };
  context["Current time"] = formatClockContext();
  const wantsLive = needsLiveData(req.prompt);
  let hasLiveHits = false;
  let liveProvider: string | undefined;
  let prompt = req.prompt;

  // Second brain: local Obsidian vault notes (fast, offline, best-effort)
  let vaultBlock: string | null = null;
  try {
    const vault = searchVault(req.prompt, { limit: 4 });
    if (vault?.hits.length) {
      vaultBlock = vault.block;
      context["Second brain notes"] = vault.block;
    }
  } catch {
    /* vault is best-effort */
  }

  try {
    const live = await fetchLiveContext(req.prompt, { force: wantsLive });
    if (live?.block) {
      context["Live web results"] = live.block;
      hasLiveHits = live.hits.length > 0;
      liveProvider = live.provider;
      // Local models often ignore system context — pin live facts on the user turn.
      if (hasLiveHits) {
        prompt =
          `${req.prompt}\n\n` +
          `---\nLIVE DATA (authoritative for this answer — do not claim you lack realtime access):\n` +
          `${live.block.slice(0, 3500)}\n---\n` +
          `Answer the user using the LIVE DATA above. State numbers/conditions clearly.`;
      }
    } else if (wantsLive) {
      context["Live web results"] =
        "Live search was attempted but returned nothing useful. " +
        "Do not invent current headlines, weather, or prices.";
    }
  } catch {
    /* search is best-effort */
  }

  // Pin vault notes on the user turn too — local models often skim context.
  if (vaultBlock) {
    prompt =
      `${prompt}\n\n` +
      `---\nSECOND BRAIN (the user's local Obsidian notes — authoritative for their personal, project, and knowledge-base context):\n` +
      `${vaultBlock.slice(0, 2500)}\n---\n` +
      `When the question concerns the user, their projects, or their notes, answer from SECOND BRAIN and mention the note it came from.`;
  }

  return {
    req: { ...req, context, prompt },
    wantsLive,
    hasLiveHits,
    hasVaultHits: Boolean(vaultBlock),
    liveProvider,
  };
}

/**
 * Prefer Grok for live questions (hybrid) or always (grok mode).
 *
 * Speed: when we already injected live hits (Open-Meteo / search), prefer the
 * local model first — Grok round-trips often fail then fall back, doubling
 * latency. Use Grok when we want live data but search came back empty.
 */
function shouldPreferGrok(
  mode: AppSettings["jarvisChatMode"],
  wantsLive: boolean,
  hasLiveHits: boolean,
): boolean {
  if (!isAiConfigured()) return false;
  if (mode === "grok") return true;
  if (mode === "local") return false;
  // hybrid + already grounded → local is faster and sufficient
  if (hasLiveHits) return false;
  // hybrid + needs live but no hits → try Grok's knowledge
  return wantsLive;
}

async function invokeGrokChat(
  req: AgentInvokeRequest,
): Promise<AgentInvokeResult> {
  const t0 = Date.now();
  const messages = buildChatMessages(req).map((m) => ({
    role:
      m.role === "assistant"
        ? ("assistant" as const)
        : m.role === "system"
          ? ("system" as const)
          : ("user" as const),
    content: m.content,
  }));
  const isChat = req.voiceMode || req.phase === "chat";
  const result = await chatWithGrok({
    messages,
    temperature: req.temperature ?? (isChat ? 0.35 : 0.7),
    // Keep chat answers shorter → lower latency on Grok
    maxTokens: req.maxTokens ?? (req.voiceMode ? 320 : isChat ? 700 : 2048),
  });
  if (isGarbageModelContent(result.content)) {
    throw new Error(
      `Grok returned tool-call noise instead of an answer: ${result.content.slice(0, 120)}`,
    );
  }
  return {
    ok: true,
    content: result.content,
    agentId: req.agent.id,
    backend: "grok",
    model: result.model || getGrokChatModel(),
    usage: {
      tokens: result.tokens,
      latencyMs: result.latencyMs || Date.now() - t0,
    },
    raw: result.raw,
  };
}

function buildSystemPrompt(req: AgentInvokeRequest): string {
  const parts: string[] = [];
  const isChat = req.voiceMode || req.phase === "chat";

  if (req.voiceMode) {
    parts.push(VOICE_CHAT_SYSTEM);
    if (req.systemPrompt) parts.push(req.systemPrompt);
  } else if (isChat) {
    parts.push(CHAT_SYSTEM);
    if (req.systemPrompt) parts.push(req.systemPrompt);
    else if (req.agent.config.systemPrompt)
      parts.push(req.agent.config.systemPrompt);
  } else if (req.systemPrompt) {
    parts.push(req.systemPrompt);
  } else if (req.agent.config.systemPrompt) {
    parts.push(req.agent.config.systemPrompt);
  }

  if (req.phase && req.phase !== "chat" && !req.voiceMode) {
    parts.push(
      `You are contributing to the Cortex pipeline phase: ${req.phase}. ` +
        `Produce concrete, actionable output suitable for a multi-agent product build.`,
    );
  }

  if (req.context && Object.keys(req.context).length > 0) {
    const ctx = Object.entries(req.context)
      .map(([k, v]) => `### ${k}\n${v.slice(0, 5000)}`)
      .join("\n\n");
    // Chat: label clearly so the model treats live results as ground truth
    parts.push(
      isChat
        ? `Realtime context for this turn:\n${ctx}`
        : `Prior project context:\n${ctx}`,
    );
  }

  // MCP tool catalog — skip for chat/voice so the model stays on-topic
  if (!isChat) {
    try {
      const summary = mcpToolsPromptSummary(
        mergeMcpStates(getSettings().mcpServers),
      );
      if (summary) parts.push(summary);
    } catch {
      /* optional */
    }
  }

  return parts.join("\n\n");
}

/** Reject OpenJarvis/orchestrator tool-call garbage that looks like answers. */
/** @internal shared with the LM Studio adapter */
export function isGarbageModelContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (/^\s*\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}\s*$/.test(t)) return true;
  if (/^\s*\{\s*"name"\s*:/.test(t)) return true;
  if (/Using Tavily for web search/i.test(t)) return true;
  if (
    /tavily_search|firecrawl/i.test(t) &&
    /\{[\s\S]*"name"\s*:/.test(t)
  ) {
    return true;
  }
  if (/tool[_ ]?call/i.test(t) && t.length < 400) return true;
  if (/I made a mistake.*(tool|parameter|function)/i.test(t)) return true;
  if (/Action:\s*\w+/i.test(t) && /Observation:/i.test(t)) return true;
  if (
    /\*\*Actionable Steps:\*\*|Use \*\*Tavily\*\*|Utiliz(e|ing) \*\*Firecrawl\*\*/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\[insert president's name\]/i.test(t)) return true;
  if ((t.match(/overposting/gi) || []).length >= 3) return true;
  // UI / transport errors that must not poison multi-turn context
  if (
    /^(Chat failed|I couldn't reach|No chat backend|Could not reach|Request failed|Transcription failed|No speech detected)/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** @internal shared with the LM Studio adapter */
export function buildChatMessages(
  req: AgentInvokeRequest,
): Array<{ role: string; content: string }> {
  const system = buildSystemPrompt(req);
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });

  if (req.history?.length) {
    for (const m of req.history.slice(-12)) {
      if (!m?.content?.trim()) continue;
      if (m.role === "system") continue;
      // Drop prior garbage so it cannot poison the next turn
      if (m.role === "assistant" && isGarbageModelContent(m.content)) continue;
      if (m.role === "user" && isGarbageModelContent(m.content)) continue;
      messages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content.slice(0, 4000),
      });
    }
  }
  messages.push({ role: "user", content: req.prompt });
  return messages;
}

/**
 * Direct OpenAI-compatible chat (Ollama / LM Studio).
 * OpenJarvis `jarvis serve` routes through an orchestrator agent that ignores
 * multi-turn fidelity and invents tool calls — bad for interactive chat.
 */
async function invokeDirectChat(
  req: AgentInvokeRequest,
  baseUrl: string,
  timeoutMs: number,
): Promise<AgentInvokeResult> {
  const t0 = Date.now();
  const root = baseUrl.replace(/\/$/, "");
  const backend = labelHttpBackend(root);
  const resolved = await resolveModelForBackend(
    root,
    req.agent.model,
    timeoutMs,
  );
  const model = resolved.model;
  const messages = buildChatMessages(req);
  const isChat = req.voiceMode || req.phase === "chat";

  const buildBody = (modelId: string): Record<string, unknown> => ({
    model: modelId,
    messages,
    temperature: req.temperature ?? (isChat ? 0.35 : 0.7),
    max_tokens: req.maxTokens ?? (req.voiceMode ? 320 : isChat ? 700 : 2048),
    stream: false,
  });

  let usedModel = model;
  // Cap chat completion wait so a hung backend fails over faster
  const chatTimeout = isChat
    ? Math.min(timeoutMs, 45_000)
    : timeoutMs;
  let res = await fetchWithTimeout(
    `${root}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-needed",
      },
      body: JSON.stringify(buildBody(usedModel)),
    },
    chatTimeout,
  );

  // If preferred model is missing, auto-pick and retry once
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    const text = await res.text().catch(() => "");
    const notFound =
      /not found|model.*unknown|does not exist|invalid model/i.test(text);
    if (notFound) {
      let available = resolved.available;
      if (!available.length) {
        available = await listBackendModels(root, timeoutMs);
      }
      const fallback = pickBestChatModel(available, backend);
      if (fallback && fallback !== usedModel) {
        usedModel = fallback;
        res = await fetchWithTimeout(
          `${root}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer not-needed",
            },
            body: JSON.stringify(buildBody(usedModel)),
          },
          timeoutMs,
        );
      } else if (!res.ok) {
        const avail =
          available.length > 0
            ? ` Available models: ${available.slice(0, 8).join(", ")}`
            : "";
        throw new Error(
          `Chat backend HTTP ${res.status} at ${root} (model=${model}): ${text.slice(0, 200) || res.statusText}.${avail}`,
        );
      }
    } else {
      const avail =
        resolved.available.length > 0
          ? ` Available models: ${resolved.available.slice(0, 8).join(", ")}`
          : "";
      throw new Error(
        `Chat backend HTTP ${res.status} at ${root} (model=${model}): ${text.slice(0, 200) || res.statusText}.${avail}`,
      );
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const avail =
      resolved.available.length > 0
        ? ` Available models: ${resolved.available.slice(0, 8).join(", ")}`
        : "";
    throw new Error(
      `Chat backend HTTP ${res.status} at ${root} (model=${usedModel}): ${text.slice(0, 200) || res.statusText}.${avail}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
    usage?: { total_tokens?: number };
  };
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
  if (isGarbageModelContent(content)) {
    throw new Error(
      `Model returned tool-call noise instead of an answer: ${content.slice(0, 120)}`,
    );
  }
  if (!content) {
    throw new Error("Empty response from chat backend");
  }

  return {
    ok: true,
    content,
    agentId: req.agent.id,
    backend,
    model: data.model || usedModel,
    usage: {
      tokens: data.usage?.total_tokens,
      latencyMs: Date.now() - t0,
    },
    raw: data,
  };
}

function chatBackendCandidates(cfg: ReturnType<typeof jarvisConfig>): string[] {
  const s = getSettings() as {
    jarvisChatBaseUrl?: string;
    jarvisBaseUrl?: string;
  };
  // Prefer LM Studio (Hermes 3 8B Abliterated), then configured URL, then Ollama, then jarvis serve
  const list = [
    process.env.JARVIS_CHAT_BASE_URL,
    s.jarvisChatBaseUrl,
    LM_STUDIO_BASE,
    process.env.OLLAMA_HOST
      ? process.env.OLLAMA_HOST.replace(/\/$/, "")
      : undefined,
    "http://127.0.0.1:11434", // Ollama fallback
    // jarvis serve last — agent path is unreliable for chat
    cfg.baseUrl,
  ]
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .map((x) => x.replace(/\/$/, ""));

  const seen = new Set<string>();
  return list.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

async function invokeHttp(
  req: AgentInvokeRequest,
  cfg: ReturnType<typeof jarvisConfig>,
): Promise<AgentInvokeResult> {
  const t0 = Date.now();
  const isChat = req.voiceMode || req.phase === "chat";

  // Interactive chat: prefer Ollama/LM Studio direct (faithful multi-turn).
  // OpenJarvis serve defaults to orchestrator and invents tool-call text.
  if (isChat) {
    const errors: string[] = [];
    for (const base of chatBackendCandidates(cfg)) {
      try {
        return await invokeDirectChat(req, base, cfg.timeoutMs);
      } catch (e) {
        errors.push(
          `${base}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    throw new Error(
      `No chat backend answered. Start LM Studio local server (port 1234) with Hermes 3 8B Abliterated loaded, or Ollama / jarvis serve.\n` +
        errors.slice(0, 4).join("\n"),
    );
  }

  const jarvisAgent =
    (req.extras?.jarvisAgent as string) ||
    mapPhaseToJarvisAgent(req.phase, cfg.agentName);
  const tools =
    req.tools ??
    toolsForPhase(req.phase) ??
    undefined;

  const messages = buildChatMessages(req);

  // Pipeline / non-chat: still use jarvis serve when available
  const body: Record<string, unknown> = {
    model: resolveJarvisModel(req.agent.model),
    messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
  };
  if (jarvisAgent) body.agent = jarvisAgent;
  if (tools?.length) body.tools = tools;

  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-needed",
      },
      body: JSON.stringify(body),
    },
    cfg.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenJarvis HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { total_tokens?: number };
  };
  const content =
    data.choices?.[0]?.message?.content?.trim() ||
    JSON.stringify(data).slice(0, 500);

  if (isGarbageModelContent(content)) {
    // Fall back to pure engine backends
    for (const base of chatBackendCandidates(cfg)) {
      if (base === cfg.baseUrl) continue;
      try {
        return await invokeDirectChat(req, base, cfg.timeoutMs);
      } catch {
        /* try next */
      }
    }
  }

  return {
    ok: true,
    content,
    agentId: req.agent.id,
    backend: "jarvis-http",
    model: data.model,
    usage: {
      tokens: data.usage?.total_tokens,
      latencyMs: Date.now() - t0,
    },
    raw: data,
  };
}

function runCli(
  cliPath: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: jarvisSpawnEnv(),
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`jarvis CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function invokeCli(
  req: AgentInvokeRequest,
  cfg: ReturnType<typeof jarvisConfig>,
): Promise<AgentInvokeResult> {
  const t0 = Date.now();
  const bin = cfg.resolvedCliPath || (await whichCli(cfg.cliPath));
  if (!bin) {
    throw new Error(
      `CLI not found (${cfg.cliPath}). Install OpenJarvis or set jarvisCliPath.`,
    );
  }
  const jarvisAgent =
    (req.extras?.jarvisAgent as string) ||
    mapPhaseToJarvisAgent(req.phase, cfg.agentName);
  const tools = req.tools ?? toolsForPhase(req.phase);
  const system = buildSystemPrompt(req);
  let historyBlock = "";
  if (req.history?.length) {
    historyBlock =
      "Conversation so far:\n" +
      req.history
        .slice(-16)
        .map(
          (m) =>
            `${m.role === "assistant" ? "Jarvis" : "User"}: ${m.content.slice(0, 2000)}`,
        )
        .join("\n") +
      "\n\n";
  }
  const prompt = system
    ? `${system}\n\n---\n\n${historyBlock}User task:\n${req.prompt}`
    : `${historyBlock}${req.prompt}`;

  const agentForReq = req.voiceMode
    ? (req.extras?.jarvisAgent as string) || "simple"
    : jarvisAgent;
  const args = ["ask", "--json", "--no-stream", "-a", agentForReq, prompt];
  if (!req.voiceMode && tools?.length) {
    args.splice(args.length - 1, 0, "--tools", tools.join(","));
  }

  const { code, stdout, stderr } = await runCli(bin, args, cfg.timeoutMs);
  if (code !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || `jarvis exit ${code}`,
    );
  }

  // Prefer JSON; fall back to plain text
  let content = stdout.trim();
  let raw: unknown = stdout;
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    raw = parsed;
    content =
      (parsed.content as string) ||
      (parsed.response as string) ||
      (parsed.text as string) ||
      (typeof parsed.result === "string" ? parsed.result : null) ||
      JSON.stringify(parsed, null, 2);
  } catch {
    /* plain text output */
  }

  return {
    ok: true,
    content: content.trim(),
    agentId: req.agent.id,
    backend: "jarvis-cli",
    usage: { latencyMs: Date.now() - t0 },
    raw,
  };
}

export const jarvisAdapter: AgentAdapter = {
  id: "jarvis",

  supports(agent) {
    return isJarvisAgent(agent);
  },

  async health(agent) {
    const cfg = jarvisConfig(agent);
    if (!cfg.enabled) {
      return {
        ok: false,
        backend: "jarvis",
        detail: "OpenJarvis integration disabled in Settings",
      };
    }

    const mode = resolveChatMode();
    const grokReady = isAiConfigured();
    // RivalSearchMCP is primary live source; Tavily optional; RSS/DDG last resort
    const searchNote =
      "Live search: RivalSearchMCP primary · Tavily optional · RSS/DDG fallback";

    // Match chat invoke: probe LM Studio / Ollama / jarvis serve candidates
    // with short timeouts so "online" reflects any usable chat backend.
    const candidates = chatBackendCandidates(cfg);
    const failures: string[] = [];
    let localHealth: AgentHealth | null = null;
    for (const base of candidates) {
      const h = await healthHttp(base, 3000);
      if (h.ok) {
        localHealth = h;
        break;
      }
      failures.push(`${base}: ${h.detail}`);
    }

    if (!localHealth) {
      const cli = await healthCli(cfg.cliPath);
      if (cli.ok) localHealth = cli;
    }

    // Hybrid: online if local OR Grok can answer
    if (localHealth?.ok) {
      const hybridBits = [
        localHealth.detail,
        mode === "hybrid" && grokReady
          ? "Grok for live questions"
          : mode === "hybrid" && !grokReady
            ? "set XAI_API_KEY for Grok hybrid"
            : mode === "grok" && grokReady
              ? "mode=grok"
              : mode === "local"
                ? "mode=local"
                : null,
        searchNote,
      ].filter(Boolean);
      return {
        ...localHealth,
        backend:
          mode === "hybrid" && grokReady
            ? "hybrid"
            : localHealth.backend,
        detail: hybridBits.join(" · "),
      };
    }

    if (grokReady && mode !== "local") {
      return {
        ok: true,
        backend: "grok",
        detail: `Grok ready (${getGrokChatModel()}) · local offline · ${searchNote}`,
      };
    }

    return {
      ok: false,
      backend: "jarvis",
      detail:
        failures.length > 0
          ? `No chat backend reachable. Tried: ${failures.slice(0, 4).join(" · ")}${
              !grokReady ? " · set XAI_API_KEY for Grok fallback" : ""
            }`
          : "No chat backend configured",
    };
  },

  async invoke(req) {
    const cfg = jarvisConfig(req.agent);
    if (!cfg.enabled) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: "jarvis",
        error: "OpenJarvis is disabled in Settings",
      };
    }

    const isChat = req.voiceMode || req.phase === "chat";
    const errors: string[] = [];

    // Chat/voice: clock + live web enrichment, then hybrid Grok / LM Studio
    if (isChat) {
      const { req: enriched, wantsLive, hasLiveHits, hasVaultHits, liveProvider } =
        await enrichChatRequest(req);
      const mode = resolveChatMode();
      // Vault-grounded personal questions stay on the local model (private +
      // fast); live-data questions keep their existing routing.
      const grounded = hasLiveHits || (hasVaultHits && !wantsLive);
      const preferGrok = shouldPreferGrok(mode, wantsLive, grounded);
      const routeHint =
        wantsLive || hasLiveHits
          ? `live${liveProvider ? `/${liveProvider}` : ""}`
          : hasVaultHits
            ? "local-second-brain"
            : "local-private";

      if (preferGrok) {
        try {
          const result = await invokeGrokChat(enriched);
          return {
            ...result,
            raw: {
              hybrid: {
                mode,
                route: "grok",
                reason: routeHint,
                liveProvider,
              },
              upstream: result.raw,
            },
          };
        } catch (e) {
          errors.push(
            `grok: ${e instanceof Error ? e.message : String(e)}`,
          );
          // Fall through to local unless force-grok and no local intended
          if (mode === "grok") {
            // still try local as last resort
          }
        }
      }

      try {
        const result = await invokeHttp(enriched, cfg);
        return {
          ...result,
          raw: {
            hybrid: {
              mode,
              route: result.backend,
              reason: preferGrok
                ? `local-fallback-after-grok (${routeHint})`
                : routeHint,
              liveProvider,
              priorErrors: errors.length ? errors : undefined,
            },
            upstream: result.raw,
          },
        };
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }

      // Local failed — try Grok if we have a key and did not already succeed
      if (isAiConfigured() && mode !== "local" && !preferGrok) {
        try {
          const result = await invokeGrokChat(enriched);
          return {
            ...result,
            raw: {
              hybrid: {
                mode,
                route: "grok",
                reason: "local-offline-fallback",
                liveProvider,
                priorErrors: errors,
              },
              upstream: result.raw,
            },
          };
        } catch (e) {
          errors.push(
            `grok-fallback: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: "jarvis",
        error:
          `Chat failed. Hybrid needs LM Studio (Hermes on port 1234) and/or XAI_API_KEY for Grok.\n` +
          `Mode=${mode}. Live search=${liveProvider || (wantsLive ? "attempted" : "n/a")}.\n` +
          errors.join("\n"),
      };
    }

    if (!cfg.preferCli) {
      try {
        return await invokeHttp(req, cfg);
      } catch (e) {
        errors.push(
          `http: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      try {
        return await invokeCli(req, cfg);
      } catch (e) {
        errors.push(`cli: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      try {
        return await invokeCli(req, cfg);
      } catch (e) {
        errors.push(`cli: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        return await invokeHttp(req, cfg);
      } catch (e) {
        errors.push(
          `http: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      ok: false,
      content: "",
      agentId: req.agent.id,
      backend: "jarvis",
      error:
        `OpenJarvis unavailable. Start with \`jarvis serve --port 8000\` or install the CLI.\n` +
        errors.join("\n"),
    };
  },
};
