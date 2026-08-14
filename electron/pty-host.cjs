/**
 * PTY host for in-app agent terminals.
 * Runs in the Electron main process (not Turbopack-bundled Next), so native
 * node-pty loads reliably from standalone or project node_modules.
 */
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");
const { app } = require("electron");

const sessions = new Map();

function exists(p) {
  try {
    return Boolean(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

function whichLike(names) {
  const home = os.homedir();
  const pathEnv = process.env.PATH || "";
  const dirs = [
    path.join(home, ".local/bin"),
    path.join(home, ".grok/bin"),
    path.join(home, ".codex/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...pathEnv.split(path.delimiter),
  ];
  for (const name of names) {
    if (path.isAbsolute(name) && exists(name)) return name;
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (exists(full)) return full;
    }
  }
  return null;
}

const AGENTS = {
  hermes: {
    label: "Hermes",
    bins: ["hermes", path.join(os.homedir(), ".local/bin/hermes")],
  },
  "claude-code": {
    label: "Claude Code",
    bins: ["claude", path.join(os.homedir(), ".local/bin/claude")],
  },
  codex: {
    label: "Codex",
    bins: [
      "codex",
      path.join(os.homedir(), ".local/bin/codex"),
      path.join(os.homedir(), ".codex/bin/codex"),
    ],
    npxFallback: ["-y", "@openai/codex"],
  },
  grok: {
    label: "Grok",
    bins: [
      "grok",
      path.join(os.homedir(), ".grok/bin/grok"),
      path.join(os.homedir(), ".local/bin/grok"),
    ],
  },
  antigravity: {
    label: "Antigravity",
    bins: [
      "agy",
      "antigravity",
      path.join(os.homedir(), ".local/bin/agy"),
      path.join(os.homedir(), ".gemini/antigravity-cli/bin/agy"),
    ],
  },
};

function resolveAgent(agentId) {
  const meta = AGENTS[agentId];
  if (!meta) {
    return { ok: false, agent: agentId, detail: `Unknown agent: ${agentId}` };
  }
  const bin = whichLike(meta.bins);
  const cwd = process.env.HOME || os.homedir();
  if (bin) {
    return {
      ok: true,
      agent: agentId,
      label: meta.label,
      command: bin,
      args: [],
      cwd,
      display: bin,
      detail: `Resolved ${meta.label} (${bin})`,
    };
  }
  if (meta.npxFallback) {
    const npx = whichLike(["npx"]);
    if (npx) {
      return {
        ok: true,
        agent: agentId,
        label: meta.label,
        command: npx,
        args: meta.npxFallback,
        cwd,
        display: `${npx} ${meta.npxFallback.join(" ")}`,
        detail: `Resolved ${meta.label} via npx`,
      };
    }
  }
  return {
    ok: false,
    agent: agentId,
    label: meta.label,
    detail: `${meta.label} CLI not found on PATH.`,
  };
}

function nodePtySearchRoots() {
  const roots = [];
  try {
    // Packaged: Resources/standalone/node_modules
    if (process.resourcesPath) {
      roots.push(path.join(process.resourcesPath, "standalone", "node_modules"));
      roots.push(path.join(process.resourcesPath, "node_modules"));
    }
  } catch {
    /* ignore */
  }
  // Project (dev + electron-rebuild output)
  roots.push(path.join(__dirname, "..", "node_modules"));
  roots.push(path.join(process.cwd(), "node_modules"));
  try {
    if (app?.isPackaged === false) {
      roots.push(path.join(app.getAppPath(), "node_modules"));
    }
  } catch {
    /* ignore */
  }
  return roots;
}

function ensureSpawnHelperExecutable(ptyPackageDir) {
  const prebuilds = path.join(ptyPackageDir, "prebuilds");
  if (!exists(prebuilds)) return;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (name === "spawn-helper") {
        try {
          fs.chmodSync(full, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  };
  try {
    walk(prebuilds);
  } catch {
    /* ignore */
  }
}

let cachedPty = null;
let cachedPtyError = null;

function loadNodePty() {
  if (cachedPty) return cachedPty;
  if (cachedPtyError) throw cachedPtyError;

  const errors = [];
  for (const root of nodePtySearchRoots()) {
    const pkgDir = path.join(root, "node-pty");
    const pkgJson = path.join(pkgDir, "package.json");
    if (!exists(pkgJson)) continue;
    ensureSpawnHelperExecutable(pkgDir);
    try {
      const req = createRequire(pkgJson);
      const mod = req(pkgDir);
      if (mod && typeof mod.spawn === "function") {
        cachedPty = mod;
        console.log("[cortex] node-pty loaded from", pkgDir);
        return mod;
      }
    } catch (e) {
      errors.push(`${pkgDir}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const err = new Error(
    `node-pty not available.\nTried:\n${errors.join("\n") || "(no candidates)"}`,
  );
  cachedPtyError = err;
  throw err;
}

function buildEnv() {
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
  const env = {
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
  delete env.ELECTRON_RUN_AS_NODE;
  // The Cortex server process sets Next standalone internals (and
  // PORT/HOSTNAME/NODE_ENV=production). If terminal sessions inherit them,
  // any `next build` / `npm install` run from the embedded terminal breaks
  // ("generate is not a function", skipped devDependencies, …).
  const blocked = [
    "TURBOPACK",
    "NODE_PATH",
    "PORT",
    "HOSTNAME",
    "NODE_ENV",
    "NEXT_DEPLOYMENT_ID",
    "NEXT_RUNTIME",
    "NODE_OPTIONS",
    "KEEP_ALIVE_TIMEOUT",
    // Color-off flags: Electron/Next/CI inheritance makes every agent TUI
    // render monochrome white. Hermes treats NO_COLOR as set-if-present.
    "NO_COLOR",
    "NODE_DISABLE_COLORS",
    "CI",
    "TF_BUILD",
    "CLAUDE_CODE_NO_COLOR",
  ];
  for (const key of Object.keys(env)) {
    if (key.startsWith("__NEXT_PRIVATE_") || blocked.includes(key)) {
      delete env[key];
    }
  }
  return env;
}

function makeId() {
  return `pty_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {{ agent: string, cols?: number, rows?: number, cwd?: string }} opts
 * @param {(payload: { id: string, type: 'data'|'exit'|'error', data?: string, exitCode?: number }) => void} emit
 */
function createSession(opts, emit) {
  const resolved = resolveAgent(opts.agent);
  if (!resolved.ok) {
    return { ok: false, detail: resolved.detail };
  }

  let pty;
  try {
    pty = loadNodePty();
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const id = makeId();
  const cols = Math.max(20, opts.cols || 120);
  const rows = Math.max(10, opts.rows || 36);
  const cwd = opts.cwd || resolved.cwd;

  let proc;
  try {
    proc = pty.spawn(resolved.command, resolved.args || [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: buildEnv(),
    });
  } catch (e) {
    return {
      ok: false,
      detail: `Failed to spawn ${resolved.label}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const bus = new EventEmitter();
  const session = {
    id,
    agent: opts.agent,
    label: resolved.label,
    display: resolved.display,
    cwd,
    createdAt: new Date().toISOString(),
    exited: false,
    exitCode: null,
    proc,
    bus,
    emit,
  };

  proc.onData((data) => {
    emit({ id, type: "data", data });
  });
  proc.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode ?? 0;
    emit({ id, type: "exit", exitCode: session.exitCode });
    sessions.delete(id);
  });

  sessions.set(id, session);
  return {
    ok: true,
    session: {
      id,
      agent: session.agent,
      label: session.label,
      display: session.display,
      cwd: session.cwd,
      createdAt: session.createdAt,
    },
  };
}

function write(id, data) {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  s.proc.write(data);
  return true;
}

function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  try {
    s.proc.resize(Math.max(20, cols), Math.max(10, rows));
  } catch {
    return false;
  }
  return true;
}

function kill(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    s.proc.kill();
  } catch {
    /* ignore */
  }
  sessions.delete(id);
  return true;
}

function killAll() {
  for (const id of [...sessions.keys()]) {
    kill(id);
  }
}

module.exports = {
  resolveAgent,
  createSession,
  write,
  resize,
  kill,
  killAll,
  loadNodePty,
};
