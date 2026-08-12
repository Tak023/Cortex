import { nanoid } from "nanoid";
import type { Project, Task } from "../types";
import {
  getProject,
  getSettings,
  getState,
  pushActivity,
  pushUsage,
  updateAgent,
  upsertProject,
} from "../store";
import { synthesizePhaseOutput } from "../ai/client";
import { routeAgent } from "../agents/router";
import {
  invokeAgent,
  isJarvisAgent,
} from "../agents/adapters";
import { ensureProjectWorkspace } from "../workspace";
import { scaffoldAppFromConcept } from "../build/scaffold";
import { getLaunchInfo } from "../build/launch";
import { verifyAppBuild } from "../build/verify";

/** In-process timers keyed by project id */
const runners = new Map<string, ReturnType<typeof setInterval>>();
/** Tasks currently doing async work (e.g. scaffolding) — avoid double-firing */
const asyncBusy = new Set<string>();

/** Default automatic recovery attempts per pipeline phase */
const DEFAULT_MAX_RETRIES: Record<string, number> = {
  research: 2,
  planning: 2,
  architecture: 2,
  implementation: 3,
  testing: 3,
  polish: 2,
};

function maxRetriesFor(task: Task): number {
  return task.maxRetries ?? DEFAULT_MAX_RETRIES[task.phase] ?? 2;
}

/**
 * Re-queue a failed stage so the runner can try again.
 * Returns true if recovery was scheduled.
 */
function scheduleStageRecovery(
  project: Project,
  task: Task,
  error: string,
  recoveryNote: string,
): boolean {
  const used = task.retryCount ?? 0;
  const max = maxRetriesFor(task);
  if (used >= max) return false;

  task.retryCount = used + 1;
  task.lastError = error;
  task.status = "queued";
  task.progress = 0;
  task.completedAt = null;
  task.outputSummary = null;
  project.status = "running";
  project.paused = false;
  project.buildStatus =
    task.phase === "testing" || task.phase === "implementation"
      ? "pending"
      : project.buildStatus;
  project.updatedAt = new Date().toISOString();

  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content:
      `**${task.title} failed — auto-recovering** (attempt ${task.retryCount}/${max}).\n\n` +
      `Error: ${error.slice(0, 400)}\n\n` +
      `${recoveryNote}`,
    createdAt: new Date().toISOString(),
  });

  if (task.agentId) {
    updateAgent(task.agentId, {
      status: "idle",
      currentTaskId: null,
      currentTaskLabel: null,
    });
  }

  upsertProject(project);
  pushActivity({
    type: "info",
    message: `Auto-recovering ${task.title} (attempt ${task.retryCount}/${max}): ${error.slice(0, 120)}`,
    projectId: project.id,
    taskId: task.id,
    agentId: task.agentId ?? undefined,
  });

  // Keep runner alive so the re-queued task starts
  startProjectRunner(project.id);
  return true;
}

/**
 * Mark a stage (and project) as failed with human-readable fix instructions.
 */
function failStageWithGuide(
  project: Project,
  task: Task,
  errors: string[],
  guide: string[],
  summary: string,
) {
  task.status = "failed";
  task.progress = 100;
  task.completedAt = new Date().toISOString();
  task.outputSummary = summary;
  task.lastError = errors[0] ?? summary;
  project.status = "failed";
  project.unresolvedErrors = errors;
  project.resolutionGuide = guide;
  if (task.phase === "testing" || task.phase === "implementation") {
    project.buildStatus = "failed";
  }
  project.updatedAt = new Date().toISOString();

  const guideMd =
    guide.length > 0
      ? `\n\n### How to resolve\n\n${guide.map((g) => (g.startsWith("```") || g.startsWith("**") || g.startsWith("#") ? g : `- ${g}`)).join("\n")}`
      : "";

  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content:
      `**Unable to auto-resolve ${task.title}** after ${task.retryCount ?? 0} recovery attempt(s).\n\n` +
      `### Errors\n${errors.map((e) => `- ${e}`).join("\n")}` +
      guideMd,
    createdAt: new Date().toISOString(),
  });

  // Persist a resolution artifact for the Artifacts tab
  const resolutionArtifact = {
    id: `art-${nanoid(8)}`,
    name: "resolution-guide.md",
    kind: "note" as const,
    content:
      `# Resolution guide — ${task.title}\n\n` +
      `**Phase:** ${task.phase}\n` +
      `**Recovery attempts:** ${task.retryCount ?? 0}/${maxRetriesFor(task)}\n\n` +
      `## Errors\n${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
      `## How to resolve\n\n${guide.join("\n\n")}\n`,
    phase: task.phase,
    agentId: task.agentId ?? "system",
    createdAt: new Date().toISOString(),
  };
  project.artifacts = project.artifacts.filter(
    (a) => a.name !== "resolution-guide.md",
  );
  project.artifacts.push(resolutionArtifact);
  task.artifacts = task.artifacts.filter((a) => a.name !== "resolution-guide.md");
  task.artifacts.push(resolutionArtifact);

  if (task.agentId) {
    updateAgent(task.agentId, {
      status: "idle",
      currentTaskId: null,
      currentTaskLabel: null,
    });
  }

  upsertProject(project);
  pushActivity({
    type: "error",
    message: `Could not auto-resolve ${task.title}: ${errors[0] ?? summary}`,
    projectId: project.id,
    taskId: task.id,
  });
  stopProjectRunner(project.id);
  releaseAgents(project);
}

