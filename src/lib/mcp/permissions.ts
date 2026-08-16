import { DEFAULT_AGENTS } from "@/lib/agents/registry";
import { MCP_CATALOG } from "./catalog";
import type {
  McpAgentPermissions,
  McpServerId,
  McpToolPolicy,
} from "./types";

export const INSPECTOR_AGENT_ID = "cortex-inspector";

const SEARCH_SERVERS: McpServerId[] = [
  "rival-search",
  "heventure-search",
  "tavily",
];
const BROWSER_SERVERS: McpServerId[] = ["playwright", "firecrawl"];

function emptyPolicy(): McpToolPolicy {
  return { mode: "off", tools: [] };
}

function allPolicy(): McpToolPolicy {
  return { mode: "all", tools: [] };
}

/** Map Cortex toolAccess / roles onto catalog servers. */
export function defaultPolicyForAgent(
  agentId: string,
  serverId: McpServerId,
): McpToolPolicy {
  if (agentId === INSPECTOR_AGENT_ID) return allPolicy();
  const agent = DEFAULT_AGENTS.find((a) => a.id === agentId);
  if (!agent) return emptyPolicy();
  const access = new Set(agent.config.toolAccess);
  const roles = new Set(agent.roles);

  if (serverId === "lancedb") {
    if (
      access.has("memory") ||
      access.has("retrieval") ||
      access.has("web") ||
      roles.has("researcher") ||
      roles.has("generalist")
    ) {
      return allPolicy();
    }
    return emptyPolicy();
  }
  if (SEARCH_SERVERS.includes(serverId)) {
    if (access.has("web") || access.has("retrieval") || roles.has("researcher")) {
      return allPolicy();
    }
    return emptyPolicy();
  }
  if (serverId === "github") {
    if (access.has("git") || access.has("code") || roles.has("coder")) {
      return allPolicy();
    }
    return emptyPolicy();
  }
  if (BROWSER_SERVERS.includes(serverId)) {
    if (access.has("tools")) return allPolicy();
    return emptyPolicy();
  }
  return emptyPolicy();
}

export function defaultMcpPermissions(): McpAgentPermissions[] {
  return DEFAULT_AGENTS.map((a) => ({
    agentId: a.id,
    servers: Object.fromEntries(
      MCP_CATALOG.map((s) => [s.id, defaultPolicyForAgent(a.id, s.id)]),
    ) as McpAgentPermissions["servers"],
  }));
}

export function mergeMcpPermissions(
  saved: McpAgentPermissions[] | undefined,
): McpAgentPermissions[] {
  const defaults = defaultMcpPermissions();
  if (!saved?.length) return defaults;
  const byAgent = new Map(saved.map((p) => [p.agentId, p]));
  return defaults.map((d) => {
    const prev = byAgent.get(d.agentId);
    if (!prev) return d;
    const servers = { ...d.servers };
    for (const def of MCP_CATALOG) {
      const existing = prev.servers[def.id];
      if (existing) servers[def.id] = existing;
    }
    return { agentId: d.agentId, servers };
  });
}

export function getAgentPolicy(
  permissions: McpAgentPermissions[],
  agentId: string,
  serverId: McpServerId,
): McpToolPolicy {
  if (agentId === INSPECTOR_AGENT_ID) return allPolicy();
  const row = permissions.find((p) => p.agentId === agentId);
  return row?.servers[serverId] ?? defaultPolicyForAgent(agentId, serverId);
}

export function isToolAllowed(
  policy: McpToolPolicy,
  tool: string,
): { ok: true } | { ok: false; reason: string } {
  const name = tool.trim();
  if (!name) return { ok: false, reason: "Tool name is required" };
  if (policy.mode === "off") {
    return { ok: false, reason: "This agent is not allowed to use that MCP server" };
  }
  if (policy.mode === "all") return { ok: true };
  const listed = new Set(policy.tools.map((t) => t.trim()).filter(Boolean));
  if (policy.mode === "allow") {
    return listed.has(name)
      ? { ok: true }
      : { ok: false, reason: `Tool “${name}” is not on this agent's allow list` };
  }
  return listed.has(name)
    ? { ok: false, reason: `Tool “${name}” is denied for this agent` }
    : { ok: true };
}

export function upsertAgentPolicy(
  current: McpAgentPermissions[],
  agentId: string,
  serverId: McpServerId,
  policy: McpToolPolicy,
): McpAgentPermissions[] {
  const merged = mergeMcpPermissions(current);
  return merged.map((row) => {
    if (row.agentId !== agentId) return row;
    return {
      ...row,
      servers: { ...row.servers, [serverId]: policy },
    };
  });
}
