/**
 * One-time MCP tool grants.
 *
 * A denial is a decision point, not a dead end. When an agent asks for a tool
 * its policy forbids, the operator can wave that single call through without
 * permanently widening the agent's allow list — which is what "grant once"
 * means everywhere else and what the permission grid could not express.
 *
 * Deliberately in-memory: a one-time grant that survives a restart is not a
 * one-time grant. Persistent decisions belong in `mcpPermissions`.
 */
import type { McpServerId } from "./types";

const TTL_MS = 10 * 60_000;

type GrantKey = string;

type Store = { grants: Map<GrantKey, number> };

function store(): Store {
  const g = globalThis as typeof globalThis & { __cortexMcpGrants?: Store };
  if (!g.__cortexMcpGrants) g.__cortexMcpGrants = { grants: new Map() };
  return g.__cortexMcpGrants;
}

function key(agentId: string, serverId: McpServerId, tool: string): GrantKey {
  return `${agentId}|${serverId}|${tool.trim()}`;
}

function sweep(now: number) {
  const { grants } = store();
  for (const [k, expiresAt] of grants) {
    if (expiresAt <= now) grants.delete(k);
  }
}

/** Allow exactly one call of `tool` on `serverId` by `agentId`. */
export function grantOnce(
  agentId: string,
  serverId: McpServerId,
  tool: string,
): { expiresAt: string } {
  const now = Date.now();
  sweep(now);
  const expiresAt = now + TTL_MS;
  store().grants.set(key(agentId, serverId, tool), expiresAt);
  return { expiresAt: new Date(expiresAt).toISOString() };
}

/** Consume a pending grant. Returns true when this call was pre-authorised. */
export function consumeGrant(
  agentId: string,
  serverId: McpServerId,
  tool: string,
): boolean {
  const now = Date.now();
  sweep(now);
  const k = key(agentId, serverId, tool);
  const expiresAt = store().grants.get(k);
  if (expiresAt == null || expiresAt <= now) return false;
  store().grants.delete(k);
  return true;
}

export function listGrants(): Array<{
  agentId: string;
  serverId: string;
  tool: string;
  expiresAt: string;
}> {
  const now = Date.now();
  sweep(now);
  return [...store().grants.entries()].map(([k, expiresAt]) => {
    const [agentId, serverId, tool] = k.split("|");
    return {
      agentId,
      serverId,
      tool,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
}

export function revokeGrant(
  agentId: string,
  serverId: McpServerId,
  tool: string,
): boolean {
  return store().grants.delete(key(agentId, serverId, tool));
}
