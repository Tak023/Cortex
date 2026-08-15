/**
 * In-process PTY sessions for embedded agent terminals.
 * Server-only — uses node-pty.
 */
import { EventEmitter } from "events";
import os from "os";
import path from "path";
import { nanoid } from "nanoid";
import type { ExternalAgentId } from "./externalAgents";
import { resolveAgentCommand } from "./resolveAgentCommand";
import {
  appendVaultDailyNote,
  appendVaultLog,
  stripAnsi,
} from "../vault/vault";

export type TerminalSessionInfo = {
  id: string;
  agent: ExternalAgentId;
  label: string;
  display: string;
  cwd: string;
  createdAt: string;
  exited: boolean;
  exitCode: number | null;
};

type PtyHandle = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  pid: number;
};

type Session = TerminalSessionInfo & {
  pty: PtyHandle;
  bus: EventEmitter;
  /** Ring buffer so SSE clients that connect slightly late still see startup output. */
  backlog: string[];
};

type GlobalStore = {
  sessions: Map<string, Session>;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & {
    __cortexTerminalSessions?: GlobalStore;
  };
  if (!g.__cortexTerminalSessions) {
    g.__cortexTerminalSessions = { sessions: new Map() };
  }
  return g.__cortexTerminalSessions;
}

function buildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || os.homedir();
  const extra = [
    path.join(home, ".local/bin"),
    path.join(home, ".grok/bin"),
    path.join(home, ".codex/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const pathEnv = process.env.PATH || "";
  const merged = [...extra, ...pathEnv.split(path.delimiter)].filter(Boolean);
  const unique = Array.from(new Set(merged));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: unique.join(path.delimiter),
    HOME: home,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "iTerm.app",
    COLORFGBG: "15;0",
    FORCE_COLOR: "3",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
  };
  // Avoid nested Electron/Node confusion for some CLIs
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of [
    "NO_COLOR",
    "NODE_DISABLE_COLORS",
    "CI",
    "TF_BUILD",
    "CLAUDE_CODE_NO_COLOR",
    "NODE_ENV",
  ]) {
    delete env[key];
  }
  return env;
}

/**
 * Load node-pty without a static `require("node-pty")` so Turbopack does not
 * rewrite it to a hashed external that fails in the standalone server.
 */
