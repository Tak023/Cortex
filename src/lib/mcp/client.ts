/**
 * Isolated MCP TypeScript client.
 *
 * Each (agent, server) pair gets its own stdio child process — agents never
 * share a live MCP session. Calls honor per-agent tool permissions, connect /
 * call timeouts from the official SDK, and every attempt is written to audit.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ensureSecretsLoaded } from "@/lib/env/secrets";
import { getAgents, getSettings, pushActivity } from "@/lib/store";
import { appendAudit, redactPreview } from "./audit";
import {
  getMcpDefinition,
  resolveMcpLaunch,
  resolveRivalSearchDir,
} from "./catalog";
import { getAgentPolicy, isToolAllowed } from "./permissions";
import {
  DEFAULT_MCP_TIMEOUTS,
  type McpAuditStatus,
  type McpServerId,
  type McpTimeouts,
  type McpToolPolicy,
} from "./types";

export type McpListedTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

type Sdk = {
  Client: typeof import("@modelcontextprotocol/sdk/client").Client;
  StdioClientTransport: typeof import("@modelcontextprotocol/sdk/client/stdio").StdioClientTransport;
  getDefaultEnvironment: typeof import("@modelcontextprotocol/sdk/client/stdio").getDefaultEnvironment;
};

let sdkPromise: Promise<Sdk> | null = null;

function resolveSdkRoot(): string {
  const candidates = [
    process.env.CORTEX_PROJECT_ROOT,
    process.cwd(),
    path.join(process.cwd(), "standalone"),
    typeof (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath === "string"
      ? path.join(
          (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!,
          "standalone",
        )
      : "",
  ].filter(Boolean) as string[];
  for (const base of candidates) {
    const root = path.join(base, "node_modules", "@modelcontextprotocol", "sdk");
    if (fs.existsSync(path.join(root, "package.json"))) return root;
  }
  throw new Error(
    "Cannot find @modelcontextprotocol/sdk. Reinstall Cortex or run npm install.",
  );
}

async function loadSdk(): Promise<Sdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const root = resolveSdkRoot();
      const clientHref = pathToFileURL(
        path.join(root, "dist/esm/client/index.js"),
      ).href;
      const stdioHref = pathToFileURL(
        path.join(root, "dist/esm/client/stdio.js"),
      ).href;
      const loader = new Function("u", "return import(u)") as (
        u: string,
      ) => Promise<Record<string, unknown>>;
      const [clientMod, stdioMod] = await Promise.all([
        loader(clientHref),
        loader(stdioHref),
      ]);
      return {
        Client: clientMod.Client as Sdk["Client"],
        StdioClientTransport: stdioMod.StdioClientTransport as Sdk["StdioClientTransport"],
        getDefaultEnvironment: stdioMod.getDefaultEnvironment as Sdk["getDefaultEnvironment"],
      };
    })();
  }
  return sdkPromise;
}

type IsolatedSession = {
  key: string;
  agentId: string;
  serverId: McpServerId;
  client: InstanceType<Sdk["Client"]>;
  transport: InstanceType<Sdk["StdioClientTransport"]>;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const sessions = new Map<string, IsolatedSession>();

function sessionKey(agentId: string, serverId: string): string {
  return `${agentId}::${serverId}`;
}

function timeouts(): McpTimeouts {
  const saved = getSettings().mcpTimeouts;
  return {
    connectMs: saved?.connectMs || DEFAULT_MCP_TIMEOUTS.connectMs,
    callMs: saved?.callMs || DEFAULT_MCP_TIMEOUTS.callMs,
    idleMs: saved?.idleMs || DEFAULT_MCP_TIMEOUTS.idleMs,
  };
}

function touchIdle(session: IsolatedSession) {
  session.lastUsed = Date.now();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const { idleMs } = timeouts();
  session.idleTimer = setTimeout(() => {
    void closeSession(session.key, "idle");
  }, idleMs);
}

async function closeSession(key: string, _reason: string) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  try {
    await session.client.close();
  } catch {
    /* already dead */
  }
  try {
    await session.transport.close();
  } catch {
    /* already dead */
  }
}

