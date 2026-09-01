"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AgentCard } from "@/components/agents/AgentCard";
import { FleetHealthStrip } from "@/components/agents/FleetHealthStrip";
import { ActivityFeed } from "@/components/orchestration/ActivityFeed";
import {
  useActivity,
  useAgents,
  useFleetHealth,
  useSettings,
} from "@/lib/hooks";
import type { AgentType } from "@/lib/types";

/** Registry ids for the five passthrough CLIs, mapped to their health rows. */
const HEALTH_ID_BY_AGENT: Record<string, string> = {
  "agent-hermes": "hermes",
  "agent-claude-code": "claude-code",
  "agent-codex": "codex",
  "agent-grok": "grok",
  "agent-antigravity": "antigravity",
};

export default function AgentsPage() {
  const { agents, loading, action, refresh } = useAgents(5000);
  const { settings } = useSettings();
  const health = useFleetHealth();
  const showSeeded = settings?.showSeededMetrics ?? true;

  const liveVersionFor = (agentId: string): string | null => {
    const healthId = HEALTH_ID_BY_AGENT[agentId];
    if (!healthId) return null;
    return health.rows.find((r) => r.id === healthId)?.version ?? null;
  };
  const activity = useActivity(25, 5000);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | AgentType>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [jarvisNote, setJarvisNote] = useState<string | null>(null);

  // Keep OpenJarvis agent cards in sync with live connectivity
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/jarvis");
        const data = (await res.json()) as {
          online?: boolean;
          health?: { detail?: string };
        };
        if (cancelled) return;
        setJarvisNote(
          data.online
            ? `OpenJarvis online — ${data.health?.detail || "ready"}`
            : `OpenJarvis offline — ${data.health?.detail || "start jarvis serve"}`,
        );
        await refresh?.();
      } catch {
        if (!cancelled) setJarvisNote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const roles = useMemo(() => {
    const s = new Set<string>();
    agents.forEach((a) => a.roles.forEach((r) => s.add(r)));
    return Array.from(s).sort();
  }, [agents]);

  const filtered = agents.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (roleFilter !== "all" && !a.roles.includes(roleFilter as never))
      return false;
    if (!q.trim()) return true;
    const hay = `${a.name} ${a.description} ${a.roles.join(" ")} ${a.capabilities.join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const cloud = filtered.filter((a) => a.type === "cloud");
  const local = filtered.filter((a) => a.type === "local");

  return (
    <>
      <PageHeader
        title="Agents & Models"
        description="Installed agents with status, capabilities, and quick controls"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5">
          <FleetHealthStrip
            rows={health.rows}
            loading={health.loading}
            error={health.error}
            onRefresh={() => void health.refresh()}
          />
        </div>
        {jarvisNote && (
          <div className="mb-4 rounded-xl border border-border bg-panel-elevated/60 px-4 py-2.5 text-xs text-muted">
            <span className="font-medium text-foreground/85">OpenJarvis · </span>
            {jarvisNote}
            <span className="text-muted"> — configure in Settings</span>
          </div>
        )}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search agents…"
              className="w-full rounded-lg border border-border bg-panel-elevated py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500/50"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "all" | AgentType)
            }
            className="rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none"
          >
            <option value="all">All types</option>
            <option value="cloud">Cloud</option>
            <option value="local">Local</option>
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-border bg-panel-elevated px-3 py-2 text-sm outline-none"
          >
            <option value="all">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-6 xl:grid-cols-4">
          <div className="space-y-6 xl:col-span-3">
            {loading && (
              <p className="text-sm text-muted">Loading agents…</p>
            )}
            {local.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Local · on-device
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {local.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      onAction={action}
                      showSeededMetrics={showSeeded}
                      liveVersion={liveVersionFor(a.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {cloud.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Cloud · hybrid
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {cloud.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      onAction={action}
                      showSeededMetrics={showSeeded}
                      liveVersion={liveVersionFor(a.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {!loading && filtered.length === 0 && (
              <p className="text-sm text-muted">No agents match your filters.</p>
            )}
          </div>
          <div>
            <ActivityFeed
              activity={activity}
              title="Agent activity"
              maxHeight="max-h-[70vh]"
            />
          </div>
        </div>
      </div>
    </>
  );
}
