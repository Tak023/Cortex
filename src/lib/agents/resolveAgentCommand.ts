/**
 * Resolve how to run an external AI coding agent CLI (no side effects).
 * Server-only — do not import from client components.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  EXTERNAL_AGENTS,
  type ExternalAgentId,
} from "./externalAgents";
import { buildLaunchPlan, type AgentLaunchPlan } from "./governance";

export type ResolvedAgentCommand = {
  ok: boolean;
  agent: ExternalAgentId;
  label: string;
  /** Absolute path to executable (preferred). */
  command?: string;
  args: string[];
  cwd: string;
  /** Human-readable command line for display. */
  display: string;
  detail: string;
  /** Auth mode, approval posture and workspace scope decided by Cortex. */
  governance?: AgentLaunchPlan;
};

export type ResolveOptions = {
  /** Per-session working directory override. */
  cwd?: string;
  /**
   * Set false to skip fleet governance and get the raw binary lookup
   * (equivalent to calling `resolveAgentBinary`).
   */
  govern?: boolean;
  /** Skip the `--help` probe when applying approval flags (tests / speed). */
  probeApproval?: boolean;
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

function labelFor(id: ExternalAgentId): string {
  return EXTERNAL_AGENTS.find((a) => a.id === id)?.label ?? id;
}

function ok(
  agent: ExternalAgentId,
  command: string,
  args: string[],
  detail: string,
): ResolvedAgentCommand {
  const cwd = process.env.HOME || os.homedir();
  const display =
    args.length > 0 ? `${command} ${args.join(" ")}` : command;
  return {
    ok: true,
    agent,
    label: labelFor(agent),
    command,
    args,
    cwd,
    display,
    detail,
  };
}

function fail(agent: ExternalAgentId, detail: string): ResolvedAgentCommand {
  return {
    ok: false,
    agent,
    label: labelFor(agent),
    args: [],
    cwd: process.env.HOME || os.homedir(),
    display: "",
    detail,
  };
}

/**
 * Resolve the CLI binary only — no governance, no child processes touched.
 * Callers that are about to *spawn* should use `resolveAgentCommand` so the
 * fleet approval policy and workspace scope are applied.
 */
export function resolveAgentBinary(id: ExternalAgentId): ResolvedAgentCommand {
  switch (id) {
    case "hermes": {
      const bin = whichLike([
        "hermes",
        path.join(os.homedir(), ".local/bin/hermes"),
      ]);
      if (bin) {
        return ok(id, bin, [], `Resolved Hermes CLI (${bin})`);
      }
      return fail(
        id,
        "Hermes CLI not found. Install Hermes and ensure `hermes` is on PATH (~/.local/bin/hermes).",
      );
    }
    case "claude-code": {
      const bin = whichLike([
        "claude",
        path.join(os.homedir(), ".local/bin/claude"),
      ]);
      if (bin) {
        return ok(id, bin, [], `Resolved Claude Code CLI (${bin})`);
      }
      return fail(
        id,
        "Claude Code not found. Install the Anthropic CLI (`claude`).",
      );
    }
    case "codex": {
      const bin = whichLike([
        "codex",
        path.join(os.homedir(), ".local/bin/codex"),
        path.join(os.homedir(), ".codex/bin/codex"),
      ]);
      if (bin) {
        return ok(id, bin, [], `Resolved Codex CLI (${bin})`);
      }
      const npx = whichLike(["npx"]);
      if (npx) {
        return ok(
          id,
          npx,
          ["-y", "@openai/codex"],
          "Resolved Codex via npx @openai/codex",
        );
      }
      return fail(
        id,
        "Codex not found. Install OpenAI Codex CLI (`codex`) or ensure npx is available.",
      );
    }
    case "grok": {
      const bin = whichLike([
        "grok",
        path.join(os.homedir(), ".grok/bin/grok"),
        path.join(os.homedir(), ".local/bin/grok"),
      ]);
      if (bin) {
        return ok(id, bin, [], `Resolved Grok CLI (${bin})`);
      }
      return fail(
        id,
        "Grok CLI not found. Install Grok Build / grok CLI (~/.grok/bin/grok).",
      );
    }
    case "antigravity": {
      const bin = whichLike([
        "agy",
        "antigravity",
        path.join(os.homedir(), ".local/bin/agy"),
        path.join(os.homedir(), ".gemini/antigravity-cli/bin/agy"),
      ]);
      if (bin) {
        return ok(id, bin, [], `Resolved Antigravity CLI (${bin})`);
      }
      return fail(
        id,
        "Antigravity CLI not found. Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash` so `agy` is on PATH (~/.local/bin/agy).",
      );
    }
    default:
      return fail(id, `Unknown agent: ${id}`);
  }
}

/**
 * Resolve the CLI *and* the governance around it: which credential wins, which
 * directory the process may see, and which approval flags to pass.
 *
 * The approval flags are only added when the installed CLI advertises them in
 * its own `--help`, so a policy can never break a launch.
 */
export function resolveAgentCommand(
  id: ExternalAgentId,
  opts: ResolveOptions = {},
): ResolvedAgentCommand {
  const base = resolveAgentBinary(id);
  if (opts.govern === false) return base;

  let governance: AgentLaunchPlan;
  try {
    governance = buildLaunchPlan({
      agent: id,
      command: base.ok ? base.command : undefined,
      cwd: opts.cwd,
      probeApproval: opts.probeApproval,
    });
  } catch {
    // Governance must never be the reason a terminal fails to open.
    return base;
  }

  const args = [...base.args, ...governance.extraArgs];
  return {
    ...base,
    args,
    cwd: governance.cwd,
    display: base.command
      ? [base.command, ...args].join(" ")
      : base.display,
    governance,
  };
}
