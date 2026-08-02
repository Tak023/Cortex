"use client";

import {
  Check,
  Pause,
  Play,
  UserCheck,
  X,
} from "lucide-react";
import type { Agent, Project, Task, TaskStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn, statusColor } from "@/lib/utils";

const COLUMNS: { key: TaskStatus | "active"; label: string }[] = [
  { key: "pending", label: "Backlog" },
  { key: "active", label: "In Progress" },
  { key: "awaiting_approval", label: "Approval" },
  { key: "completed", label: "Done" },
];

function columnTasks(tasks: Task[], key: string): Task[] {
  if (key === "active") {
    return tasks.filter(
      (t) =>
        t.status === "running" ||
        t.status === "queued" ||
        t.status === "paused",
    );
  }
  if (key === "completed") {
    return tasks.filter(
      (t) => t.status === "completed" || t.status === "approved",
    );
  }
  if (key === "pending") {
    return tasks.filter((t) => t.status === "pending");
  }
  return tasks.filter((t) => t.status === key);
}

export function KanbanBoard({
  project,
  agents,
  onAction,
}: {
  project: Project;
  agents: Agent[];
  onAction: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const tasks = columnTasks(project.tasks, col.key).sort(
          (a, b) => a.order - b.order,
        );
        return (
          <div key={col.key} className="min-w-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">
                {col.label}
              </span>
              <span className="text-xs tabular-nums text-muted">
                {tasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  agent={task.agentId ? agentMap[task.agentId] : undefined}
                  onApprove={() =>
                    onAction("approve", { taskId: task.id })
                  }
                  onReject={() => onAction("reject", { taskId: task.id })}
                />
              ))}
              {tasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  agent,
  onApprove,
  onReject,
}: {
  task: Task;
  agent?: Agent;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-2 !p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{task.title}</div>
            <div className="text-[11px] capitalize text-muted">{task.phase}</div>
          </div>
          <Badge className={statusColor(task.status)}>
            {task.status.replace("_", " ")}
          </Badge>
        </div>
        {agent && (
          <div className="text-xs text-muted">
            <span className="text-foreground/70">{agent.name}</span>
          </div>
        )}
        {task.status === "running" && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <div className="text-[10px] tabular-nums text-muted">
              {task.progress}%
            </div>
          </div>
        )}
        {task.outputSummary && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted">
            {task.outputSummary}
          </p>
        )}
        {task.status === "awaiting_approval" && (
          <div className="flex gap-1.5 pt-1">
            <Button size="sm" variant="success" onClick={onApprove}>
              <Check className="h-3 w-3" /> Approve
            </Button>
            <Button size="sm" variant="danger" onClick={onReject}>
              <X className="h-3 w-3" /> Reject
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function ProjectControls({
  project,
  onAction,
}: {
  project: Project;
  onAction: (action: string) => Promise<unknown>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {project.paused || project.status === "paused" ? (
        <Button size="sm" onClick={() => onAction("resume")}>
          <Play className="h-3.5 w-3.5" /> Resume
        </Button>
      ) : project.status !== "completed" ? (
        <Button size="sm" variant="secondary" onClick={() => onAction("pause")}>
          <Pause className="h-3.5 w-3.5" /> Pause
        </Button>
      ) : null}
      <Badge className={statusColor(project.status)}>
        {project.status === "awaiting_approval" && (
          <UserCheck className="h-3 w-3" />
        )}
        {project.status.replace("_", " ")}
      </Badge>
      <Button
        size="sm"
        onClick={() => onAction("launch_app")}
        title="Start the generated app and open it in the browser"
      >
        Launch app
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction("reveal_workspace")}
        title="Open the on-disk workspace in Finder"
      >
        Open folder
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onAction("export_workspace")}
        title="Write / refresh artifacts on disk"
      >
        Save to disk
      </Button>
      <a href={`/api/export/${project.id}`} download>
        <Button size="sm" variant="ghost">
          Export history
        </Button>
      </a>
    </div>
  );
}

export function DependencyGraph({ project, agents }: { project: Project; agents: Agent[] }) {
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  return (
    <Card>
      <CardHeader>
        <span className="text-sm font-medium">Pipeline graph</span>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-center gap-2">
          {project.tasks
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((task, i) => (
              <div key={task.id} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={cn(
                      "h-px w-6",
                      task.status === "pending"
                        ? "bg-border"
                        : "bg-blue-500/60",
                    )}
                  />
                )}
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 min-w-[7.5rem]",
                    statusColor(task.status),
                  )}
                >
                  <div className="text-xs font-medium">{task.title}</div>
                  <div className="mt-0.5 text-[10px] opacity-80">
                    {task.agentId
                      ? agentMap[task.agentId]?.name ?? "Agent"
                      : "Unassigned"}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </CardBody>
    </Card>
  );
}
