"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Network,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  DependencyGraph,
  KanbanBoard,
  ProjectControls,
} from "@/components/projects/KanbanBoard";
import { LaunchPanel } from "@/components/projects/LaunchPanel";
import { ActivityFeed } from "@/components/orchestration/ActivityFeed";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useActivity, useAgents, useProject } from "@/lib/hooks";
import { formatRelative } from "@/lib/utils";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { project, loading, action } = useProject(id, 2500);
  const { agents } = useAgents(6000);
  const activity = useActivity(40, 4000).filter((a) => a.projectId === id);
  const [tab, setTab] = useState<"kanban" | "memory" | "chat" | "artifacts">(
    "kanban",
  );

  if (loading && !project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Loading project…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">Project not found</p>
        <Link href="/projects" className="text-sm text-accent hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.concept.summary}
        actions={<ProjectControls project={project} onAction={action} />}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Launch path scrolls with the page (not sticky — tall panel was covering kanban) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Projects
            </Link>
            <span className="text-muted">·</span>
            {project.concept.stack.map((s) => (
              <Badge
                key={s}
                className="border-border bg-panel-elevated text-muted"
              >
                {s}
              </Badge>
            ))}
            {project.buildStatus === "passed" && (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                build/test passed
              </Badge>
            )}
            {project.buildStatus === "failed" && (
              <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300">
                build/test failed
              </Badge>
            )}
          </div>

          {project.status === "failed" &&
            ((project.unresolvedErrors &&
              project.unresolvedErrors.length > 0) ||
              (project.resolutionGuide &&
                project.resolutionGuide.length > 0)) && (
              <Card className="border-rose-500/40 bg-rose-500/10">
                <CardBody className="space-y-3">
                  <p className="text-sm font-medium text-rose-200">
                    Cortex could not auto-resolve — project not complete
                  </p>
                  {project.unresolvedErrors &&
                    project.unresolvedErrors.length > 0 && (
                      <ul className="list-disc space-y-1 pl-4 text-xs text-rose-100/90">
                        {project.unresolvedErrors.slice(0, 12).map((e) => (
                          <li key={e} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  {project.resolutionGuide &&
                    project.resolutionGuide.length > 0 && (
                      <div className="space-y-1.5 rounded-md border border-rose-400/20 bg-black/20 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-100/90">
                          How to resolve
                        </p>
                        <div className="space-y-1 text-xs text-rose-50/90">
                          {project.resolutionGuide.map((step, i) => (
                            <p
                              key={i}
                              className="break-words whitespace-pre-wrap"
                            >
                              {step}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  <p className="text-[11px] text-muted">
                    Full logs: Artifacts → <code>build-test-report.md</code> /{" "}
                    <code>resolution-guide.md</code>. After fixing, use{" "}
                    <strong>Rebuild app</strong> or re-run the pipeline.
                  </p>
                </CardBody>
              </Card>
            )}

          <LaunchPanel project={project} onAction={action} />
        </div>

        <DependencyGraph project={project} agents={agents} />

        <div className="flex gap-1 border-b border-border-subtle">
          {(
            [
              ["kanban", "Kanban", Network],
              ["memory", "Shared memory", FileText],
              ["artifacts", "Artifacts", FileText],
              ["chat", "Conversation", MessageSquare],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === key
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-4">
          <div className="xl:col-span-3 min-w-0">
            {tab === "kanban" && (
              <KanbanBoard
                project={project}
                agents={agents}
                onAction={action}
              />
            )}
            {tab === "memory" && (
              <div className="space-y-3">
                {Object.keys(project.sharedMemory).length === 0 && (
                  <p className="text-sm text-muted">
                    Shared memory fills as agents complete phases.
                  </p>
                )}
                {Object.entries(project.sharedMemory).map(([key, value]) => (
                  <Card key={key}>
                    <CardHeader>
                      <span className="font-mono text-xs text-accent">{key}</span>
                    </CardHeader>
                    <CardBody>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
                        {value}
                      </pre>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
            {tab === "artifacts" && (
              <div className="space-y-3">
                {project.artifacts.length === 0 && (
                  <p className="text-sm text-muted">No artifacts yet.</p>
                )}
                {project.artifacts.map((art) => (
                  <Card key={art.id}>
                    <CardHeader>
                      <span className="text-sm font-medium">{art.name}</span>
                      <span className="text-[11px] text-muted">
                        {art.phase} · {formatRelative(art.createdAt)}
                      </span>
                    </CardHeader>
                    <CardBody>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
                        {art.content}
                      </pre>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
            {tab === "chat" && (
              <Card>
                <CardBody className="space-y-3 max-h-[32rem] overflow-y-auto">
                  {project.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "border-violet-500/20 bg-violet-500/5"
                          : m.role === "agent"
                            ? "border-sky-500/20 bg-sky-500/5"
                            : "border-border-subtle bg-panel-elevated/50"
                      }`}
                    >
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">
                        {m.role}
                        {m.agentId
                          ? ` · ${agents.find((a) => a.id === m.agentId)?.name ?? m.agentId}`
                          : ""}{" "}
                        · {formatRelative(m.createdAt)}
                      </div>
                      <div className="text-xs leading-relaxed whitespace-pre-wrap">
                        {m.content.replace(/\*\*/g, "")}
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}
          </div>
          <div>
            <ActivityFeed
              activity={activity}
              title="Project activity"
              maxHeight="max-h-[70vh]"
            />
          </div>
        </div>
      </div>
    </>
  );
}
