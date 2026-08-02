import { NextResponse } from "next/server";
import { deleteProject, getProject, upsertProject } from "@/lib/store";
import { ensureProjectWorkspace } from "@/lib/workspace";
import { stopProjectRunner } from "@/lib/orchestration/engine";
import { getLaunchInfo } from "@/lib/build/launch";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Backfill workspace for projects that finished before disk export existed.
  if (
    (project.status === "completed" || project.status === "failed") &&
    (!project.workspacePath || !project.workspacePath.length)
  ) {
    try {
      project = {
        ...project,
        workspacePath: ensureProjectWorkspace(project),
      };
      upsertProject(project);
    } catch (e) {
      console.error("workspace backfill failed", e);
    }
  }

  const launch = getLaunchInfo(project);
  return NextResponse.json({ project, launch });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Prefer deleting finished projects; allow force for others via ?force=1
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  if (
    !force &&
    project.status !== "completed" &&
    project.status !== "failed" &&
    project.status !== "draft"
  ) {
    return NextResponse.json(
      {
        error:
          "Only completed or failed projects can be deleted (add ?force=1 to override).",
      },
      { status: 400 },
    );
  }

  stopProjectRunner(id);
  const ok = deleteProject(id, { deleteWorkspace: true });
  if (!ok) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