export function isProjectRunning(projectId: string): boolean {
  return runners.has(projectId);
}

export function startProjectRunner(projectId: string) {
  if (runners.has(projectId)) return;
  const speed = getSettings().simulationSpeedMs || 1800;

  const timer = setInterval(() => {
    try {
      tickProject(projectId);
    } catch (e) {
      console.error("tick error", e);
    }
  }, speed);

  runners.set(projectId, timer);
  // Immediate first tick
  setTimeout(() => tickProject(projectId), 200);
}

export function stopProjectRunner(projectId: string) {
  const t = runners.get(projectId);
  if (t) {
    clearInterval(t);
    runners.delete(projectId);
  }
}

export function stopAllRunners() {
  for (const [id, t] of runners) {
    clearInterval(t);
    runners.delete(id);
  }
}

function tickProject(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    stopProjectRunner(projectId);
    return;
  }

  if (project.paused || project.status === "paused") {
    return;
  }

  if (project.status === "completed" || project.status === "failed") {
    stopProjectRunner(projectId);
    releaseAgents(project);
    return;
  }

  // If any task awaits approval, pause progression
  const awaiting = project.tasks.find((t) => t.status === "awaiting_approval");
  if (awaiting) {
    if (project.status !== "awaiting_approval") {
      project.status = "awaiting_approval";
      project.updatedAt = new Date().toISOString();
      upsertProject(project);
    }
    if (getSettings().autoApprove) {
      approveTask(projectId, awaiting.id);
    }
    return;
  }

  // Progress running task
  const running = project.tasks.find((t) => t.status === "running");
  if (running) {
    advanceRunningTask(project, running);
    return;
  }

  // Start next ready task
  const next = project.tasks
    .filter((t) => t.status === "queued" || t.status === "pending")
    .sort((a, b) => a.order - b.order)
    .find((t) =>
      t.dependsOn.every((dep) => {
        const d = project.tasks.find((x) => x.id === dep);
        return d?.status === "completed" || d?.status === "approved";
      }),
    );

  if (!next) {
    const anyFailed = project.tasks.some((t) => t.status === "failed");
    const allTerminal = project.tasks.every(
      (t) =>
        t.status === "completed" ||
        t.status === "approved" ||
        t.status === "rejected" ||
        t.status === "failed",
    );
    if (allTerminal) {
      // Never mark complete if build/test failed with unresolved errors
      if (anyFailed || project.buildStatus === "failed") {
        project.status = "failed";
        project.updatedAt = new Date().toISOString();
        try {
          project.workspacePath = ensureProjectWorkspace(project);
        } catch {
          /* ignore */
        }
        const errs = project.unresolvedErrors ?? [];
        const guide = project.resolutionGuide ?? [];
        // Avoid duplicate terminal messages if failStageWithGuide already notified
        const alreadyNotified = project.messages.some((m) =>
          m.content.includes("Unable to auto-resolve"),
        );
        if (!alreadyNotified) {
          project.messages.push({
            id: `msg-${nanoid(6)}`,
            role: "system",
            content:
              `**Pipeline stopped — unresolved errors.**\n\n` +
              (errs.length
                ? errs.map((e) => `- ${e}`).join("\n")
                : "- See testing artifacts for details.") +
              (guide.length
                ? `\n\n### How to resolve\n\n${guide.map((g) => (g.startsWith("```") || g.startsWith("**") ? g : `- ${g}`)).join("\n")}`
                : `\n\nCortex attempted automatic fixes but could not clear all issues. ` +
                  `Open **Artifacts → build-test-report.md** / **resolution-guide.md**, fix the app under \`app/\`, then use **Rebuild app** / **Launch app**.`),
            createdAt: new Date().toISOString(),
          });
        }
        upsertProject(project);
        releaseAgents(project);
        pushActivity({
          type: "error",
          message: `Project "${project.name}" failed — unresolved build/test errors`,
          projectId: project.id,
        });
        stopProjectRunner(projectId);
        return;
      }

      const allDone = project.tasks.every(
        (t) =>
          t.status === "completed" ||
          t.status === "approved" ||
          t.status === "rejected",
      );
      if (allDone) {
        project.status = "completed";
        project.buildStatus = project.buildStatus ?? "passed";
        project.updatedAt = new Date().toISOString();
        try {
          project.workspacePath = ensureProjectWorkspace(project);
        } catch (e) {
          console.error("workspace export failed", e);
        }
        upsertProject(project);
        releaseAgents(project);
        pushActivity({
          type: "task_complete",
          message: project.workspacePath
            ? `Project "${project.name}" completed (build/test passed). Launch from Projects.`
            : `Project "${project.name}" completed — all pipeline phases done.`,
          projectId: project.id,
        });
        const launch = getLaunchInfo(project);
        if (launch.appPath) {
          project.appPath = launch.appPath;
          project.launchUrl = launch.launchUrl;
          project.launchCommand = launch.launchCommand;
        }
        project.messages.push({
          id: `msg-${nanoid(6)}`,
          role: "system",
          content: launch.appExists
            ? `**Pipeline complete — build & test passed.**\n\n` +
              `### Launch in browser\n` +
              `1. Click **Launch app**\n` +
              `2. Browser: ${launch.launchUrl ?? "local URL"}\n` +
              `3. Terminal: \`${launch.launchCommand}\`\n\n` +
              `**App:** \`${launch.appPath}\``
            : `**Pipeline complete.** Click **Build & launch** to scaffold and open the app.`,
          createdAt: new Date().toISOString(),
        });
        upsertProject(project);
        stopProjectRunner(projectId);
      }
    }
    return;
  }

  startTask(project, next);
}