export async function closeAllMcpSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((k) => closeSession(k, "shutdown")));
}

async function spawnSession(
  agentId: string,
  serverId: McpServerId,
): Promise<IsolatedSession> {
  ensureSecretsLoaded();
  const def = getMcpDefinition(serverId);
  if (!def) throw new Error(`Unknown MCP server: ${serverId}`);
  const state = getSettings().mcpServers.find((s) => s.id === serverId);
  if (state && !state.enabled) {
    throw new Error(`${def.name} is disabled in MCP settings`);
  }
  if (serverId === "lancedb") {
    throw new Error("LanceDB is embedded in Cortex — call search/reindex/status tools directly");
  }
  const launch = resolveMcpLaunch(def, state);
  const { connectMs } = timeouts();
  const { Client, StdioClientTransport, getDefaultEnvironment } = await loadSdk();

  const env = {
    ...getDefaultEnvironment(),
    ...launch.env,
  };
  const cwd = serverId === "rival-search" ? resolveRivalSearchDir() : undefined;

  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env,
    cwd,
    stderr: "pipe",
  });

  const client = new Client({
    name: `cortex-${agentId}`,
    version: process.env.NEXT_PUBLIC_APP_VERSION || "0.2.7",
  });

  const key = sessionKey(agentId, serverId);
  try {
    await client.connect(transport, { timeout: connectMs });
  } catch (e) {
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to start ${def.name} (pid isolated): ${msg}`);
  }

  const session: IsolatedSession = {
    key,
    agentId,
    serverId,
    client,
    transport,
    lastUsed: Date.now(),
  };
  transport.onclose = () => {
    if (sessions.get(key) === session) sessions.delete(key);
  };
  sessions.set(key, session);
  touchIdle(session);
  return session;
}

async function getSession(
  agentId: string,
  serverId: McpServerId,
): Promise<IsolatedSession> {
  const key = sessionKey(agentId, serverId);
  const existing = sessions.get(key);
  if (existing) {
    touchIdle(existing);
    return existing;
  }
  return spawnSession(agentId, serverId);
}

function policyFor(agentId: string, serverId: McpServerId): McpToolPolicy {
  return getAgentPolicy(getSettings().mcpPermissions, agentId, serverId);
}

function textFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return redactPreview(result);
  const rec = result as { content?: Array<{ type?: string; text?: string }> };
  if (Array.isArray(rec.content)) {
    const text = rec.content
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text) return redactPreview(text);
  }
  return redactPreview(result);
}

export function listIsolatedSessions(): Array<{
  agentId: string;
  serverId: string;
  pid: number | null;
  idleMs: number;
}> {
  const now = Date.now();
  return [...sessions.values()].map((s) => ({
    agentId: s.agentId,
    serverId: s.serverId,
    pid: s.transport.pid,
    idleMs: now - s.lastUsed,
  }));
}

export async function listMcpTools(
  serverId: McpServerId,
  agentId: string,
): Promise<McpListedTool[]> {
  const started = Date.now();
  const policy = policyFor(agentId, serverId);
  if (policy.mode === "off") {
    appendAudit({
      agentId,
      serverId,
      tool: "*",
      argsPreview: "",
      resultPreview: "",
      durationMs: Date.now() - started,
      status: "denied",
      error: "Agent is not allowed to use this MCP server",
    });
    throw new Error("Agent is not allowed to use this MCP server");
  }

  if (serverId === "lancedb") {
    const { LANCEDB_TOOLS } = await import("@/lib/lancedb/store");
    appendAudit({
      agentId,
      serverId,
      tool: "tools/list",
      argsPreview: "",
      resultPreview: LANCEDB_TOOLS.map((t) => t.name).join(", "),
      durationMs: Date.now() - started,
      status: "listed",
    });
    return LANCEDB_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  const { callMs } = timeouts();
  const session = await getSession(agentId, serverId);
  try {
    const listed = await session.client.listTools(undefined, { timeout: callMs });
    const tools = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema,
    }));
    appendAudit({
      agentId,
      serverId,
      tool: "tools/list",
      argsPreview: "",
      resultPreview: tools.map((t) => t.name).join(", "),
      durationMs: Date.now() - started,
      status: "listed",
      pid: session.transport.pid,
    });
    return tools;
  } catch (e) {
    await closeSession(session.key, "list-failed");
    const msg = e instanceof Error ? e.message : String(e);
    const status: McpAuditStatus = /timeout/i.test(msg) ? "timeout" : "error";
    appendAudit({
      agentId,
      serverId,
      tool: "tools/list",
      argsPreview: "",
      resultPreview: "",
      durationMs: Date.now() - started,
      status,
      error: msg,
    });
    throw e;
  }
}

export async function callMcpTool(opts: {
  agentId: string;
  serverId: McpServerId;
  tool: string;
  args?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  result?: unknown;
  text: string;
  pid: number | null;
  durationMs: number;
}> {
  const { agentId, serverId, tool } = opts;
  const args = opts.args && typeof opts.args === "object" ? opts.args : {};
  const started = Date.now();

  if (!getAgents().some((a) => a.id === agentId) && agentId !== "cortex-inspector") {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const policy = policyFor(agentId, serverId);
  const allowed = isToolAllowed(policy, tool);
  if (!allowed.ok) {
    const entry = appendAudit({
      agentId,
      serverId,
      tool,
      argsPreview: redactPreview(args),
      resultPreview: "",
      durationMs: Date.now() - started,
      status: "denied",
      error: allowed.reason,
    });
    pushActivity({
      type: "error",
      message: `MCP denied: ${agentId} → ${serverId}/${tool}`,
      agentId,
    });
    const err = new Error(allowed.reason);
    (err as Error & { auditId?: string }).auditId = entry.id;
    throw err;
  }

  if (serverId === "lancedb") {
    const { lanceStatus, reindexLance, searchLance } = await import(
      "@/lib/lancedb/store"
    );
    let payload: unknown;
    if (tool === "status") payload = await lanceStatus();
    else if (tool === "reindex") payload = await reindexLance();
    else if (tool === "search") {
      payload = await searchLance(String(args.query || args.q || ""), 8);
    } else {
      throw new Error(`Unknown LanceDB tool: ${tool}`);
    }
    const text = redactPreview(payload);
    appendAudit({
      agentId,
      serverId,
      tool,
      argsPreview: redactPreview(args),
      resultPreview: text,
      durationMs: Date.now() - started,
      status: "ok",
    });
    return { ok: true, result: payload, text, pid: null, durationMs: Date.now() - started };
  }

  const { callMs } = timeouts();
  const session = await getSession(agentId, serverId);
  try {
    const result = await session.client.callTool(
      { name: tool, arguments: args },
      undefined,
      { timeout: callMs },
    );
    const text = textFromResult(result);
    const durationMs = Date.now() - started;
    appendAudit({
      agentId,
      serverId,
      tool,
      argsPreview: redactPreview(args),
      resultPreview: text,
      durationMs,
      status: "ok",
      pid: session.transport.pid,
    });
    pushActivity({
      type: "info",
      message: `MCP ${serverId}/${tool} (${durationMs}ms)`,
      agentId,
    });
    touchIdle(session);
    return { ok: true, result, text, pid: session.transport.pid, durationMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status: McpAuditStatus = /timeout/i.test(msg) ? "timeout" : "error";
    appendAudit({
      agentId,
      serverId,
      tool,
      argsPreview: redactPreview(args),
      resultPreview: "",
      durationMs: Date.now() - started,
      status,
      error: msg,
      pid: session.transport.pid,
    });
    await closeSession(session.key, status);
    throw e;
  }
}
