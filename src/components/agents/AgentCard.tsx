"use client";

import {
  Cloud,
  Cpu,
  MessageSquare,
  Play,
  RotateCcw,
  ScrollText,
  Square,
} from "lucide-react";
import type { Agent } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn, formatTokens, metricProvenance, statusColor } from "@/lib/utils";

export function AgentCard({
  agent,
  onAction,
  showSeededMetrics = true,
  liveVersion,
}: {
  agent: Agent;
  onAction: (id: string, action: string) => void;
  /** When false, unmeasured tiles render "—" instead of a placeholder number. */
  showSeededMetrics?: boolean;
  /**
   * `bin --version` read from the installed CLI. For passthrough agents the
   * model is chosen inside the CLI's own config, so Cortex's stored string is
   * a preference, not the truth — the live version is shown beside it.
   */
  liveVersion?: string | null;
}) {
  const prov = metricProvenance(agent.metrics.source, showSeededMetrics);
  const value = (formatted: string) => (prov.render ? formatted : "—");
  return (
    <Card className="group overflow-hidden transition-colors hover:border-blue-500/30">
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg border",
                agent.type === "cloud"
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
              )}
            >
              {agent.type === "cloud" ? (
                <Cloud className="h-4.5 w-4.5" />
              ) : (
                <Cpu className="h-4.5 w-4.5" />
              )}
            </div>
            <div>
              <div className="font-medium leading-tight">{agent.name}</div>
              <div className="mt-0.5 text-xs text-muted">
                <span
                  title={
                    liveVersion
                      ? "Configured in Cortex. The CLI's own config decides the model it actually runs."
                      : undefined
                  }
                  className={liveVersion ? "opacity-70" : undefined}
                >
                  {agent.model || agent.slug}
                </span>
                {liveVersion ? (
                  <span
                    className="ml-1.5 text-foreground/70"
                    title="Read live from the installed CLI"
                  >
                    · {liveVersion}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <Badge className={statusColor(agent.status)}>
            {(agent.status === "busy" || agent.status === "online") && (
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />
            )}
            {agent.status}
          </Badge>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted">
          {agent.description}
        </p>

        <div className="flex flex-wrap gap-1">
          {agent.roles.map((r) => (
            <Badge
              key={r}
              className="border-border bg-panel-elevated text-muted"
            >
              {r}
            </Badge>
          ))}
          <Badge
            className={
              agent.type === "cloud"
                ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            }
          >
            {agent.type}
          </Badge>
        </div>

        {agent.currentTaskLabel && (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2 text-xs text-sky-200">
            <span className="text-muted">Working: </span>
            {agent.currentTaskLabel}
          </div>
        )}

        <div
          className="relative grid grid-cols-3 gap-2 rounded-lg border border-border-subtle bg-panel-elevated/50 px-2 py-2 text-center"
          title={prov.title}
        >
          {prov.chip ? (
            <span className="absolute right-1.5 top-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[9px] uppercase tracking-wider text-amber-300/90">
              {prov.chip}
            </span>
          ) : null}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Tokens
            </div>
            <div className={cn("text-xs font-medium tabular-nums", prov.className)}>
              {value(formatTokens(agent.metrics.tokensUsed))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Latency
            </div>
            <div className={cn("text-xs font-medium tabular-nums", prov.className)}>
              {value(`${agent.metrics.avgLatencyMs}ms`)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Success
            </div>
            <div className={cn("text-xs font-medium tabular-nums", prov.className)}>
              {value(`${Math.round(agent.metrics.successRate * 100)}%`)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction(agent.id, "start")}
            title="Start"
          >
            <Play className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction(agent.id, "stop")}
            title="Stop"
          >
            <Square className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction(agent.id, "restart")}
            title="Restart"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" title="Open chat (soon)">
            <MessageSquare className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" title="View logs (soon)">
            <ScrollText className="h-3 w-3" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