function startTask(project: Project, task: Task) {
  const agents = getState().agents;
  let agentId = task.agentId;

  // Re-route if agent missing or offline
  if (!agentId || agents.find((a) => a.id === agentId)?.status === "error") {
    const agent = routeAgent(agents, task.phase);
    agentId = agent?.id ?? null;
    task.agentId = agentId;
  }

  task.status = "running";
  task.progress = 5;
  task.startedAt = new Date().toISOString();
  project.status = "running";
  project.updatedAt = new Date().toISOString();

  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "agent",
    agentId: agentId ?? undefined,
    content: `Starting **${task.title}** (${task.phase}).`,
    createdAt: new Date().toISOString(),
  });

  if (agentId) {
    updateAgent(agentId, {
      status: "busy",
      currentTaskId: task.id,
      currentTaskLabel: `${project.name} · ${task.title}`,
    });
  }

  upsertProject(project);
  pushActivity({
    type: "task_start",
    message: `${agentName(agentId)} started ${task.title} on "${project.name}"`,
    agentId: agentId ?? undefined,
    projectId: project.id,
    taskId: task.id,
  });
}

function advanceRunningTask(project: Project, task: Task) {
  // Implementation phase: scaffold a real app (async)
  if (task.phase === "implementation" && task.progress < 100) {
    if (asyncBusy.has(task.id)) {
      task.progress = Math.min(95, task.progress + 3);
      project.updatedAt = new Date().toISOString();
      upsertProject(project);
      return;
    }
    asyncBusy.add(task.id);
    task.progress = Math.max(task.progress, 15);
    project.updatedAt = new Date().toISOString();
    upsertProject(project);

    void (async () => {
      try {
        await runImplementationBuild(project.id, task.id);
      } finally {
        asyncBusy.delete(task.id);
      }
    })();
    return;
  }

  // Testing phase: real npm build + test with auto-fix retries
  if (task.phase === "testing" && task.progress < 100) {
    if (asyncBusy.has(task.id)) {
      task.progress = Math.min(95, task.progress + 2);
      project.updatedAt = new Date().toISOString();
      upsertProject(project);
      return;
    }
    asyncBusy.add(task.id);
    task.progress = Math.max(task.progress, 10);
    project.updatedAt = new Date().toISOString();
    upsertProject(project);

    void (async () => {
      try {
        await runTestingVerify(project.id, task.id);
      } finally {
        asyncBusy.delete(task.id);
      }
    })();
    return;
  }

  const step = 12 + Math.floor(Math.random() * 18);
  task.progress = Math.min(100, task.progress + step);
  project.updatedAt = new Date().toISOString();

  if (task.progress < 100) {
    upsertProject(project);
    return;
  }

  finalizePhaseWithDocs(project, task);
}

