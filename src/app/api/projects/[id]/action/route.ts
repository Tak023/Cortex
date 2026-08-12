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
  retryFailedStage,
} from "@/lib/orchestration/engine";
import { getProject, upsertProject } from "@/lib/store";
import { ensureProjectWorkspace } from "@/lib/workspace";
import { getLaunchInfo, launchProjectApp } from "@/lib/build/launch";
import {
  formatBrowserFindings,
  inspectAppInBrowser,
} from "@/lib/build/browserInspect";
import { nanoid } from "nanoid";

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
      // If the project failed a stage, resume should re-attempt recovery
      const latest = getProject(id) || project;
      if (
        latest.status === "failed" ||
        latest.tasks.some((t) => t.status === "failed")
      ) {
        const updated = retryFailedStage(id);
        return NextResponse.json({
          project: updated,
          message: "Retrying failed stage with automatic recovery…",
        });
      }
      const updated = resumeProject(id);
      return NextResponse.json({ project: updated });
    }
    case "retry_failed_stage": {
      const updated = retryFailedStage(id);
      return NextResponse.json({
        project: updated,
        message: "Retrying failed stage with automatic recovery…",
      });
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
    case "inspect_browser": {
      // Launch app if needed, then capture console/page errors via Chromium
      let latest = getProject(id) || project;
      try {
        // Ensure server is up for non-CLI apps
        if (latest.concept || latest.appPath) {
          const launch = await launchProjectApp(latest);
          latest = launch.project;
          upsertProject(latest);
        }
      } catch (e) {
        console.warn("inspect_browser: launch soft-fail", e);
      }
      latest = getProject(id) || latest;
      const appDir =
        latest.appPath ||
        (latest.workspacePath ? `${latest.workspacePath}/app` : null);
      if (!appDir) {
        return NextResponse.json(
          {
            error: "No app directory to inspect",
            project: latest,
            launch: getLaunchInfo(latest),
          },
          { status: 400 },
        );
      }
      const url =
        latest.launchUrl ||
        getLaunchInfo(latest).launchUrl ||
        "http://127.0.0.1:3456";
      const headed = body.headed === true || body.headed === "1";
      const result = await inspectAppInBrowser({
        appDir,
        url,
        preferStart: true,
        headed,
      });
      const report = formatBrowserFindings(result);
      latest.messages = latest.messages || [];
      latest.messages.push({
        id: `msg-${nanoid(6)}`,
        role: "system",
        content:
          `**Browser inspection** — ${result.summary}\n\n` +
          report +
          (result.findings.length
            ? `\n\nUse these findings to fix runtime errors, then **Retry stage** / **Rebuild app**.`
            : ""),
        createdAt: new Date().toISOString(),
      });
      // Persist as artifact for the Artifacts tab
      const art = {
        id: `art-${nanoid(8)}`,
        name: "browser-inspect.md",
        kind: "test" as const,
        content: `# Browser inspection\n\n${result.summary}\n\n${report}\n`,
        phase: "testing" as const,
        agentId: "system",
        createdAt: new Date().toISOString(),
      };
      latest.artifacts = (latest.artifacts || []).filter(
        (a) => a.name !== "browser-inspect.md",
      );
      latest.artifacts.push(art);
      if (!result.ok && result.findings.length) {
        latest.unresolvedErrors = [
          ...(latest.unresolvedErrors || []).filter(
            (e) => !e.startsWith("[browser "),
          ),
          ...result.findings
            .filter((f) => f.kind === "pageerror" || f.kind === "console")
            .slice(0, 8)
            .map((f) => `[browser ${f.kind}] ${f.message}`),
        ];
      }
      upsertProject(latest);
      return NextResponse.json({
        project: getProject(id),
        launch: getLaunchInfo(latest),
        browser: result,
        message: result.summary,
        openedUrl: url,
      });
    }
    case "open_browser_preview": {
      // Signal only — actual window open is via Electron preload from client
      const latest = getProject(id) || project;
      const url =
        (body.url as string) ||
        latest.launchUrl ||
        getLaunchInfo(latest).launchUrl ||
        "http://127.0.0.1:3456";
      return NextResponse.json({
        project: latest,
        launch: getLaunchInfo(latest),
        url,
        message: `Preview URL ready: ${url}`,
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
