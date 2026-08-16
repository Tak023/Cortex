import { NextResponse } from "next/server";
import { ensureSecretsLoaded } from "@/lib/env/secrets";
import { callMcpTool } from "@/lib/mcp/client";
import type { McpServerId } from "@/lib/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  ensureSecretsLoaded();
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    serverId?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  const agentId = String(body.agentId || "").trim();
  const serverId = String(body.serverId || "").trim() as McpServerId;
  const tool = String(body.tool || "").trim();
  if (!agentId || !serverId || !tool) {
    return NextResponse.json(
      { error: "agentId, serverId, and tool are required" },
      { status: 400 },
    );
  }
  try {
    const result = await callMcpTool({
      agentId,
      serverId,
      tool,
      args: body.args,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const denied = /not allowed|denied|allow list/i.test(msg);
    return NextResponse.json(
      { error: msg },
      { status: denied ? 403 : 502 },
    );
  }
}