async function runImplementationBuild(projectId: string, taskId: string) {
  const project = getProject(projectId);
  if (!project) return;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running") return;

  pushActivity({
    type: "info",
    message: `Scaffolding real app source for "${project.name}"…`,
    projectId,
    taskId,
    agentId: task.agentId ?? undefined,
  });

  try {
    const result = await scaffoldAppFromConcept(project, { runInstall: true });
    project.workspacePath = ensureProjectWorkspace(project);
    // Re-export so app/ is included after scaffold
    project.workspacePath = ensureProjectWorkspace(project);

    // Do not hand off a broken tree to Testing
    if (!result.installOk || result.buildOk === false) {
      const detail =
        (!result.installOk
          ? `npm install failed:\n${result.installLog}`
          : `build smoke failed:\n${result.buildLog || ""}`) + "";
      const p = getProject(projectId);
      if (!p) return;
      const t = p.tasks.find((x) => x.id === taskId);
      if (!t) return;
      const recovered = scheduleStageRecovery(
        p,
        t,
        detail.slice(0, 400),
        "Re-scaffolding app with clean install + build smoke before Testing.",
      );
      if (recovered) return;
      failStageWithGuide(
        p,
        t,
        [detail.slice(0, 500)],
        [
          `Open \`${result.appDir}\``,
          "```bash",
          `cd "${result.appDir}"`,
          "rm -rf .next node_modules package-lock.json",
          "npm install",
          "npx next build",
          "```",
          "Then click **Rebuild app** or **Retry stage** in Cortex.",
        ],
        `Implementation did not produce a buildable app`,
      );
      return;
    }

    const fileList = result.filesWritten.map((f) => `- \`app/${f}\``).join("\n");
    const content = `# Implementation — real app scaffolded

## Summary
${result.summary}

## App directory
\`${result.appDir}\`

## Run the app
\`\`\`bash
${result.runHint}
\`\`\`

## Files written (${result.filesWritten.length})
${fileList}

## npm install
${result.installOk ? "Succeeded." : "Needs attention:"}

\`\`\`
${result.installLog.slice(0, 1500)}
\`\`\`

## Build smoke
${result.buildOk ? "Succeeded." : "Needs attention:"}

\`\`\`
${(result.buildLog || "").slice(0, 1500)}
\`\`\`

## Concept
${project.concept.summary}
`;

    const artifact = {
      id: `art-${nanoid(8)}`,
      name: "implementation.md",
      kind: "code" as const,
      content,
      phase: "implementation" as const,
      agentId: task.agentId ?? "system",
      createdAt: new Date().toISOString(),
    };

    // refresh project ref
    const p = getProject(projectId);
    if (!p) return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return;

    // Drop prior implementation docs if re-running
    p.artifacts = p.artifacts.filter(
      (a) => !(a.phase === "implementation" && a.name === "implementation.md"),
    );
    t.artifacts = t.artifacts.filter((a) => a.name !== "implementation.md");
    t.artifacts.push(artifact);
    p.artifacts.push(artifact);
    p.sharedMemory.implementation = content;
    p.workspacePath = ensureProjectWorkspace(p);
    p.appPath = result.appDir;
    p.launchCommand = result.runHint;
    const urlMatch = result.runHint.match(/http:\/\/[^\s#]+/);
    p.launchUrl = urlMatch?.[0] ?? "http://127.0.0.1:3456";
    p.buildStatus = "pending";
    t.outputSummary = result.summary;
    t.completedAt = new Date().toISOString();
    t.progress = 100;

    p.messages.push({
      id: `msg-${nanoid(6)}`,
      role: "agent",
      agentId: t.agentId ?? undefined,
      content:
        `**App scaffolded & build smoke passed.**\n\n` +
        `1. Click **Launch app** on this project page\n` +
        `2. Or Terminal:\n\`\`\`\n${result.runHint}\n\`\`\`\n` +
        `3. Folder: \`${result.appDir}\`\n\n` +
        `Testing will run Vitest (and Playwright when available).`,
      createdAt: new Date().toISOString(),
    });

    completeTask(p, t, result.summary);

    if (t.agentId) {
      const agent = getState().agents.find((a) => a.id === t.agentId);
      updateAgent(t.agentId, {
        status: "idle",
        currentTaskId: null,
        currentTaskLabel: null,
        ...(agent
          ? {
              metrics: {
                ...agent.metrics,
                tokensUsed: agent.metrics.tokensUsed + 2500,
                tasksCompleted: agent.metrics.tasksCompleted + 1,
              },
            }
          : {}),
      });
    }

    const next = p.tasks.find(
      (x) =>
        x.order === t.order + 1 &&
        (x.status === "pending" || x.status === "queued"),
    );
    if (next) next.status = "queued";
    // Re-export workspace with latest artifacts + app/
    p.workspacePath = ensureProjectWorkspace(p);
    upsertProject(p);

    pushActivity({
      type: "info",
      message: `App ready: ${result.filesWritten.length} source files → open ${result.appDir}`,
      projectId: p.id,
      taskId: t.id,
      agentId: t.agentId ?? undefined,
    });
  } catch (e) {
    const p = getProject(projectId);
    if (!p) return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const msg = e instanceof Error ? e.message : String(e);

    const recovered = scheduleStageRecovery(
      p,
      t,
      msg,
      "Re-running **Implementation** scaffold with a clean attempt.",
    );
    if (recovered) return;

    failStageWithGuide(
      p,
      t,
      [msg],
      [
        "Open the project workspace and check for disk permission or path issues.",
        "Click **Rebuild app** on the project page to re-scaffold from the concept.",
        "If scaffolding keeps failing, create a new idea run or inspect Cortex logs for the underlying error.",
        `Error detail: ${msg}`,
      ],
      `Scaffold failed: ${msg}`,
    );
  }
}

async function runTestingVerify(projectId: string, taskId: string) {
  const project = getProject(projectId);
  if (!project) return;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running") return;

  const appDir =
    project.appPath ||
    (project.workspacePath
      ? `${project.workspacePath}/app`
      : null);

  pushActivity({
    type: "info",
    message: `Build & real tests (Vitest + Playwright) starting for "${project.name}"…`,
    projectId,
    taskId,
    agentId: task.agentId ?? undefined,
  });

  const attemptN = (task.retryCount ?? 0) + 1;
  const maxStage = maxRetriesFor(task);
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content:
      `Running **install → build → Vitest unit → Playwright e2e** ` +
      `(stage attempt ${attemptN}/${maxStage}, up to 5 fix rounds per attempt).\n\n` +
      `Cortex will generate/refresh real test suites under \`app/tests/\`, then use **browser access** ` +
      `to open the app and capture console/page errors when tests fail.`,
    createdAt: new Date().toISOString(),
  });
  upsertProject(project);

  if (!appDir) {
    const p = getProject(projectId);
    if (!p) return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const msg = "No app directory — implementation did not scaffold source.";

    // Prefer recovering by re-running implementation if possible
    const impl = p.tasks.find((x) => x.phase === "implementation");
    if (impl && (impl.retryCount ?? 0) < maxRetriesFor(impl)) {
      // Mark testing blocked; re-queue implementation
      t.status = "pending";
      t.progress = 0;
      t.lastError = msg;
      const recovered = scheduleStageRecovery(
        p,
        impl,
        msg,
        "No app source found — re-running **Implementation** so Testing can continue.",
      );
      if (recovered) return;
    }

    failStageWithGuide(
      p,
      t,
      [msg],
      [
        "Implementation did not produce an `app/` folder.",
        "Click **Rebuild app** to re-scaffold from the concept.",
        "Or re-run the idea → project pipeline from Ideas.",
      ],
      msg,
    );
    return;
  }

  try {
    const result = await verifyAppBuild(appDir, {
      concept: project.concept,
      generateTests: true,
      browserInspect: true,
      headedBrowser: process.env.CORTEX_HEADED_BROWSER === "1",
    });
    const p = getProject(projectId);
    if (!p) return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return;

    const artifact = {
      id: `art-${nanoid(8)}`,
      name: "build-test-report.md",
      kind: "test" as const,
      content: result.report,
      phase: "testing" as const,
      agentId: t.agentId ?? "system",
      createdAt: new Date().toISOString(),
    };

    p.artifacts = p.artifacts.filter((a) => a.name !== "build-test-report.md");
    t.artifacts = t.artifacts.filter((a) => a.name !== "build-test-report.md");
    t.artifacts.push(artifact);
    p.artifacts.push(artifact);
    p.sharedMemory.testing = result.report;
    p.lastVerifyReport = result.report;
    p.appPath = result.appDir;
    t.progress = 100;
    t.completedAt = new Date().toISOString();

    if (result.ok) {
      p.buildStatus = "passed";
      p.unresolvedErrors = [];
      p.resolutionGuide = null;
      t.outputSummary =
        `Build & tests passed (Vitest ${result.unitOk ? "✓" : "✗"} · Playwright ${result.e2eOk ? "✓" : "✗"})`;
      t.lastError = null;
      t.status = "completed";
      p.messages.push({
        id: `msg-${nanoid(6)}`,
        role: "agent",
        agentId: t.agentId ?? undefined,
        content:
          `**Build & real tests passed**` +
          (t.retryCount
            ? ` after ${t.retryCount} recovery attempt(s).`
            : ".") +
          `\n\nInstall ✓ · Build ✓ · Vitest unit ✓ · Playwright e2e ✓\n` +
          (result.testsGenerated ? `\n_${result.testsGenerated}_\n` : "") +
          `\nSee Artifacts → \`build-test-report.md\`. Suites live in \`app/tests/\`.`,
        createdAt: new Date().toISOString(),
      });
      completeTask(p, t, t.outputSummary || "Build & tests passed");
      const next = p.tasks.find(
        (x) =>
          x.order === t.order + 1 &&
          (x.status === "pending" || x.status === "queued"),
      );
      if (next) next.status = "queued";
      if (t.agentId) {
        updateAgent(t.agentId, {
          status: "idle",
          currentTaskId: null,
          currentTaskLabel: null,
        });
      }
      p.workspacePath = ensureProjectWorkspace(p);
      upsertProject(p);
      pushActivity({
        type: "task_complete",
        message: `Build & test passed for "${p.name}"`,
        projectId: p.id,
        taskId: t.id,
      });
      return;
    }

    // Auto-fix rounds inside verify failed — try another full testing stage
    const errSummary =
      result.unresolvedErrors.slice(0, 3).join("; ") ||
      "Build/test failed";
    const recovered = scheduleStageRecovery(
      p,
      t,
      errSummary,
      `Re-running **Testing** with progressive auto-fixes (cleared caches / reinstall / scaffold repairs).\n\n` +
        `Last report: Artifacts → \`build-test-report.md\`.`,
    );
    if (recovered) {
      // Keep the latest report on the project while retrying
      p.lastVerifyReport = result.report;
      p.buildStatus = "pending";
      p.workspacePath = ensureProjectWorkspace(p);
      upsertProject(p);
      return;
    }

    // Exhausted stage retries — notify user with resolution guide
    failStageWithGuide(
      p,
      t,
      result.unresolvedErrors.length
        ? result.unresolvedErrors
        : [errSummary],
      result.resolutionGuide.length
        ? result.resolutionGuide
        : [
            `Open \`${result.appDir}\``,
            "Run `rm -rf .next node_modules && npm install && npm run build && npm test`",
            "Fix any remaining errors, then use **Rebuild app** in Cortex.",
          ],
      `Build/test failed: ${errSummary}`,
    );
    p.lastVerifyReport = result.report;
    p.workspacePath = ensureProjectWorkspace(p);
    upsertProject(p);
  } catch (e) {
    const p = getProject(projectId);
    if (!p) return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const msg = e instanceof Error ? e.message : String(e);

    const recovered = scheduleStageRecovery(
      p,
      t,
      msg,
      "Testing crashed unexpectedly — retrying the stage.",
    );
    if (recovered) return;

    failStageWithGuide(
      p,
      t,
      [msg],
      [
        `Testing crashed: ${msg}`,
        "Check Cortex server logs for the stack trace.",
        "Use **Rebuild app**, then re-open the project to re-run Testing.",
      ],
      msg,
    );
  }
}

