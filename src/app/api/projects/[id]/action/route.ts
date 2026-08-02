import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  approveTask,
  pauseProject,
  reassignTask,
  rebuildProjectApp,
  rejectTask,
  resumeProject,
} from "@/lib/orchestration/engine";
import { getProject, upsertProject } from "@/lib/store";
import { ensureProjectWorkspace } from "@/lib/workspace";
import { getLaunchInfo, launchProjectApp } from "@/lib/build/launch";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await req.json();
  const action = body.action as string;

  switch (action) {
    case "approve": {
      const updated = approveTask(id, body.taskId);
      return NextResponse.json({ project: updated });
    }
    case "reject": {
      const updated = rejectTask(id, body.taskId, body.reason);
      return NextResponse.json({ project: updated });
    }
    case "pause": {
      const updated = pauseProject(id);
      return NextResponse.json({ project: updated });
    }
    case "resume": {
      const updated = resumeProject(id);
      return NextResponse.json({ project: updated });
    }
    case "reassign": {
      const updated = reassignTask(id, body.taskId, body.agentId);
      return NextResponse.json({ project: updated });
    }
    case "rebuild_app": {
      const updated = await rebuildProjectApp(id);
      return NextResponse.json({
        project: updated,
        workspacePath: updated?.workspacePath,
        launch: updated ? getLaunchInfo(updated) : null,
        message:
          "App source scaffolded. Click Launch app to start it in the browser.",
      });
    }
    case "launch_app": {
      try {
        const result = await launchProjectApp(project);
        upsertProject(result.project);
        return NextResponse.json({
          project: result.project,
          launch: result.info,
          started: result.started,
          openedUrl: result.openedUrl,
          message: result.message,
          logFile: result.logFile,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error: msg,
            message: msg,
            project: getProject(id),
            launch: getLaunchInfo(project),
            started: false,
          },
          { status: 500 },
        );
      }
    }
    case "launch_info": {
      const latest = getProject(id) || project;
      return NextResponse.json({
        project: latest,
        launch: getLaunchInfo(latest),
      });
    }
    case "export_workspace": {
      const workspacePath = ensureProjectWorkspace(project);
      const updated = { ...project, workspacePath };
      upsertProject(updated);
      return NextResponse.json({ project: updated, workspacePath });
    }
    case "reveal_workspace": {
      const workspacePath =
        project.workspacePath || ensureProjectWorkspace(project);
      if (!project.workspacePath) {
        upsertProject({ ...project, workspacePath });
      }
      try {
        // macOS: reveal in Finder. Linux: open folder. Windows: explorer.
        if (process.platform === "darwin") {
          await execFileAsync("open", [workspacePath]);
        } else if (process.platform === "win32") {
          await execFileAsync("explorer", [workspacePath]);
        } else {
          await execFileAsync("xdg-open", [workspacePath]);
        }
      } catch (e) {
        console.error("reveal failed", e);
        return NextResponse.json(
          {
            error: "Could not open folder automatically",
            workspacePath,
            project: getProject(id),
          },
          { status: 500 },
        );
      }
      return NextResponse.json({
        project: getProject(id),
        workspacePath,
        opened: true,
      });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
