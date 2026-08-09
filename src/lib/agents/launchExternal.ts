/**
 * Launch external AI coding agents (Hermes, Claude Code, Codex, Grok).
 * Runs on the Node server (including Electron-packaged Next).
 * Do not import this module from client components — use externalAgents.ts.
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  EXTERNAL_AGENTS,
  type ExternalAgentId,
} from "./externalAgents";

export type { ExternalAgentId };
export { EXTERNAL_AGENTS };

export type LaunchResult = {
  ok: boolean;
  agent: ExternalAgentId;
  method?: string;
  detail: string;
};

const DETACHED: { detached: true; stdio: "ignore" } = {
  detached: true,
  stdio: "ignore",
};

function exists(p: string | undefined | null): p is string {
  return Boolean(p && fs.existsSync(p));
}

function whichLike(names: string[]): string | null {
  const pathEnv = process.env.PATH || "";
  const dirs = [
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".grok/bin"),
    path.join(os.homedir(), ".codex/bin"),
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

function runDetached(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcess {
  const child = spawn(command, args, {
    ...DETACHED,
    cwd: opts?.cwd || process.env.HOME || os.homedir(),
    env: { ...process.env, ...opts?.env },
  });
  child.unref();
  return child;
}

/** Open a macOS .app bundle by name or path. */
function openMacApp(appNameOrPath: string): boolean {
  if (process.platform !== "darwin") return false;
  try {
    runDetached("open", ["-a", appNameOrPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a shell command in the user's default terminal (macOS Terminal.app).
 * Escapes for AppleScript carefully.
 */
function openInMacTerminal(command: string, cwd?: string): boolean {
  if (process.platform !== "darwin") return false;
  const workdir = cwd || process.env.HOME || os.homedir();
  // Build: cd to dir then run command
  const script = `cd ${shellQuote(workdir)} && ${command}`;
  // AppleScript string: escape backslash and double-quote
  const asLiteral = script.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    runDetached("osascript", [
      "-e",
      `tell application "Terminal" to activate`,
      "-e",
      `tell application "Terminal" to do script "${asLiteral}"`,
    ]);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Prefer GUI app, else Terminal CLI. */
function launchHermes(): LaunchResult {
  const appCandidates = [
    "/Applications/Hermes.app",
    path.join(os.homedir(), "Applications/Hermes.app"),
  ];
  for (const app of appCandidates) {
    if (exists(app) && openMacApp(app)) {
      return {
        ok: true,
        agent: "hermes",
        method: "app",
        detail: `Opened ${path.basename(app)}`,
      };
    }
  }
  if (openMacApp("Hermes")) {
    return {
      ok: true,
      agent: "hermes",
      method: "app",
      detail: "Opened Hermes",
    };
  }
  const bin = whichLike(["hermes", path.join(os.homedir(), ".local/bin/hermes")]);
  if (bin && openInMacTerminal(shellQuote(bin))) {
    return {
      ok: true,
      agent: "hermes",
      method: "terminal",
      detail: `Launched Hermes CLI in Terminal (${bin})`,
    };
  }
  return {
    ok: false,
    agent: "hermes",
    detail:
      "Hermes not found. Install Hermes.app or ensure `hermes` is on PATH (~/.local/bin/hermes).",
  };
}

function launchClaudeCode(): LaunchResult {
  // Prefer Claude Code CLI in Terminal — not only the consumer Claude.app chat.
  const bin = whichLike(["claude", path.join(os.homedir(), ".local/bin/claude")]);
  if (bin && openInMacTerminal(shellQuote(bin))) {
    return {
      ok: true,
      agent: "claude-code",
      method: "terminal",
      detail: `Launched Claude Code in Terminal (${bin})`,
    };
  }
  // Fallbacks: Claude desktop / Code URL handler
  const apps = [
    path.join(
      os.homedir(),
      "Library/Application Support/Claude/claude-code",
    ),
    "/Applications/Claude.app",
  ];
  // Try nested claude.app from Claude Code install tree
  try {
    const support = path.join(
      os.homedir(),
      "Library/Application Support/Claude/claude-code",
    );
    if (exists(support)) {
      const entries = fs.readdirSync(support);
      for (const e of entries) {
        const candidate = path.join(support, e, "claude.app");
        if (exists(candidate) && openMacApp(candidate)) {
          return {
            ok: true,
            agent: "claude-code",
            method: "app",
            detail: `Opened Claude Code app (${candidate})`,
          };
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (exists("/Applications/Claude.app") && openMacApp("Claude")) {
    return {
      ok: true,
      agent: "claude-code",
      method: "app",
      detail: "Opened Claude.app (install `claude` CLI for full Claude Code)",
    };
  }
  void apps;
  return {
    ok: false,
    agent: "claude-code",
    detail:
      "Claude Code not found. Install with Anthropic’s CLI (`claude`) or Claude Desktop.",
  };
}

function launchCodex(): LaunchResult {
  const bin = whichLike([
    "codex",
    path.join(os.homedir(), ".local/bin/codex"),
    path.join(os.homedir(), ".codex/bin/codex"),
  ]);
  if (bin && openInMacTerminal(shellQuote(bin))) {
    return {
      ok: true,
      agent: "codex",
      method: "terminal",
      detail: `Launched Codex in Terminal (${bin})`,
    };
  }
  // npx fallback (OpenAI Codex CLI package)
  if (openInMacTerminal("npx -y @openai/codex")) {
    return {
      ok: true,
      agent: "codex",
      method: "terminal-npx",
      detail: "Launched Codex via npx @openai/codex in Terminal",
    };
  }
  return {
    ok: false,
    agent: "codex",
    detail:
      "Codex not found. Install OpenAI Codex CLI (`codex`) or ensure npx is available.",
  };
}

function launchGrok(): LaunchResult {
  const bin = whichLike([
    "grok",
    path.join(os.homedir(), ".grok/bin/grok"),
    path.join(os.homedir(), ".local/bin/grok"),
  ]);
  if (bin && openInMacTerminal(shellQuote(bin))) {
    return {
      ok: true,
      agent: "grok",
      method: "terminal",
      detail: `Launched Grok Code in Terminal (${bin})`,
    };
  }
  return {
    ok: false,
    agent: "grok",
    detail:
      "Grok CLI not found. Install Grok Build / grok CLI (~/.grok/bin/grok).",
  };
}

export function launchExternalAgent(id: ExternalAgentId): LaunchResult {
  switch (id) {
    case "hermes":
      return launchHermes();
    case "claude-code":
      return launchClaudeCode();
    case "codex":
      return launchCodex();
    case "grok":
      return launchGrok();
    default:
      return {
        ok: false,
        agent: id,
        detail: `Unknown agent: ${id}`,
      };
  }
}