function shouldInvokeLiveAgent(task: Task): boolean {
  const settings = getSettings();
  if (!settings.jarvisUseInPipeline || settings.jarvisEnabled === false) {
    return false;
  }
  if (!task.agentId) return false;
  const agent = getState().agents.find((a) => a.id === task.agentId);
  if (!agent || !agent.config.enabled) return false;
  // Implementation + testing are deterministic Cortex build tooling
  // (scaffold / npm install / next build / vitest) — NOT the named AI agent.
  // The agentId is ownership/display only; live Codex/Claude never write the app here.
  if (task.phase === "implementation" || task.phase === "testing") {
    return false;
  }
  return isJarvisAgent(agent);
}

function finalizePhaseWithDocs(project: Project, task: Task) {
  // Live OpenJarvis (or future adapters) for research/planning/architecture/polish
  if (shouldInvokeLiveAgent(task)) {
    if (asyncBusy.has(task.id)) {
      return;
    }
    asyncBusy.add(task.id);
    task.progress = Math.max(task.progress, 40);
    project.updatedAt = new Date().toISOString();
    upsertProject(project);
    void (async () => {
      try {
        await finalizePhaseWithLiveAgent(project.id, task.id);
      } finally {
        asyncBusy.delete(task.id);
      }
    })();
    return;
  }

  // Simulated local synthesis
  const output = synthesizePhaseOutput(
    task.phase,
    project.name,
    project.concept.summary,
    project.sharedMemory,
  );
  applyPhaseCompletion(project, task, {
    content: output.content,
    summary: output.summary,
    artifactName: output.artifactName,
    tokens: 800 + Math.floor(Math.random() * 4200),
    latencyMs: 400 + Math.floor(Math.random() * 2000),
    backend: "simulation",
  });
}

