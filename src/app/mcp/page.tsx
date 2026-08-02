"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Plug,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

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
};

export default function McpPage() {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [exportJson, setExportJson] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp");
      const data = (await res.json()) as {
        servers: McpServerRow[];
        exportConfig: unknown;
      };
      setServers(data.servers || []);
      setExportJson(JSON.stringify(data.exportConfig, null, 2));
    } catch {
      setServers([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleServer = async (id: string, enabled: boolean) => {
    await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    await refresh();
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
        description="Model Context Protocol tools for agents — search, scrape, browser, GitHub"
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
                          needs key
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
