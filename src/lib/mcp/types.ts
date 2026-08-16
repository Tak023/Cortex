/**
 * MCP (Model Context Protocol) server definitions for Cortex.
 * Used by OpenJarvis, export configs (Cursor/Claude), and future agent tools.
 */

export type McpTransport = "stdio" | "sse" | "http";

export type McpServerId =
  | "firecrawl"
  | "playwright"
  | "tavily"
  | "github"
  | "rival-search"
  | "heventure-search"
  | "lancedb";

export interface McpEnvVar {
  key: string;
  label: string;
  /** If true, value is required for the server to be useful */
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  docsUrl?: string;
}

export interface McpServerDefinition {
  id: McpServerId;
  name: string;
  description: string;
  homepage: string;
  transport: McpTransport;
  /** Default launch command for stdio servers */
  command: string;
  args: string[];
  envVars: McpEnvVar[];
  /** Optional docker alternative (e.g. official GitHub MCP) */
  docker?: {
    image: string;
    args: string[];
  };
  /** Tags for UI filters */
  tags: string[];
}

/** Runtime / user preference for a catalog server */
export interface McpServerState {
  id: McpServerId;
  enabled: boolean;
  /** Prefer docker launch when available */
  useDocker?: boolean;
  /** Non-secret overrides (host, paths). Secrets stay in process env. */
  envOverrides?: Record<string, string>;
}

/** How an agent may use tools on one MCP server. */
export type McpToolPolicyMode = "all" | "allow" | "deny" | "off";

export type McpToolPolicy = {
  /** all = every tool; allow = only listed; deny = all except listed; off = blocked */
  mode: McpToolPolicyMode;
  tools: string[];
};

export type McpAgentPermissions = {
  agentId: string;
  servers: Partial<Record<McpServerId, McpToolPolicy>>;
};

export type McpTimeouts = {
  /** Handshake / spawn timeout */
  connectMs: number;
  /** Per tool-call timeout */
  callMs: number;
  /** Kill an idle isolated process after this many ms */
  idleMs: number;
};

export const DEFAULT_MCP_TIMEOUTS: McpTimeouts = {
  connectMs: 20_000,
  callMs: 30_000,
  idleMs: 120_000,
};

export type McpAuditStatus =
  | "ok"
  | "denied"
  | "timeout"
  | "error"
  | "listed";

export type McpAuditEntry = {
  id: string;
  at: string;
  agentId: string;
  serverId: string;
  tool: string;
  argsPreview: string;
  resultPreview: string;
  durationMs: number;
  status: McpAuditStatus;
  pid?: number | null;
  error?: string;
};

export interface McpExportFormat {
  /** Claude Desktop / many clients */
  claudeDesktop: {
    mcpServers: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
  };
  /** Cursor-style */
  cursor: {
    mcpServers: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
  };
}