async function finalizePhaseWithLiveAgent(projectId: string, taskId: string) {
  const project = getProject(projectId);
  if (!project) return;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running") return;

  pushActivity({
    type: "info",
    message: `${agentName(task.agentId)} (live) generating ${task.phase} for "${project.name}"…`,
    projectId,
    taskId,
    agentId: task.agentId ?? undefined,
  });

  const prompt =
    `Phase: ${task.phase}\n` +
    `Task: ${task.title}\n` +
    `Description: ${task.description}\n\n` +
    `Product concept:\n${project.concept.summary}\n\n` +
    `Features: ${(project.concept.features || []).join("; ")}\n` +
    `Stack: ${(project.concept.stack || []).join(", ")}\n\n` +
    `Write a complete ${task.phase} deliverable as Markdown for the Cortex project workspace. ` +
    `Be specific and actionable.`;

  const result = await invokeAgent({
    agentId: task.agentId!,
    prompt,
    phase: task.phase,
    projectId,
    context: project.sharedMemory,
    extras: {
      projectName: project.name,
      conceptSummary: project.concept.summary,
    },
  });

  // Re-load after await
  const p = getProject(projectId);
  if (!p) return;
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t || t.status !== "running") return;

  if (!result.ok || !result.content.trim()) {
    const err = result.error || "empty response from live agent";
    // First: local synthesis fallback so the stage still completes
    pushActivity({
      type: "info",
      message:
        `Live agent unavailable (${err}) — using local synthesis for ${t.phase}.`,
      projectId,
      taskId,
      agentId: t.agentId ?? undefined,
    });
    try {
      const output = synthesizePhaseOutput(
        t.phase,
        p.name,
        p.concept.summary,
        p.sharedMemory,
      );
      applyPhaseCompletion(p, t, {
        content: output.content,
        summary: output.summary + " (local fallback)",
        artifactName: output.artifactName,
        tokens: 1000,
        latencyMs: result.usage?.latencyMs ?? 500,
        backend: "simulation-fallback",
      });
      return;
    } catch (synthErr) {
      const msg =
        synthErr instanceof Error ? synthErr.message : String(synthErr);
      const recovered = scheduleStageRecovery(
        p,
        t,
        `${err}; local fallback also failed: ${msg}`,
        `Retrying **${t.title}** with a different agent routing path.`,
      );
      if (recovered) return;
      failStageWithGuide(
        p,
        t,
        [err, msg],
        [
          `Phase **${t.phase}** could not produce deliverables.`,
          "Enable a healthy agent (Jarvis / Grok / local model) in Settings.",
          "Resume the project, or re-run from Ideas if the stage stays blocked.",
        ],
        `Phase failed: ${err}`,
      );
      return;
    }
  }

  const artifactName = `${t.phase}.md`;
  const summary = result.content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"))
    ?.slice(0, 180) || `${t.phase} completed via ${result.backend}`;

  applyPhaseCompletion(p, t, {
    content: result.content,
    summary: `${summary} · ${result.backend}`,
    artifactName,
    tokens: result.usage?.tokens ?? 1500,
    latencyMs: result.usage?.latencyMs ?? 800,
    backend: result.backend,
  });
}

