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
  | "heventure-search";

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
