import { NextResponse } from "next/server";
import {
  MCP_CATALOG,
  envKeyPresent,
  resolveMcpLaunch,
  resolveRivalSearchDir,
  rivalSearchInstalled,
} from "@/lib/mcp/catalog";
import { buildMcpClientConfig, mcpToolsPromptSummary } from "@/lib/mcp/export";
import type { McpServerState } from "@/lib/mcp/types";
import { listIsolatedSessions } from "@/lib/mcp/client";
import { getSettings, mergeMcpStates, updateSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  — catalog + status (which env keys are set, enabled flags)
 * PATCH — update enabled / useDocker for MCP servers
 */
export async function GET() {
  const settings = getSettings();
  const states = mergeMcpStates(settings.mcpServers);

  const servers = MCP_CATALOG.map((def) => {
    const state = states.find((s) => s.id === def.id) ?? {
      id: def.id,
      enabled: true,
    };
    const launch = resolveMcpLaunch(def, state);
    const envStatus = def.envVars.map((e) => ({
      key: e.key,
      label: e.label,
      required: e.required,
      present: envKeyPresent(e.key) || Boolean(state.envOverrides?.[e.key]),
      docsUrl: e.docsUrl,
    }));
    const envReady =
      !def.envVars.some((e) => e.required) ||
      def.envVars
        .filter((e) => e.required)
        .every(
          (e) =>
            envKeyPresent(e.key) || Boolean(state.envOverrides?.[e.key]),
        );
    // RivalSearchMCP needs local clone + uv, not an API key
    const installReady =
      def.id !== "rival-search" || rivalSearchInstalled();
    const ready = Boolean(state.enabled && envReady && installReady);

    return {
      ...def,
      // Surface resolved launch paths in API (so UI shows real uv/dir)
      command: launch.command,
      args: launch.args,
      state,
      launch: {
        command: launch.command,
        args: launch.args,
        // never return secret values — only which keys would be passed
        envKeys: Object.keys(launch.env),
      },
      envStatus,
      ready,
      ...(def.id === "rival-search"
        ? {
            installPath: resolveRivalSearchDir(),
            installFound: rivalSearchInstalled(),
          }
        : {}),
      ...(def.id === "heventure-search"
        ? {
            installPath: "uvx heventure-search-mcp",
            installFound: true,
          }
        : {}),
      ...(def.id === "lancedb"
        ? {
            installPath: "embedded @lancedb/lancedb",
            installFound: true,
          }
        : {}),
    };
  });

  return NextResponse.json({
    servers,
    runtime: {
      id: "mcp-typescript-sdk",
      name: "MCP TypeScript SDK",
      version: "1.30.0",
      homepage: "https://github.com/modelcontextprotocol/typescript-sdk",
      description:
        "Official Model Context Protocol client — isolated stdio processes, per-agent tool permissions, timeouts, and audit history.",
      ready: true,
      sessions: listIsolatedSessions(),
    },
    exportConfig: buildMcpClientConfig(states),
    promptSummary: mcpToolsPromptSummary(states),
    timeouts: getSettings().mcpTimeouts,
    sessions: listIsolatedSessions(),
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    servers?: McpServerState[];
    id?: string;
    enabled?: boolean;
    useDocker?: boolean;
  };

  const current = mergeMcpStates(getSettings().mcpServers);
  let next = current;

  if (Array.isArray(body.servers)) {
    next = mergeMcpStates(body.servers);
  } else if (body.id) {
    next = current.map((s) => {
      if (s.id !== body.id) return s;
      return {
        ...s,
        ...(typeof body.enabled === "boolean"
          ? { enabled: body.enabled }
          : {}),
        ...(typeof body.useDocker === "boolean"
          ? { useDocker: body.useDocker }
          : {}),
      };
    });
  }

  const settings = updateSettings({ mcpServers: next });
  return NextResponse.json({
    mcpServers: settings.mcpServers,
    ok: true,
  });
}