function applyPhaseCompletion(
  project: Project,
  task: Task,
  output: {
    content: string;
    summary: string;
    artifactName: string;
    tokens: number;
    latencyMs: number;
    backend: string;
  },
) {
  const artifact = {
    id: `art-${nanoid(8)}`,
    name: output.artifactName,
    kind: "doc" as const,
    content: output.content,
    phase: task.phase,
    agentId: task.agentId ?? "system",
    createdAt: new Date().toISOString(),
  };

  task.artifacts.push(artifact);
  project.artifacts.push(artifact);
  project.sharedMemory[task.phase] = output.content;
  task.outputSummary = output.summary;
  task.completedAt = new Date().toISOString();
  task.progress = 100;

  if (task.requiresApproval) {
    task.status = "awaiting_approval";
    project.status = "awaiting_approval";
    project.messages.push({
      id: `msg-${nanoid(6)}`,
      role: "system",
      content: `**${task.title}** finished (${output.backend}) — awaiting human approval. ${output.summary}`,
      createdAt: new Date().toISOString(),
    });
    pushActivity({
      type: "approval_needed",
      message: `Approval needed: ${task.title} on "${project.name}"`,
      agentId: task.agentId ?? undefined,
      projectId: project.id,
      taskId: task.id,
    });
  } else {
    completeTask(project, task, output.summary);
  }

  if (task.agentId) {
    pushUsage({
      id: `use-${nanoid(8)}`,
      agentId: task.agentId,
      projectId: project.id,
      tokens: output.tokens,
      costUsd: Number((output.tokens * 0.000002).toFixed(4)),
      latencyMs: output.latencyMs,
      createdAt: new Date().toISOString(),
    });
    const agent = getState().agents.find((a) => a.id === task.agentId);
    if (agent) {
      updateAgent(task.agentId, {
        metrics: {
          ...agent.metrics,
          tokensUsed: agent.metrics.tokensUsed + output.tokens,
          avgLatencyMs: Math.round(
            (agent.metrics.avgLatencyMs + output.latencyMs) / 2,
          ),
          tasksCompleted: agent.metrics.tasksCompleted + 1,
          successRate: Math.min(
            0.99,
            agent.metrics.successRate + 0.001,
          ),
        },
      });
    }
  }

  if (task.agentId) {
    updateAgent(task.agentId, {
      status: "idle",
      currentTaskId: null,
      currentTaskLabel: null,
    });
  }

  const next = project.tasks.find(
    (t) =>
      t.order === task.order + 1 &&
      (t.status === "pending" || t.status === "queued"),
  );
  if (next && !task.requiresApproval) {
    next.status = "queued";
  }

  upsertProject(project);
}

function completeTask(project: Project, task: Task, summary: string) {
  task.status = "completed";
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "agent",
    agentId: task.agentId ?? undefined,
    content: summary,
    createdAt: new Date().toISOString(),
  });

  pushActivity({
    type: "task_complete",
    message: `${agentName(task.agentId)} completed ${task.title}`,
    agentId: task.agentId ?? undefined,
    projectId: project.id,
    taskId: task.id,
  });

  // Handoff event
  const next = project.tasks.find((t) => t.order === task.order + 1);
  if (next) {
    next.status = "queued";
    pushActivity({
      type: "handoff",
      message: `Handoff: ${task.phase} → ${next.phase} (${agentName(next.agentId)})`,
      projectId: project.id,
      taskId: next.id,
      agentId: next.agentId ?? undefined,
    });
  }
}

export function approveTask(projectId: string, taskId: string): Project | null {
  const project = getProject(projectId);
  if (!project) return null;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "awaiting_approval") return project;

  task.status = "completed";
  project.status = "running";
  project.updatedAt = new Date().toISOString();
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "user",
    content: `Approved **${task.title}**. Continuing pipeline.`,
    createdAt: new Date().toISOString(),
  });

  const next = project.tasks.find((t) => t.order === task.order + 1);
  if (next && (next.status === "pending" || next.status === "queued")) {
    next.status = "queued";
    pushActivity({
      type: "handoff",
      message: `Approved handoff: ${task.phase} → ${next.phase}`,
      projectId: project.id,
      taskId: next.id,
    });
  }

  pushActivity({
    type: "approval_resolved",
    message: `Approved ${task.title} on "${project.name}"`,
    projectId: project.id,
    taskId: task.id,
  });

  upsertProject(project);
  startProjectRunner(projectId);
  return project;
}

export function rejectTask(
  projectId: string,
  taskId: string,
  reason?: string,
): Project | null {
  const project = getProject(projectId);
  if (!project) return null;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task) return project;

  task.status = "rejected";
  task.outputSummary = reason || "Rejected by human";
  project.status = "paused";
  project.paused = true;
  project.updatedAt = new Date().toISOString();
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "user",
    content: `Rejected **${task.title}**. ${reason || "Paused for rework."}`,
    createdAt: new Date().toISOString(),
  });
  pushActivity({
    type: "approval_resolved",
    message: `Rejected ${task.title} — project paused`,
    projectId: project.id,
    taskId: task.id,
  });
  upsertProject(project);
  stopProjectRunner(projectId);
  releaseAgents(project);
  return project;
}

export function pauseProject(projectId: string): Project | null {
  const project = getProject(projectId);
  if (!project) return null;
  project.paused = true;
  project.status = "paused";
  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  stopProjectRunner(projectId);
  // Don't fully release running agent label — mark idle
  releaseAgents(project);
  pushActivity({
    type: "info",
    message: `Project "${project.name}" paused`,
    projectId,
  });
  return project;
}

export function resumeProject(projectId: string): Project | null {
  const project = getProject(projectId);
  if (!project) return null;

  // Failed projects: re-queue the failed stage instead of no-oping
  if (
    project.status === "failed" ||
    project.tasks.some((t) => t.status === "failed")
  ) {
    return retryFailedStage(projectId);
  }

  project.paused = false;
  if (project.status === "paused") project.status = "running";
  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  startProjectRunner(projectId);
  pushActivity({
    type: "info",
    message: `Project "${project.name}" resumed`,
    projectId,
  });
  return project;
}

/**
 * Re-run the real app scaffold for a project (implementation phase).
 * Useful when a project finished under the old markdown-only pipeline.
 * Also re-queues Testing/Polish so the pipeline can pass after a prior failure.
 */