function loadNodePty(): typeof import("node-pty") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require("module") as typeof import("module");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  const candidates = [
    path.join(process.cwd(), "node_modules", "node-pty"),
    path.join(__dirname, "..", "..", "..", "node_modules", "node-pty"),
  ];
  // Packaged Electron: standalone lives under Resources/
  const resourcesPath = process.env.ELECTRON_RESOURCES_PATH;
  if (resourcesPath) {
    candidates.unshift(
      path.join(resourcesPath, "standalone", "node_modules", "node-pty"),
    );
  }
  // process.resourcesPath is set in Electron (Next may run in-process)
  const rp = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (rp) {
    candidates.unshift(path.join(rp, "standalone", "node_modules", "node-pty"));
  }

  const errors: string[] = [];
  for (const pkgDir of candidates) {
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    try {
      // Ensure spawn-helper is executable
      const prebuilds = path.join(pkgDir, "prebuilds");
      if (fs.existsSync(prebuilds)) {
        for (const plat of fs.readdirSync(prebuilds)) {
          const helper = path.join(prebuilds, plat, "spawn-helper");
          if (fs.existsSync(helper)) {
            try {
              fs.chmodSync(helper, 0o755);
            } catch {
              /* ignore */
            }
          }
        }
      }
      const req = createRequire(pkgJson);
      return req(pkgDir) as typeof import("node-pty");
    } catch (e) {
      errors.push(
        `${pkgDir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  throw new Error(
    `node-pty unavailable for server PTY.\n${errors.join("\n") || "No candidates found."}`,
  );
}

function spawnPty(
  command: string,
  args: string[],
  opts: { cwd: string; cols: number; rows: number },
): PtyHandle {
  const pty = loadNodePty();
  const proc = pty.spawn(command, args, {
    name: "xterm-256color",
    cols: Math.max(20, opts.cols || 120),
    rows: Math.max(10, opts.rows || 36),
    cwd: opts.cwd,
    env: buildEnv() as Record<string, string>,
  });
  return {
    write: (data: string) => proc.write(data),
    resize: (cols: number, rows: number) => {
      try {
        proc.resize(Math.max(20, cols), Math.max(10, rows));
      } catch {
        /* ignore */
      }
    },
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(cb);
    },
    pid: proc.pid,
  };
}

export function createTerminalSession(opts: {
  agent: ExternalAgentId;
  cols?: number;
  rows?: number;
  cwd?: string;
}): { ok: true; session: TerminalSessionInfo } | { ok: false; detail: string } {
  const resolved = resolveAgentCommand(opts.agent);
  if (!resolved.ok || !resolved.command) {
    return { ok: false, detail: resolved.detail };
  }

  const id = nanoid(12);
  const cwd = opts.cwd || resolved.cwd;
  let pty: PtyHandle;
  try {
    pty = spawnPty(resolved.command, resolved.args, {
      cwd,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 36,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      detail: `Failed to start PTY for ${resolved.label}: ${message}`,
    };
  }

  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const backlog: string[] = [];
  const BACKLOG_MAX = 200;

  const session: Session = {
    id,
    agent: opts.agent,
    label: resolved.label,
    display: resolved.display,
    cwd,
    createdAt: new Date().toISOString(),
    exited: false,
    exitCode: null,
    pty,
    bus,
    backlog,
  };

  pty.onData((data) => {
    backlog.push(data);
    if (backlog.length > BACKLOG_MAX) backlog.shift();
    bus.emit("data", data);
  });
  pty.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode ?? 0;
    bus.emit("exit", { exitCode: session.exitCode });

    try {
      appendVaultLog(
        session.label,
        "Terminal session ended",
        `Session finished (exit code: ${session.exitCode}) in \`${session.cwd}\``,
      );
    } catch {
      /* non-blocking */
    }

    // Keep session briefly so clients can read exit, then drop
    setTimeout(() => {
      store().sessions.delete(id);
    }, 60_000);
  });

  store().sessions.set(id, session);

  try {
    appendVaultLog(
      session.label,
      "Terminal session started",
      `In-app terminal opened in \`${session.cwd}\``,
    );
  } catch {
    /* non-blocking */
  }

  return {
    ok: true,
    session: {
      id: session.id,
      agent: session.agent,
      label: session.label,
      display: session.display,
      cwd: session.cwd,
      createdAt: session.createdAt,
      exited: session.exited,
      exitCode: session.exitCode,
    },
  };
}

export function saveTerminalSessionToVault(
  id: string,
  opts?: { summary?: string; title?: string },
): { ok: boolean; path?: string | null; error?: string } {
  const session = store().sessions.get(id);
  if (!session) {
    return { ok: false, error: "Session not found or expired" };
  }
  const rawBacklog = session.backlog.join("");
  const clean = stripAnsi(rawBacklog);
  const title = opts?.title || `Interactive Session (${session.label})`;
  const summary =
    opts?.summary ||
    `Interactive terminal session with ${session.label}.\nCommand: \`${session.display}\``;

  const rel = appendVaultDailyNote({
    agent: session.label,
    title,
    summary,
    details: clean || "(no terminal output recorded)",
    cwd: session.cwd,
  });

  return { ok: Boolean(rel), path: rel };
}


export function getTerminalSession(id: string): Session | undefined {
  return store().sessions.get(id);
}

export function writeTerminal(id: string, data: string): boolean {
  const s = store().sessions.get(id);
  if (!s || s.exited) return false;
  s.pty.write(data);
  return true;
}

export function resizeTerminal(
  id: string,
  cols: number,
  rows: number,
): boolean {
  const s = store().sessions.get(id);
  if (!s || s.exited) return false;
  s.pty.resize(cols, rows);
  return true;
}

export function killTerminal(id: string): boolean {
  const s = store().sessions.get(id);
  if (!s) return false;
  try {
    s.pty.kill();
  } catch {
    /* ignore */
  }
  s.exited = true;
  store().sessions.delete(id);
  return true;
}

export function subscribeTerminal(
  id: string,
  handlers: {
    onData: (data: string) => void;
    onExit?: (exitCode: number | null) => void;
  },
): (() => void) | null {
  const s = store().sessions.get(id);
  if (!s) return null;
  // Replay buffered startup output for late SSE connections
  for (const chunk of s.backlog) {
    handlers.onData(chunk);
  }
  const onData = (data: string) => handlers.onData(data);
  const onExit = (e: { exitCode: number | null }) =>
    handlers.onExit?.(e.exitCode);
  s.bus.on("data", onData);
  s.bus.on("exit", onExit);
  return () => {
    s.bus.off("data", onData);
    s.bus.off("exit", onExit);
  };
}
