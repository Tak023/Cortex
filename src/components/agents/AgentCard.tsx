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
import { cn, formatTokens, statusColor } from "@/lib/utils";

export function AgentCard({
  agent,
  onAction,
}: {
  agent: Agent;
  onAction: (id: string, action: string) => void;
}) {
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
                {agent.model || agent.slug}
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

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border-subtle bg-panel-elevated/50 px-2 py-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Tokens
            </div>
            <div className="text-xs font-medium tabular-nums">
              {formatTokens(agent.metrics.tokensUsed)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Latency
            </div>
            <div className="text-xs font-medium tabular-nums">
              {agent.metrics.avgLatencyMs}ms
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Success
            </div>
            <div className="text-xs font-medium tabular-nums">
              {Math.round(agent.metrics.successRate * 100)}%
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
