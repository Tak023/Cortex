"use client";

import type { ActivityEvent } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";

const typeColor: Record<string, string> = {
  task_start: "bg-sky-400",
  task_complete: "bg-emerald-400",
  handoff: "bg-violet-400",
  approval_needed: "bg-amber-400",
  approval_resolved: "bg-emerald-400",
  concept_generated: "bg-blue-400",
  project_created: "bg-cyan-400",
  agent_status: "bg-slate-400",
  error: "bg-rose-400",
  info: "bg-slate-500",
};

export function ActivityFeed({
  activity,
  title = "Activity feed",
  maxHeight = "max-h-96",
}: {
  activity: ActivityEvent[];
  title?: string;
  maxHeight?: string;
}) {
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader>
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted">{activity.length}</span>
      </CardHeader>
      <CardBody className={cn("overflow-y-auto space-y-0 !pt-2", maxHeight)}>
        {activity.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">No activity yet</p>
        )}
        {activity.map((evt) => (
          <div
            key={evt.id}
            className="flex gap-3 border-b border-border-subtle py-2.5 last:border-0"
          >
            <div className="mt-1.5">
              <span
                className={cn(
                  "block h-2 w-2 rounded-full",
                  typeColor[evt.type] || "bg-slate-500",
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-foreground/90">
                {evt.message}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {formatRelative(evt.createdAt)} · {evt.type.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
