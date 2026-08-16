import { NextResponse } from "next/server";
import { getAgents, getSettings, updateSettings } from "@/lib/store";
import {
  mergeMcpPermissions,
  upsertAgentPolicy,
} from "@/lib/mcp/permissions";
import type { McpServerId, McpToolPolicy } from "@/lib/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getSettings();
  return NextResponse.json({
    permissions: mergeMcpPermissions(settings.mcpPermissions),
    timeouts: settings.mcpTimeouts,
    agents: getAgents().map((a) => ({
      id: a.id,
      name: a.name,
      toolAccess: a.config.toolAccess,
    })),
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    serverId?: string;
    policy?: McpToolPolicy;
    timeouts?: { connectMs?: number; callMs?: number; idleMs?: number };
  };

  const current = getSettings();
  let permissions = mergeMcpPermissions(current.mcpPermissions);
  let timeouts = current.mcpTimeouts;

  if (body.agentId && body.serverId && body.policy) {
    permissions = upsertAgentPolicy(
      permissions,
      body.agentId,
      body.serverId as McpServerId,
      {
        mode: body.policy.mode,
        tools: Array.isArray(body.policy.tools) ? body.policy.tools : [],
      },
    );
  }
  if (body.timeouts) {
    timeouts = {
      connectMs: Number(body.timeouts.connectMs) || timeouts.connectMs,
      callMs: Number(body.timeouts.callMs) || timeouts.callMs,
      idleMs: Number(body.timeouts.idleMs) || timeouts.idleMs,
    };
  }

  const settings = updateSettings({ mcpPermissions: permissions, mcpTimeouts: timeouts });
  return NextResponse.json({
    ok: true,
    permissions: settings.mcpPermissions,
    timeouts: settings.mcpTimeouts,
  });
}
