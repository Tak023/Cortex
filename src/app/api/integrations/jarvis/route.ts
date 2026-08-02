import { NextResponse } from "next/server";
import {
  checkAgentHealth,
  invokeAgent,
  probeLiveIntegrations,
  type AgentChatMessage,
} from "@/lib/agents/adapters";
import { isAiConfigured, getGrokChatModel } from "@/lib/ai/client";
import { getSettings, updateAgent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  — OpenJarvis health / connection status
 * POST — Interactive chat / voice turn with OpenJarvis
 *
 * Body: {
 *   prompt,
 *   agentId?,
 *   phase?,
 *   tools?,
 *   jarvisAgent?,
 *   history?: { role, content }[],
 *   voiceMode?: boolean
 * }
 */
export async function GET() {
  const settings = getSettings();
  const probes = await probeLiveIntegrations();

  // Reflect connectivity onto agent status cards
  for (const p of probes) {
    updateAgent(p.agentId, {
      status: p.health.ok ? "idle" : "offline",
      lastSeenAt: new Date().toISOString(),
    });
  }

  const anyOk = probes.some((p) => p.health.ok);
  const primary =
    probes.find((p) => p.agentId === "agent-jarvis")?.health ||
    probes[0]?.health;
  const grokReady = isAiConfigured();
  const tavilyReady = Boolean(process.env.TAVILY_API_KEY?.trim());

  return NextResponse.json({
    enabled: settings.jarvisEnabled !== false,
    baseUrl: settings.jarvisBaseUrl,
    chatBaseUrl: settings.jarvisChatBaseUrl,
    chatModel: settings.jarvisChatModel,
    chatMode: settings.jarvisChatMode || "hybrid",
    defaultAgent: settings.jarvisDefaultAgent,
    cliPath: settings.jarvisCliPath,
    preferCli: settings.jarvisPreferCli,
    useInPipeline: settings.jarvisUseInPipeline,
    online: anyOk,
    hybrid: {
      mode: settings.jarvisChatMode || "hybrid",
      grokReady,
      grokModel: grokReady ? getGrokChatModel() : null,
      tavilyReady,
      localHint: "LM Studio local server :1234 (Hermes 3 8B Abliterated)",
    },
    health: primary ?? {
      ok: false,
      backend: "jarvis",
      detail: "No OpenJarvis agents registered",
    },
    probes,
    docs: "https://github.com/open-jarvis/OpenJarvis",
    install:
      "curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash",
    serveHint: "LM Studio :1234 · optional jarvis serve --port 8000",
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    agentId?: string;
    phase?: string;
    tools?: string[];
    jarvisAgent?: string;
    history?: AgentChatMessage[];
    voiceMode?: boolean;
    systemPrompt?: string;
  };

  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const agentId = body.agentId || "agent-jarvis";
  const voiceMode = Boolean(body.voiceMode);
  const history = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is AgentChatMessage =>
            !!m &&
            (m.role === "user" ||
              m.role === "assistant" ||
              m.role === "system") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        )
        .slice(-24)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 8000),
        }))
    : undefined;

  // Soft health probe — do not block chat if the probe is wrong but the model answers
  let health = await checkAgentHealth(agentId).catch(() => ({
    ok: false,
    backend: "jarvis",
    detail: "Health probe failed",
  }));
  updateAgent(agentId, {
    status: "busy",
    lastSeenAt: new Date().toISOString(),
  });

  const result = await invokeAgent({
    agentId,
    prompt,
    phase: (body.phase as "chat") || "chat",
    tools: voiceMode ? [] : body.tools,
    history,
    voiceMode,
    systemPrompt: body.systemPrompt,
    // Voice stays snappy; typed gets room for researched answers
    maxTokens: voiceMode ? 600 : 1400,
    extras: {
      ...(body.jarvisAgent ? { jarvisAgent: body.jarvisAgent } : {}),
      ...(voiceMode && !body.jarvisAgent ? { jarvisAgent: "simple" } : {}),
    },
  });

  // Refresh health after a successful turn so UI status matches reality
  if (result.ok) {
    health = await checkAgentHealth(agentId).catch(() => health);
  }

  updateAgent(agentId, {
    status: result.ok ? "idle" : "error",
    lastSeenAt: new Date().toISOString(),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error || "OpenJarvis invoke failed",
        result,
        health,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ result, health });
}
