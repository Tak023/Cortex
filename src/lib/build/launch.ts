/**
 * Detect / start scaffolded apps so Cortex can show a clear launch path.
 * Robust under Electron: GUI apps often lack npm on PATH — we use a login shell
 * and fall back to local node_modules/.bin/next.
 */
import fs from "fs";
import path from "path";
import http from "http";
import os from "os";
import { spawn, type ChildProcess, execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { isPathInside } from "./pathContainment";
import type { Project } from "../types";
import { projectWorkspaceDir } from "../workspace";
import { scaffoldAppFromConcept } from "./scaffold";
import { childProjectInstallEnv } from "./childEnv";

const execFileAsync = promisify(execFile);

type RunningApp = {
  child: ChildProcess;
  url: string;
  appDir: string;
  logFile: string;
  startedAt: number;
};

/**
 * Running dev servers keyed by project id.
 *
 * Held on globalThis, not in module scope. Launched servers are `detached`,
 * so they outlive the Cortex process; a module-level Map is emptied by any
 * server reload or app restart, which permanently orphans them. An orphaned
 * server keeps serving a deleted project's old bundle from memory — a page
 * that looks like the pipeline produced nothing, from a directory that no
 * longer exists.
 */
function runningApps(): Map<string, RunningApp> {
  const g = globalThis as typeof globalThis & {
    __cortexLaunchedApps?: Map<string, RunningApp>;
  };
  if (!g.__cortexLaunchedApps) g.__cortexLaunchedApps = new Map();
  return g.__cortexLaunchedApps;
}

export type LaunchInfo = {
  workspacePath: string;
  appPath: string | null;
  appExists: boolean;
  launchUrl: string | null;
  launchCommand: string | null;
  steps: Array<{ n: number; title: string; detail: string }>;
  kind: "docker" | "web" | "cli" | "api" | "unknown";
  serverRunning: boolean;
};

function readPkg(appDir: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
} | null {
  try {
    const raw = fs.readFileSync(path.join(appDir, "package.json"), "utf-8");
    return JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function detectKind(project: Project, appDir: string | null): LaunchInfo["kind"] {
  const hay =
    `${project.concept.title} ${project.concept.summary} ${project.name}`.toLowerCase();
  if (hay.includes("docker") || hay.includes("container")) return "docker";
  if (appDir && fs.existsSync(path.join(appDir, "bin", "cli.mjs"))) return "cli";
  if (appDir && fs.existsSync(path.join(appDir, "server.mjs"))) return "api";
  if (appDir && fs.existsSync(path.join(appDir, "app", "page.tsx"))) return "web";
  if (hay.includes("cli")) return "cli";
  if (hay.includes("api")) return "api";
  return "web";
}

function defaultUrl(kind: LaunchInfo["kind"]): string | null {
  // Browser access for every non-CLI project type
  if (kind === "cli") return null;
  if (kind === "api") return "http://127.0.0.1:8787/api/concept";
  // docker + web + unknown → Next scaffold on 3456
  return "http://127.0.0.1:3456";
}

function defaultCommand(appDir: string, kind: LaunchInfo["kind"]): string {
  if (kind === "cli") return `cd "${appDir}" && node bin/cli.mjs help`;
  if (kind === "api") return `cd "${appDir}" && npm start`;
  return `cd "${appDir}" && npm run dev`;
}

/** PATH + install env that works under packaged Electron (NODE_ENV=production). */
function enrichedEnv(): NodeJS.ProcessEnv {
  return childProjectInstallEnv({ BROWSER: "none" });
}

function resolveNextBin(appDir: string): string | null {
  const candidates = [
    path.join(appDir, "node_modules", "next", "dist", "bin", "next"),
    path.join(appDir, "node_modules", ".bin", "next"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveNodeBin(): string {
  const candidates = [
    process.env.NODE_BINARY,
    path.join(os.homedir(), ".local", "bin", "node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "node",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c === "node" || fs.existsSync(c)) return c;
  }
  return "node";
}

export function resolveAppDir(project: Project): string {
  if (project.appPath && fs.existsSync(project.appPath)) return project.appPath;
  const ws = project.workspacePath || projectWorkspaceDir(project);
  return path.join(ws, "app");
}

export function getLaunchInfo(project: Project): LaunchInfo {
  const workspacePath = project.workspacePath || projectWorkspaceDir(project);
  const appPath = resolveAppDir(project);
  const appExists =
    fs.existsSync(appPath) &&
    (fs.existsSync(path.join(appPath, "package.json")) ||
      fs.existsSync(path.join(appPath, "bin")));
  const kind = detectKind(project, appExists ? appPath : null);
  const launchUrl = project.launchUrl || defaultUrl(kind);
  const launchCommand =
    project.launchCommand ||
    (appExists ? defaultCommand(appPath, kind) : null);
  const entry = runningApps().get(project.id);
  const serverRunning = Boolean(entry);

  const steps: LaunchInfo["steps"] = [];

  if (!appExists) {
    steps.push({
      n: 1,
      title: "Build the app",
      detail:
        'Click “Build & launch”. Cortex scaffolds source into the project’s app/ folder.',
    });
    steps.push({
      n: 2,
      title: "Start the app",
      detail: "Launch will install dependencies and start the local server.",
    });
    steps.push({
      n: 3,
      title: "Open in browser",
      detail: launchUrl
        ? `Open ${launchUrl}`
        : "CLI apps run in Terminal — no browser URL.",
    });
  } else if (kind === "cli") {
    steps.push({
      n: 1,
      title: "Open the app folder",
      detail: appPath,
    });
    steps.push({
      n: 2,
      title: "Run in Terminal",
      detail: launchCommand || `cd "${appPath}" && node bin/cli.mjs help`,
    });
    steps.push({
      n: 3,
      title: "Try a command",
      detail: `node bin/cli.mjs info`,
    });
  } else {
    steps.push({
      n: 1,
      title: "App source is ready",
      detail: appPath,
    });
    steps.push({
      n: 2,
      title: "Start the local server",
      detail: serverRunning
        ? `Running${launchUrl ? ` at ${launchUrl}` : ""}`
        : `Click “Launch app” — or Terminal: ${launchCommand}`,
    });
    steps.push({
      n: 3,
      title: "Open in your browser",
      detail: launchUrl || "http://127.0.0.1:3456",
    });
  }

  return {
    workspacePath,
    appPath: appExists ? appPath : null,
    appExists,
    launchUrl,
    launchCommand,
    steps,
    kind,
    serverRunning,
  };
}

function waitForHttp(url: string, timeoutMs = 90000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        // Any HTTP response means the server is up
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server did not become ready at ${url} within ${Math.round(timeoutMs / 1000)}s`));
          return;
        }
        setTimeout(tick, 500);
      });
      req.on("timeout", () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function openExternal(target: string) {
  if (process.platform === "darwin") {
    await execFileAsync("open", [target]);
  } else if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", target]);
  } else {
    await execFileAsync("xdg-open", [target]);
  }
}

function runInLoginShell(
  command: string,
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    logFile: string;
  },
): ChildProcess {
  const shell =
    process.platform === "darwin" || process.platform === "linux"
      ? process.env.SHELL || "/bin/zsh"
      : "cmd.exe";

  const logFd = fs.openSync(opts.logFile, "a");

  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/c", command], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", logFd, logFd],
      detached: true,
      windowsHide: true,
    });
  }

  // Login shell (-l) so nvm / .local/bin / Homebrew npm are available under Electron
  return spawn(shell, ["-lc", command], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
}

async function ensureDeps(appDir: string, logFile: string): Promise<void> {
  if (fs.existsSync(path.join(appDir, "node_modules", "next"))) {
    return;
  }
  fs.appendFileSync(logFile, `\n[cortex] npm install in ${appDir}\n`);
  await new Promise<void>((resolve, reject) => {
    const child = runInLoginShell(
      "npm install --include=dev --no-fund --no-audit --loglevel=error",
      {
        cwd: appDir,
        env: enrichedEnv(),
        logFile,
      },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed (exit ${code}). See log: ${logFile}`));
    });
    child.on("error", reject);
  });
}

function readLogTail(logFile: string, max = 2500): string {
  try {
    if (!fs.existsSync(logFile)) return "";
    const raw = fs.readFileSync(logFile, "utf-8");
    return raw.slice(-max);
  } catch {
    return "";
  }
}

/**
 * Ensure app exists (scaffold if needed), start dev server, open browser only when ready.
 */
export async function launchProjectApp(project: Project): Promise<{
  project: Project;
  info: LaunchInfo;
  started: boolean;
  openedUrl: string | null;
  message: string;
  logFile?: string;
}> {
  let appDir = resolveAppDir(project);
  let didScaffold = false;
  const logFile = path.join(
    os.tmpdir(),
    `cortex-launch-${project.id.replace(/[^\w-]+/g, "_")}.log`,
  );
  fs.writeFileSync(
    logFile,
    `[cortex] launch ${new Date().toISOString()} project=${project.id}\nappDir=${appDir}\n`,
  );

  if (!fs.existsSync(path.join(appDir, "package.json"))) {
    fs.appendFileSync(logFile, "[cortex] scaffolding app…\n");
    const result = await scaffoldAppFromConcept(project, { runInstall: true });
    appDir = result.appDir;
    didScaffold = true;
    project.appPath = appDir;
    project.workspacePath = path.dirname(appDir);
    project.launchCommand = result.runHint;
    const m = result.runHint.match(/http:\/\/[^\s]+/);
    project.launchUrl = m?.[0] ?? defaultUrl(detectKind(project, appDir));
    fs.appendFileSync(
      logFile,
      `[cortex] scaffolded ${result.filesWritten.length} files; installOk=${result.installOk}\n${result.installLog}\n`,
    );
  }

  const kind = detectKind(project, appDir);
  const url = project.launchUrl || defaultUrl(kind);
  const cmd = project.launchCommand || defaultCommand(appDir, kind);

  project.appPath = appDir;
  project.launchUrl = url;
  project.launchCommand = cmd;
  project.workspacePath = project.workspacePath || path.dirname(appDir);

  if (kind === "cli") {
    try {
      await openExternal(appDir);
    } catch {
      /* ignore */
    }
    return {
      project,
      info: getLaunchInfo(project),
      started: false,
      openedUrl: null,
      message: didScaffold
        ? `CLI app scaffolded. Run in Terminal:\n${cmd}`
        : `CLI app ready. Run in Terminal:\n${cmd}`,
      logFile,
    };
  }

  // Already running → verify then open
  if (runningApps().has(project.id) && url) {
    try {
      await waitForHttp(url, 5000);
      await openExternal(url);
      return {
        project,
        info: getLaunchInfo(project),
        started: true,
        openedUrl: url,
        message: `App already running. Opened ${url}`,
        logFile,
      };
    } catch {
      runningApps().delete(project.id);
    }
  }

  try {
    await ensureDeps(appDir, logFile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tail = readLogTail(logFile);
    return {
      project,
      info: getLaunchInfo(project),
      started: false,
      openedUrl: null,
      message:
        `Could not install dependencies.\n\n${msg}\n\n` +
        `Try in Terminal:\ncd "${appDir}"\nnpm install\nnpm run dev\n\nLog:\n${tail}`,
      logFile,
    };
  }

  const pkg = readPkg(appDir);
  const hasDev = Boolean(pkg?.scripts?.dev);
  const hasStart = Boolean(pkg?.scripts?.start);

  if (!hasDev && !hasStart && kind !== "api") {
    try {
      await openExternal(appDir);
    } catch {
      /* ignore */
    }
    return {
      project,
      info: getLaunchInfo(project),
      started: false,
      openedUrl: null,
      message: `No npm start/dev script found. Opened folder:\n${appDir}`,
      logFile,
    };
  }

  const launchUrl = url || "http://127.0.0.1:3456";
  const nextBin = resolveNextBin(appDir);
  const nodeBin = resolveNodeBin();

  // Prefer direct next binary (avoids npm PATH issues in Electron)
  let startCmd: string;
  if (kind === "api") {
    startCmd = `${JSON.stringify(nodeBin)} server.mjs`;
  } else if (nextBin) {
    // next dev -H 127.0.0.1 -p 3456
    const portMatch = (pkg?.scripts?.dev || "").match(/-p\s+(\d+)/);
    const port = portMatch?.[1] || "3456";
    startCmd = `${JSON.stringify(nodeBin)} ${JSON.stringify(nextBin)} dev -H 127.0.0.1 -p ${port}`;
  } else if (hasDev) {
    startCmd = "npm run dev";
  } else {
    startCmd = "npm start";
  }

  fs.appendFileSync(logFile, `[cortex] starting: ${startCmd}\n`);

  const child = runInLoginShell(startCmd, {
    cwd: appDir,
    env: enrichedEnv(),
    logFile,
  });

  runningApps().set(project.id, {
    child,
    url: launchUrl,
    appDir,
    logFile,
    startedAt: Date.now(),
  });

  let earlyExitCode: number | null = null;
  child.on("exit", (code) => {
    earlyExitCode = code;
    runningApps().delete(project.id);
    fs.appendFileSync(
      logFile,
      `[cortex] process exited code=${code}\n`,
    );
  });
  child.on("error", (err) => {
    fs.appendFileSync(logFile, `[cortex] spawn error: ${err.message}\n`);
  });

  // Brief pause so a fast crash is detected before we wait forever
  await new Promise((r) => setTimeout(r, 800));
  if (earlyExitCode !== null && earlyExitCode !== 0) {
    const tail = readLogTail(logFile);
    return {
      project,
      info: getLaunchInfo(project),
      started: false,
      openedUrl: null,
      message:
        `App process exited immediately (code ${earlyExitCode}).\n\n` +
        `Run this in Terminal:\n${cmd}\n\nLog:\n${tail}`,
      logFile,
    };
  }

  const probe =
    kind === "api"
      ? "http://127.0.0.1:8787/health"
      : launchUrl;

  try {
    await waitForHttp(probe, 90000);
  } catch {
    const tail = readLogTail(logFile);
    // Kill failed server
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    runningApps().delete(project.id);

    return {
      project,
      info: getLaunchInfo(project),
      started: false,
      openedUrl: null,
      message:
        `Unable to connect to ${probe}. The server never became ready.\n\n` +
        `**Fix — run in Terminal:**\n` +
        `\`\`\`\ncd "${appDir}"\nnpm install\nnpm run dev\n\`\`\`\n` +
        `Then open ${launchUrl}\n\n` +
        `**Log tail:**\n${tail || "(empty — npm/node may not be on PATH for the desktop app)"}`,
      logFile,
    };
  }

  // Only open browser after confirmed ready
  try {
    await openExternal(launchUrl);
  } catch (e) {
    fs.appendFileSync(
      logFile,
      `[cortex] open browser failed: ${e instanceof Error ? e.message : e}\n`,
    );
  }

  return {
    project,
    info: getLaunchInfo(project),
    started: true,
    openedUrl: launchUrl,
    message: `App is running at ${launchUrl}${didScaffold ? " (scaffolded first)" : ""}.`,
    logFile,
  };
}

/**
 * Kill whatever is listening on `port` *if* its working directory is inside
 * `appDir`.
 *
 * Reaps servers this process did not start — orphans from a previous Cortex
 * run, which the in-memory registry cannot know about. The cwd check is what
 * makes this safe: killing by port alone would take out an unrelated service
 * that happens to use the same one.
 */
function reapOrphanServer(appDir: string, url: string | null): boolean {
  const port = url ? Number(new URL(url).port) : NaN;
  if (!Number.isFinite(port) || port <= 0) return false;

  let pids: string[];
  try {
    pids = execFileSync(
      "lsof",
      ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return false; // nothing listening, or lsof unavailable
  }

  let killed = false;
  const target = appDir;
  for (const pid of pids) {
    let cwd = "";
    try {
      // -Fn prints the cwd path prefixed with "n"
      const out = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
        encoding: "utf8",
        timeout: 4000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      cwd = (out.split("\n").find((l) => l.startsWith("n")) || "").slice(1);
    } catch {
      continue;
    }
    if (!isPathInside(target, cwd)) continue;
    try {
      process.kill(Number(pid), "SIGKILL");
      killed = true;
    } catch {
      /* already gone */
    }
  }
  return killed;
}

/**
 * Stop a project's dev server. Returns true if anything was stopped.
 *
 * Falls back to the port reaper when the registry has no entry, so a server
 * started before the last Cortex restart is still cleaned up.
 */
export function stopLaunchedApp(
  projectId: string,
  fallback?: { appDir?: string | null; url?: string | null },
) {
  const entry = runningApps().get(projectId);
  if (!entry) {
    if (fallback?.appDir) {
      return reapOrphanServer(fallback.appDir, fallback.url ?? null);
    }
    return false;
  }
  try {
    if (entry.child.pid) process.kill(-entry.child.pid, "SIGTERM");
  } catch {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  runningApps().delete(projectId);
  return true;
}
