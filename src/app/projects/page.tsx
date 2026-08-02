"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, FolderKanban, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useProjects } from "@/lib/hooks";
import { formatRelative, statusColor } from "@/lib/utils";

export default function ProjectsPage() {
  const { projects, loading, remove, refresh } = useProjects(5000);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Delete project “${name}”?\n\nThis removes it from Cortex and deletes its workspace files on disk.`,
      )
    ) {
      return;
    }
    setDeleting(id);
    setErr(null);
    try {
      await remove(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each selected concept becomes a workspace with pipeline, build/test, and browser launch"
        actions={
          <Link href="/ideas">
            <Button size="sm">
              New from idea <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {err && (
          <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </p>
        )}
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && projects.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center py-16 text-center">
              <FolderKanban className="mb-3 h-10 w-10 text-muted" />
              <p className="text-sm text-muted">
                No projects yet. Generate concepts from an idea and select one.
              </p>
              <Link href="/ideas" className="mt-4">
                <Button>Go to Ideas</Button>
              </Link>
            </CardBody>
          </Card>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const done = p.tasks.filter(
              (t) => t.status === "completed" || t.status === "approved",
            ).length;
            const pct = Math.round((done / Math.max(p.tasks.length, 1)) * 100);
            const canDelete =
              p.status === "completed" ||
              p.status === "failed" ||
              p.status === "draft";
            return (
              <Card
                key={p.id}
                className="h-full transition-colors hover:border-blue-500/40"
              >
                <CardBody className="space-y-3">
                  <Link href={`/projects/${p.id}`} className="block space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium leading-snug">{p.name}</h3>
                      <Badge className={statusColor(p.status)}>
                        {p.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">
                      {p.concept.summary}
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted">
                      <span>
                        {done}/{p.tasks.length} phases ·{" "}
                        {p.artifacts.length} artifacts
                      </span>
                      <span>{formatRelative(p.updatedAt)}</span>
                    </div>
                    {p.buildStatus === "passed" && (
                      <p className="text-[11px] text-emerald-400/90">
                        Build &amp; test passed · open to launch in browser
                      </p>
                    )}
                    {p.buildStatus === "failed" && (
                      <p className="text-[11px] text-rose-400/90">
                        Build/test failed — open for error details
                      </p>
                    )}
                    {p.status === "completed" && !p.buildStatus && (
                      <p className="text-[11px] text-emerald-400/90">
                        Completed — open for launch
                      </p>
                    )}
                    {p.unresolvedErrors && p.unresolvedErrors.length > 0 && (
                      <p className="line-clamp-2 text-[11px] text-rose-300/90">
                        {p.unresolvedErrors[0]}
                      </p>
                    )}
                  </Link>

                  <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                    <Link href={`/projects/${p.id}`}>
                      <Button size="sm" variant="secondary">
                        Open
                      </Button>
                    </Link>
                    {(p.launchUrl || p.status === "completed") && (
                      <Link href={`/projects/${p.id}`}>
                        <Button size="sm" variant="ghost">
                          <ExternalLink className="h-3.5 w-3.5" /> Browser
                        </Button>
                      </Link>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={deleting === p.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleDelete(p.id, p.name);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deleting === p.id ? "Deleting…" : "Delete"}
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
