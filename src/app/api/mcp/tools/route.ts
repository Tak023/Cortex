import { NextResponse } from "next/server";
import { ensureSecretsLoaded } from "@/lib/env/secrets";
import { listIsolatedSessions, listMcpTools } from "@/lib/mcp/client";
import { INSPECTOR_AGENT_ID } from "@/lib/mcp/permissions";
import type { McpServerId } from "@/lib/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  ensureSecretsLoaded();
  const url = new URL(req.url);
  const serverId = (url.searchParams.get("serverId") || "").trim() as McpServerId;
  const agentId =
    (url.searchParams.get("agentId") || "").trim() || INSPECTOR_AGENT_ID;
  if (!serverId) {
    return NextResponse.json({
      sessions: listIsolatedSessions(),
    });
  }
  try {
    const tools = await listMcpTools(serverId, agentId);
    return NextResponse.json({
      serverId,
      agentId,
      tools,
      sessions: listIsolatedSessions(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