export async function rebuildProjectApp(
  projectId: string,
): Promise<Project | null> {
  const project = getProject(projectId);
  if (!project) return null;

  let task = project.tasks.find((t) => t.phase === "implementation");
  if (!task) {
    // Synthetic task if missing
    task = {
      id: `task-${nanoid(8)}`,
      projectId,
      phase: "implementation",
      title: "Implementation",
      description: "Scaffold application source",
      status: "running",
      agentId: routeAgent(getState().agents, "implementation")?.id ?? null,
      dependsOn: [],
      artifacts: [],
      progress: 10,
      requiresApproval: false,
      outputSummary: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      estimatedMinutes: 25,
      order: 3,
      retryCount: 0,
      lastError: null,
    };
    project.tasks.push(task);
  } else {
    task.status = "running";
    task.progress = 10;
    task.completedAt = null;
    task.outputSummary = null;
    task.retryCount = 0;
    task.lastError = null;
  }

  // Reset downstream stages so Testing runs again after scaffold
  for (const t of project.tasks) {
    if (t.phase === "testing" || t.phase === "polish") {
      t.status = "pending";
      t.progress = 0;
      t.completedAt = null;
      t.outputSummary = null;
      t.retryCount = 0;
      t.lastError = null;
    }
  }

  project.status = "running";
  project.paused = false;
  project.buildStatus = "pending";
  project.unresolvedErrors = [];
  project.resolutionGuide = null;
  project.updatedAt = new Date().toISOString();
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content:
      "Rebuilding app source and re-queuing **Testing** / **Polish** so the pipeline can recover.",
    createdAt: new Date().toISOString(),
  });
  upsertProject(project);
  startProjectRunner(projectId);

  // Force async build immediately
  asyncBusy.add(task.id);
  try {
    await runImplementationBuild(projectId, task.id);
  } finally {
    asyncBusy.delete(task.id);
  }

  return getProject(projectId) ?? null;
}

/**
 * Retry only the failed stage (e.g. re-run Testing without full re-scaffold).
 */
export function retryFailedStage(projectId: string): Project | null {
  const project = getProject(projectId);
  if (!project) return null;

  const failed =
    project.tasks.find((t) => t.status === "failed") ||
    project.tasks
      .slice()
      .sort((a, b) => b.order - a.order)
      .find((t) => t.lastError);

  if (!failed) {
    // If project failed but tasks were left terminal, prefer testing
    const testing = project.tasks.find((t) => t.phase === "testing");
    if (!testing) return project;
    testing.status = "queued";
    testing.progress = 0;
    testing.completedAt = null;
    testing.retryCount = 0;
    testing.lastError = null;
  } else {
    failed.status = "queued";
    failed.progress = 0;
    failed.completedAt = null;
    failed.retryCount = 0;
    failed.lastError = null;
    // Keep later stages pending
    for (const t of project.tasks) {
      if (t.order > failed.order) {
        t.status = "pending";
        t.progress = 0;
        t.completedAt = null;
      }
    }
  }

  project.status = "running";
  project.paused = false;
  project.buildStatus = "pending";
  project.unresolvedErrors = [];
  project.resolutionGuide = null;
  project.updatedAt = new Date().toISOString();
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content: `Retrying failed stage **${failed?.title ?? "Testing"}** with automatic recovery enabled.`,
    createdAt: new Date().toISOString(),
  });
  upsertProject(project);
  startProjectRunner(projectId);
  pushActivity({
    type: "info",
    message: `Retrying failed stage on "${project.name}"`,
    projectId,
    taskId: failed?.id,
  });
  return project;
}

export function reassignTask(
  projectId: string,
  taskId: string,
  agentId: string,
): Project | null {
  const project = getProject(projectId);
  if (!project) return null;
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task) return project;
  if (task.status === "completed" || task.status === "running") return project;

  task.agentId = agentId;
  project.updatedAt = new Date().toISOString();
  project.messages.push({
    id: `msg-${nanoid(6)}`,
    role: "system",
    content: `Reassigned **${task.title}** to ${agentName(agentId)}.`,
    createdAt: new Date().toISOString(),
  });
  upsertProject(project);
  pushActivity({
    type: "info",
    message: `Reassigned ${task.title} → ${agentName(agentId)}`,
    projectId,
    taskId,
    agentId,
  });
  return project;
}

function releaseAgents(project: Project) {
  for (const task of project.tasks) {
    if (task.agentId && task.status === "running") {
      updateAgent(task.agentId, {
        status: "idle",
        currentTaskId: null,
        currentTaskLabel: null,
      });
    }
  }
  // Also clear any agent still pointing at this project
  for (const agent of getState().agents) {
    if (
      agent.currentTaskId &&
      project.tasks.some((t) => t.id === agent.currentTaskId)
    ) {
      updateAgent(agent.id, {
        status: "idle",
        currentTaskId: null,
        currentTaskLabel: null,
      });
    }
  }
}

function agentName(id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return getState().agents.find((a) => a.id === id)?.name ?? id;
}

/** Resume runners for in-progress projects after server restart */
export function bootstrapRunners() {
  const projects = getState().projects.filter(
    (p) =>
      !p.paused &&
      (p.status === "running" || p.status === "awaiting_approval"),
  );
  for (const p of projects) {
    if (p.status === "running") startProjectRunner(p.id);
  }
}
