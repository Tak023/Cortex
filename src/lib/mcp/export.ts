import { MCP_CATALOG, resolveMcpLaunch } from "./catalog";
import type { McpServerState } from "./types";

/**
 * Build Claude Desktop / Cursor style mcpServers map for enabled servers.
 *
 * Never embed real secret values from process.env (or secret overrides).
 * Clients copy/download this JSON; secrets must stay as placeholders so
 * users fill them in their own environment.
 */
export function buildMcpClientConfig(states: McpServerState[]): {
  mcpServers: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  >;
} {
  const mcpServers: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  > = {};

  for (const def of MCP_CATALOG) {
    const state = states.find((s) => s.id === def.id);
    if (state && !state.enabled) continue;

    const launch = resolveMcpLaunch(def, state);
    const env: Record<string, string> = {};
    for (const e of def.envVars) {
      // Secrets always export as shell-style placeholders — never real values.
      if (e.secret) {
        env[e.key] = `\${${e.key}}`;
        continue;
      }
      // Non-secret overrides (host, path) may be included; still never use process.env secrets.
      const override = state?.envOverrides?.[e.key]?.trim();
      env[e.key] = override || `\${${e.key}}`;
    }

    mcpServers[def.id] = {
      command: launch.command,
      args: launch.args,
      ...(Object.keys(env).length ? { env } : {}),
    };
  }

  return { mcpServers };
}

/** One-line summary of enabled MCP tools for agent system prompts */
export function mcpToolsPromptSummary(states: McpServerState[]): string {
  const enabled = MCP_CATALOG.filter((d) => {
    const st = states.find((s) => s.id === d.id);
    return !st || st.enabled;
  });
  if (enabled.length === 0) return "";

  const lines = enabled.map((d) => {
    const st = states.find((s) => s.id === d.id);
    const launch = resolveMcpLaunch(d, st);
    const missing = d.envVars
      .filter((e) => e.required && !launch.env[e.key])
      .map((e) => e.key);
    const status =
      missing.length > 0
        ? ` (needs env: ${missing.join(", ")})`
        : " (configured)";
    return `- **${d.name}** (${d.id}): ${d.description}${status}`;
  });

  return (
    `Cortex has the following MCP servers registered for tool use:\n` +
    lines.join("\n") +
    `\n\nWhen helpful, use tools from these servers (web search, scrape, browser, GitHub).`
  );
}
