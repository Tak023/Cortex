import { NextResponse } from "next/server";
import { getSettings, pushActivity, updateSettings } from "@/lib/store";
import { grantOnce, listGrants, revokeGrant } from "@/lib/mcp/grants";
import {
  getAgentPolicy,
  mergeMcpPermissions,
  upsertAgentPolicy,
} from "@/lib/mcp/permissions";
import type { McpServerId } from "@/lib/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pending one-time grants. */
export async function GET() {
  return NextResponse.json({ grants: listGrants() });
}

/**
 * Resolve a denial.
 *
 * POST { agentId, serverId, tool, scope: "once" | "always" }
 *
 * - once:   authorise exactly one call, in memory, expiring in 10 minutes.
 * - always: widen the stored policy so this tool is permanently allowed for
 *           this agent (mode `all` is left alone; `off`/`allow` become an
 *           allow list containing the tool; `deny` drops it from the deny list).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    serverId?: string;
    tool?: string;
    scope?: string;
  };
  const agentId = String(body.agentId || "").trim();
  const serverId = String(body.serverId || "").trim() as McpServerId;
  const tool = String(body.tool || "").trim();
  const scope = body.scope === "always" ? "always" : "once";

  if (!agentId || !serverId || !tool) {
    return NextResponse.json(
      { error: "agentId, serverId, and tool are required" },
      { status: 400 },
    );
  }

  if (scope === "once") {
    const { expiresAt } = grantOnce(agentId, serverId, tool);
    pushActivity({
      type: "approval_resolved",
      message: `MCP grant (once): ${agentId} → ${serverId}/${tool}`,
      agentId,
    });
    return NextResponse.json({ ok: true, scope, expiresAt });
  }

  const current = mergeMcpPermissions(getSettings().mcpPermissions);
  const policy = getAgentPolicy(current, agentId, serverId);
  const tools = new Set(policy.tools.map((t) => t.trim()).filter(Boolean));

  let next = policy;
  if (policy.mode === "all") {
    next = policy; // already permitted
  } else if (policy.mode === "deny") {
    tools.delete(tool);
    next = { mode: "deny", tools: [...tools] };
  } else {
    tools.add(tool);
    next = { mode: "allow", tools: [...tools] };
  }

  const permissions = upsertAgentPolicy(current, agentId, serverId, next);
  updateSettings({ mcpPermissions: permissions });
  pushActivity({
    type: "approval_resolved",
    message: `MCP grant (always): ${agentId} → ${serverId}/${tool}`,
    agentId,
  });

  return NextResponse.json({ ok: true, scope, policy: next, permissions });
}

/** DELETE ?agentId=&serverId=&tool= — revoke a pending one-time grant. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const agentId = (url.searchParams.get("agentId") || "").trim();
  const serverId = (url.searchParams.get("serverId") || "").trim() as McpServerId;
  const tool = (url.searchParams.get("tool") || "").trim();
  if (!agentId || !serverId || !tool) {
    return NextResponse.json(
      { error: "agentId, serverId, and tool are required" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: revokeGrant(agentId, serverId, tool) });
}
