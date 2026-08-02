import { NextResponse } from "next/server";
import { invokeAgent } from "@/lib/agents/adapters";
import { updateAgent, pushActivity, pushUsage } from "@/lib/store";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Generic agent invoke — future UI features should use this endpoint.
 *
 * POST { agentId, prompt, phase?, tools?, context?, systemPrompt? }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    prompt?: string;
    phase?: string;
    tools?: string[];
    context?: Record<string, string>;
    systemPrompt?: string;
    projectId?: string;
    extras?: Record<string, unknown>;
  };

  const agentId = body.agentId?.trim();
  const prompt = body.prompt?.trim();
  if (!agentId || !prompt) {
    return NextResponse.json(
      { error: "agentId and prompt are required" },
      { status: 400 },
    );
  }

  updateAgent(agentId, {
    status: "busy",
    currentTaskLabel: "API invoke",
    lastSeenAt: new Date().toISOString(),
  });

  const result = await invokeAgent({
    agentId,
    prompt,
    phase: (body.phase as "chat") || "chat",
    tools: body.tools,
    context: body.context,
    systemPrompt: body.systemPrompt,
    projectId: body.projectId,
    extras: body.extras,
  });

  updateAgent(agentId, {
    status: result.ok ? "idle" : "error",
    currentTaskId: null,
    currentTaskLabel: null,
    lastSeenAt: new Date().toISOString(),
  });

  if (result.ok) {
    pushActivity({
      type: "info",
      message: `Invoked ${agentId} via API (${result.backend})`,
      agentId,
      projectId: body.projectId,
    });
    if (result.usage?.tokens || result.usage?.latencyMs) {
      pushUsage({
        id: `use-${nanoid(8)}`,
        agentId,
        projectId: body.projectId,
        tokens: result.usage.tokens ?? 0,
        costUsd: 0,
        latencyMs: result.usage.latencyMs ?? 0,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json(
    { result },
    { status: result.ok ? 200 : 502 },
  );
}
