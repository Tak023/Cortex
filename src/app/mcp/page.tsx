"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Plug,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatRelative } from "@/lib/utils";
import type {
  McpAgentPermissions,
  McpAuditEntry,
  McpTimeouts,
  McpToolPolicyMode,
} from "@/lib/mcp/types";

type McpServerRow = {
  id: string;
  name: string;
  description: string;
  homepage: string;
  tags: string[];
  ready: boolean;
  state: { id: string; enabled: boolean; useDocker?: boolean };
  envStatus: Array<{
    key: string;
    label: string;
    required: boolean;
    present: boolean;
    docsUrl?: string;
  }>;
  launch: { command: string; args: string[]; envKeys: string[] };
  /** RivalSearchMCP local clone */
  installPath?: string;
  installFound?: boolean;
};

type McpRuntime = {
  id: string;
  name: string;
  version: string;
  homepage: string;
  description: string;
  ready: boolean;
  sessions?: Array<{ agentId: string; serverId: string; pid: number | null }>;
};

type PermAgent = { id: string; name: string; toolAccess: string[] };

const POLICY_MODES: McpToolPolicyMode[] = ["all", "allow", "deny", "off"];

export default function McpPage() {
  const [runtime, setRuntime] = useState<McpRuntime | null>(null);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [exportJson, setExportJson] = useState("");
  const [copied, setCopied] = useState(false);
  const [permissions, setPermissions] = useState<McpAgentPermissions[]>([]);
  const [permAgents, setPermAgents] = useState<PermAgent[]>([]);
  const [timeouts, setTimeouts] = useState<McpTimeouts | null>(null);
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [callAgent, setCallAgent] = useState("");
  const [callServer, setCallServer] = useState("");
  const [callTool, setCallTool] = useState("");
  const [callArgs, setCallArgs] = useState("{}");
  const [callOut, setCallOut] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [lanceInfo, setLanceInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [mcpRes, permRes, auditRes] = await Promise.all([
        fetch("/api/mcp"),
        fetch("/api/mcp/permissions"),
        fetch("/api/mcp/audit"),
      ]);
      const data = (await mcpRes.json()) as {
        servers: McpServerRow[];
        runtime?: McpRuntime;
        exportConfig: unknown;
        timeouts?: McpTimeouts;
      };
      const perms = (await permRes.json()) as {
        permissions?: McpAgentPermissions[];
        agents?: PermAgent[];
        timeouts?: McpTimeouts;
      };
      const hist = (await auditRes.json()) as { entries?: McpAuditEntry[] };
      setRuntime(data.runtime || null);
      setServers(data.servers || []);
      setExportJson(JSON.stringify(data.exportConfig, null, 2));
      setPermissions(perms.permissions || []);
      setPermAgents(perms.agents || []);
      setTimeouts(perms.timeouts || data.timeouts || null);
      setAudit(hist.entries || []);
      setCallAgent((prev) => prev || perms.agents?.[0]?.id || "");
      setCallServer((prev) => prev || data.servers?.[0]?.id || "");
    } catch {
      setServers([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reindexLance = async () => {
    setReindexing(true);
    try {
      const res = await fetch("/api/lancedb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reindex" }),
      });
      const json = (await res.json()) as {
        rows?: number;
        error?: string;
        dir?: string;
      };
      if (!res.ok) throw new Error(json.error || "Reindex failed");
      setLanceInfo(`${json.rows ?? 0} documents in ${json.dir || "LanceDB"}`);
    } catch (e) {
      setLanceInfo(e instanceof Error ? e.message : "Reindex failed");
    } finally {
      setReindexing(false);
      await refresh();
    }
  };

  const toggleServer = async (id: string, enabled: boolean) => {
    await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    await refresh();
  };

  const setPolicy = async (
    agentId: string,
    serverId: string,
    mode: McpToolPolicyMode,
  ) => {
    const existing = permissions
      .find((p) => p.agentId === agentId)
      ?.servers[serverId as keyof McpAgentPermissions["servers"]];
    await fetch("/api/mcp/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        serverId,
        policy: { mode, tools: existing?.tools || [] },
      }),
    });
    await refresh();
  };

  const saveTimeouts = async (next: McpTimeouts) => {
    await fetch("/api/mcp/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeouts: next }),
    });
    await refresh();
  };

  const runCall = async () => {
    setCalling(true);
    setCallOut(null);
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(callArgs || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("Arguments must be JSON");
      }
      const res = await fetch("/api/mcp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: callAgent,
          serverId: callServer,
          tool: callTool,
          args,
        }),
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `Call failed (${res.status})`);
      setCallOut(json.text || "(empty)");
    } catch (e) {
      setCallOut(e instanceof Error ? e.message : "Call failed");
    } finally {
      setCalling(false);
      await refresh();
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const readyCount = servers.filter((s) => s.ready).length;
  const enabledCount = servers.filter((s) => s.state.enabled).length;

  return (
    <>
      <PageHeader
        title="MCP Servers"
        description="Official TypeScript MCP client — isolated stdio processes, per-agent tool permissions, timeouts, and an audit log"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel-elevated/50 px-4 py-3 text-sm">
          <Plug className="h-4 w-4 text-accent" />
          <span className="font-medium">
            {enabledCount} enabled · {readyCount} ready
          </span>
          <span className="text-muted">
            Keys live in{" "}
            <code className="text-foreground/70">.env.local</code> (or desktop{" "}
            <code className="text-foreground/70">Application Support/cortex/.env</code>
            ). Open from the sidebar between Orchestration and Settings.
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void copyExport()}
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy MCP JSON"}
            </Button>
            <a
              href="/api/mcp/export"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-white/5"
            >
              Download config
            </a>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runtime ? (
            <Card className="border-sky-500/30 bg-sky-500/5">
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{runtime.name}</span>
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/25">
                        ready
                      </Badge>
                      <Badge className="bg-sky-500/15 text-sky-200 border-sky-500/25">
                        v{runtime.version}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-muted leading-snug">
                      {runtime.description}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {["client", "isolated-stdio", "permissions", "timeouts", "audit"].map(
                    (t) => (
                      <span
                        key={t}
                        className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted"
                      >
                        {t}
                      </span>
                    ),
                  )}
                </div>
                <p className="text-[11px] text-muted">
                  {runtime.sessions?.length
                    ? `${runtime.sessions.length} live isolated process${runtime.sessions.length === 1 ? "" : "es"}`
                    : "No live isolated processes"}
                </p>
                <a
                  href={runtime.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </CardBody>
            </Card>
          ) : null}
          {servers.map((s) => (
            <Card key={s.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.ready ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/25">
                          ready
                        </Badge>
                      ) : s.state.enabled ? (
                        <Badge className="bg-amber-500/15 text-amber-200 border-amber-500/25">
                          {s.id === "rival-search" && s.installFound === false
                            ? "needs install"
                            : s.envStatus.some((e) => e.required && !e.present)
                              ? "needs key"
                              : "not ready"}
                        </Badge>
                      ) : (
                        <Badge className="bg-white/5 text-muted border-border">
                          off
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-muted leading-snug">
                      {s.description}
                    </p>
                    {s.id === "rival-search" && s.installPath ? (
                      <p className="mt-1 font-mono text-[10px] text-muted/80 break-all">
                        {s.installFound === false
                          ? `Clone missing — expected ${s.installPath}`
                          : `Local: ${s.installPath}`}
                      </p>
                    ) : null}
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-blue-500"
                      checked={s.state.enabled}
                      onChange={(e) =>
                        void toggleServer(s.id, e.target.checked)
                      }
                    />
                    On
                  </label>
                </div>

                <div className="flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {s.envStatus.length > 0 && (
                  <ul className="space-y-1">
                    {s.envStatus.map((e) => (
                      <li
                        key={e.key}
                        className="flex items-center gap-1.5 text-[11px] text-muted"
                      >
                        {e.present ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : e.required ? (
                          <XCircle className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          <Circle className="h-3.5 w-3.5" />
                        )}
                        <code className="text-foreground/70">{e.key}</code>
                        {e.docsUrl && (
                          <a
                            href={e.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            get key
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="font-mono text-[10px] text-muted/80 truncate">
                  {s.launch.command} {s.launch.args.join(" ")}
                </p>
                {s.id === "lancedb" ? (
                  <div className="space-y-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={reindexing}
                      onClick={() => void reindexLance()}
                    >
                      {reindexing ? "Indexing…" : "Rebuild index"}
                    </Button>
                    {lanceInfo ? (
                      <p className="text-[11px] text-muted">{lanceInfo}</p>
                    ) : null}
                  </div>
                ) : null}

                <a
                  href={s.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  Homepage <ExternalLink className="h-3 w-3" />
                </a>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-sky-300" />
              Per-agent tool permissions
            </span>
            {timeouts ? (
              <span className="text-[11px] text-muted">
                Timeouts: connect {timeouts.connectMs / 1000}s · call{" "}
                {timeouts.callMs / 1000}s · idle {timeouts.idleMs / 1000}s
              </span>
            ) : null}
          </CardHeader>
          <CardBody className="space-y-3 overflow-x-auto">
            <p className="text-[12px] text-muted">
              Each agent gets its own MCP child process.{" "}
              <strong className="font-medium text-foreground/80">all</strong> =
              every tool,{" "}
              <strong className="font-medium text-foreground/80">off</strong> =
              blocked.
            </p>
            <table className="w-full min-w-[640px] text-left text-[11px]">
              <thead>
                <tr className="text-muted">
                  <th className="pb-2 pr-3 font-medium">Agent</th>
                  {servers.map((s) => (
                    <th key={s.id} className="pb-2 pr-2 font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((row) => {
                  const agent = permAgents.find((a) => a.id === row.agentId);
                  return (
                    <tr key={row.agentId} className="border-t border-border-subtle">
                      <td className="py-2 pr-3 align-middle">
                        <div className="font-medium text-foreground">
                          {agent?.name || row.agentId}
                        </div>
                        <div className="text-muted">
                          {agent?.toolAccess.join(", ")}
                        </div>
                      </td>
                      {servers.map((s) => {
                        const policy = row.servers[
                          s.id as keyof typeof row.servers
                        ] || { mode: "off" as const, tools: [] };
                        return (
                          <td key={s.id} className="py-2 pr-2 align-middle">
                            <select
                              value={policy.mode}
                              onChange={(e) =>
                                void setPolicy(
                                  row.agentId,
                                  s.id,
                                  e.target.value as McpToolPolicyMode,
                                )
                              }
                              className="rounded-md border border-border bg-panel-elevated px-1.5 py-1 text-[11px]"
                            >
                              {POLICY_MODES.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {timeouts ? (
              <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted">
                {(["connectMs", "callMs", "idleMs"] as const).map((key) => (
                  <label key={key} className="inline-flex items-center gap-1.5">
                    {key.replace("Ms", "")}
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={timeouts[key]}
                      onChange={(e) =>
                        setTimeouts({
                          ...timeouts,
                          [key]: Number(e.target.value) || timeouts[key],
                        })
                      }
                      onBlur={() => timeouts && void saveTimeouts(timeouts)}
                      className="w-24 rounded-md border border-border bg-panel-elevated px-2 py-1 text-foreground"
                    />
                    ms
                  </label>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Call a tool (isolated)</span>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-[11px] text-muted">
                Agent
                <select
                  value={callAgent}
                  onChange={(e) => setCallAgent(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-border bg-panel-elevated px-2 py-1.5 text-sm text-foreground"
                >
                  {permAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[11px] text-muted">
                Server
                <select
                  value={callServer}
                  onChange={(e) => setCallServer(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-border bg-panel-elevated px-2 py-1.5 text-sm text-foreground"
                >
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[11px] text-muted">
                Tool
                <input
                  value={callTool}
                  onChange={(e) => setCallTool(e.target.value)}
                  placeholder="e.g. web_search"
                  className="mt-1 block w-full rounded-md border border-border bg-panel-elevated px-2 py-1.5 text-sm text-foreground"
                />
              </label>
            </div>
            <label className="block space-y-1 text-[11px] text-muted">
              Arguments (JSON)
              <textarea
                value={callArgs}
                onChange={(e) => setCallArgs(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border border-border bg-panel-elevated px-2 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={calling || !callTool.trim()}
              onClick={() => void runCall()}
            >
              {calling ? "Calling…" : "Run isolated call"}
            </Button>
            {callOut ? (
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-black/30 p-3 text-[11px] leading-relaxed text-muted">
                {callOut}
              </pre>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-medium">Audit history</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                await fetch("/api/mcp/audit", { method: "DELETE" });
                await refresh();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          </CardHeader>
          <CardBody>
            {!audit.length ? (
              <p className="text-sm text-muted">
                No MCP calls yet. Discover tools or run an isolated call above.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border">
                {audit.map((e) => (
                  <li key={e.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span>
                        <span className="font-medium">{e.agentId}</span>
                        <span className="text-muted"> → </span>
                        {e.serverId}/{e.tool}
                      </span>
                      <span className="text-[11px] text-muted">
                        {e.status} · {e.durationMs}ms
                        {e.pid ? ` · pid ${e.pid}` : ""} ·{" "}
                        {formatRelative(e.at)}
                      </span>
                    </div>
                    {e.error ? (
                      <p className="mt-1 text-[11px] text-rose-400">{e.error}</p>
                    ) : e.resultPreview ? (
                      <p className="mt-1 line-clamp-2 font-mono text-[10px] text-muted">
                        {e.resultPreview}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {exportJson && (
          <Card>
            <CardHeader>
              <span className="text-sm font-medium">Export preview</span>
            </CardHeader>
            <CardBody>
              <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-black/30 p-3 text-[11px] leading-relaxed text-muted">
                {exportJson}
              </pre>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
