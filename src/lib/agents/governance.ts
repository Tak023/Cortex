/**
 * Fleet governance for embedded agent terminals.
 *
 * Three things every agent process gets decided *by Cortex* instead of by
 * whatever each CLI happens to default to:
 *
 *  1. Auth mode — which credential wins (subscription vs metered API key).
 *  2. Working directory — project scope instead of the whole home folder.
 *  3. Approval posture — one fleet policy translated into each CLI's flags.
 *
 * Server-only (fs / child_process). Do not import from client components.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ExternalAgentId } from "./externalAgents";
import { getSettings, getState } from "../store";
import type { AgentApprovalPolicy, AgentWorkspaceScope } from "../types";

export type AgentAuthMode = "subscription" | "api-key" | "both" | "unknown";
export type AgentBilling = "subscription" | "metered" | "unknown";

export interface AgentAuthState {
  mode: AgentAuthMode;
  /** What the process will actually bill against once policy is applied. */
  billing: AgentBilling;
  label: string;
  detail: string;
  /** Env vars removed from the child so the preferred credential wins. */
  unsetEnv: string[];
}

export interface AgentApprovalState {
  requested: AgentApprovalPolicy;
  applied: AgentApprovalPolicy;
  args: string[];
  detail: string;
}

export interface AgentLaunchPlan {
  agent: ExternalAgentId;
  cwd: string;
  cwdScope: AgentWorkspaceScope | "explicit";
  cwdDetail: string;
  auth: AgentAuthState;
  approval: AgentApprovalState;
  /** Extra CLI args contributed by governance (approval policy today). */
  extraArgs: string[];
  /** Env keys the PTY must delete before spawning. */
  unsetEnv: string[];
  notes: string[];
}

function homeDir(): string {
  return process.env.HOME || os.homedir();
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function expandHome(p: string): string {
  if (!p) return p;
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function envSet(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

// ── Auth detection ──────────────────────────────────────────────────────────

/**
 * Claude Code keeps claude.ai OAuth tokens in the login keychain (preferred)
 * and mirrors them to ~/.claude/.credentials.json. Either one means a
 * subscription session exists — and if ANTHROPIC_API_KEY is also exported,
 * the CLI silently bills the API instead of the plan you already pay for.
 */
function hasClaudeSubscription(): boolean {
  if (fileExists(path.join(homeDir(), ".claude", ".credentials.json"))) {
    return true;
  }
  if (process.platform !== "darwin") return false;
  try {
    const blob = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return blob.length > 0;
  } catch {
    return false;
  }
}

function claudeAuth(preference: "auto" | "subscription" | "api-key"): AgentAuthState {
  const subscription = hasClaudeSubscription();
  const apiKey = envSet("ANTHROPIC_API_KEY");

  if (!subscription && !apiKey) {
    return {
      mode: "unknown",
      billing: "unknown",
      label: "not signed in",
      detail: "No claude.ai session and no ANTHROPIC_API_KEY — run `claude /login`.",
      unsetEnv: [],
    };
  }
  if (subscription && !apiKey) {
    return {
      mode: "subscription",
      billing: "subscription",
      label: "subscription",
      detail: "claude.ai session — billed against your plan.",
      unsetEnv: [],
    };
  }
  if (!subscription && apiKey) {
    return {
      mode: "api-key",
      billing: "metered",
      label: "API billing",
      detail:
        "ANTHROPIC_API_KEY only — every token is metered. Run `claude /login` to use a plan.",
      unsetEnv: [],
    };
  }

  // Both present: the environment variable wins unless Cortex removes it.
  if (preference === "api-key") {
    return {
      mode: "both",
      billing: "metered",
      label: "API billing (chosen)",
      detail:
        "claude.ai session and ANTHROPIC_API_KEY are both present; Cortex is honouring the API key.",
      unsetEnv: [],
    };
  }
  return {
    mode: "both",
    billing: "subscription",
    label: "subscription (key masked)",
    detail:
      "claude.ai session and ANTHROPIC_API_KEY are both present. Cortex removes ANTHROPIC_API_KEY from this process so the plan is used instead of metered credits.",
    unsetEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  };
}

function codexAuth(): AgentAuthState {
  const signedIn = fileExists(path.join(homeDir(), ".codex", "auth.json"));
  const apiKey = envSet("OPENAI_API_KEY");
  if (signedIn && !apiKey) {
    return {
      mode: "subscription",
      billing: "subscription",
      label: "ChatGPT sign-in",
      detail: "~/.codex/auth.json — billed against your ChatGPT plan.",
      unsetEnv: [],
    };
  }
  if (signedIn && apiKey) {
    return {
      mode: "both",
      billing: "unknown",
      label: "sign-in + API key",
      detail:
        "Both a Codex sign-in and OPENAI_API_KEY are present — check `codex` which one it selected.",
      unsetEnv: [],
    };
  }
  if (apiKey) {
    return {
      mode: "api-key",
      billing: "metered",
      label: "API billing",
      detail: "OPENAI_API_KEY only — metered usage.",
      unsetEnv: [],
    };
  }
  return {
    mode: "unknown",
    billing: "unknown",
    label: "not signed in",
    detail: "No ~/.codex/auth.json and no OPENAI_API_KEY.",
    unsetEnv: [],
  };
}

function grokAuth(): AgentAuthState {
  const configured =
    fileExists(path.join(homeDir(), ".grok", "auth.json")) ||
    fileExists(path.join(homeDir(), ".grok", "config.toml"));
  const apiKey = envSet("XAI_API_KEY") || envSet("GROK_API_KEY");
  if (apiKey) {
    return {
      mode: "api-key",
      billing: "metered",
      label: "API billing",
      detail: "XAI_API_KEY present — Grok usage is metered against xAI credits.",
      unsetEnv: [],
    };
  }
  return {
    mode: configured ? "subscription" : "unknown",
    billing: configured ? "subscription" : "unknown",
    label: configured ? "CLI sign-in" : "not signed in",
    detail: configured
      ? "Grok CLI has a stored session in ~/.grok."
      : "No stored Grok session and no XAI_API_KEY.",
    unsetEnv: [],
  };
}

function hermesAuth(): AgentAuthState {
  const portal = fileExists(path.join(homeDir(), ".hermes", "auth.json"));
  return {
    // A portal sign-in is the credential; the *billing* behind it is a prepaid
    // credit balance that drains per token, not a flat subscription. Hermes
    // runs as a local CLI but serves a remote model (claude-opus-5 via Nous),
    // so treating it as free on-device inference would under-price every run.
    mode: portal ? "subscription" : "unknown",
    billing: portal ? "metered" : "unknown",
    label: portal ? "Nous Portal credits" : "not signed in",
    detail: portal
      ? "~/.hermes/auth.json — prepaid Nous Portal credits, consumed per token."
      : "No ~/.hermes/auth.json — run `hermes portal login`.",
    unsetEnv: [],
  };
}

function antigravityAuth(): AgentAuthState {
  const configured = isDir(path.join(homeDir(), ".gemini"));
  return {
    mode: configured ? "subscription" : "unknown",
    billing: "unknown",
    label: configured ? "Google account" : "unknown",
    detail: configured
      ? "Antigravity uses the Google account signed into the CLI; Cortex cannot read its quota."
      : "No ~/.gemini directory found.",
    unsetEnv: [],
  };
}

export function detectAgentAuth(
  agent: ExternalAgentId,
  preference: "auto" | "subscription" | "api-key" = "auto",
): AgentAuthState {
  switch (agent) {
    case "claude-code":
      return claudeAuth(preference);
    case "codex":
      return codexAuth();
    case "grok":
      return grokAuth();
    case "hermes":
      return hermesAuth();
    case "antigravity":
      return antigravityAuth();
    default:
      return {
        mode: "unknown",
        billing: "unknown",
        label: "unknown",
        detail: "",
        unsetEnv: [],
      };
  }
}

// ── Approval policy → CLI flags ─────────────────────────────────────────────

type ApprovalSpec = {
  /**
   * Tokens that must all appear in the CLI's own `--help` before Cortex will
   * pass these args — flag names *and* enum values. Claude Code's
   * `--permission-mode` choices differ across releases (this build has
   * `manual` but no `default`), so checking the flag alone is not enough:
   * an unsupported value makes the CLI exit at launch.
   */
  requires: string[];
  args: string[];
};

/**
 * Only agents whose flags we can verify against their own `--help` output get
 * a mapping. Guessing a flag name would make the CLI exit on launch, which is
 * strictly worse than inheriting its default — so unmapped agents report
 * "inherited" in the UI rather than silently pretending to be governed.
 */
const APPROVAL_FLAGS: Partial<
  Record<
    ExternalAgentId,
    Partial<Record<Exclude<AgentApprovalPolicy, "inherit">, ApprovalSpec>>
  >
> = {
  "claude-code": {
    "read-only": {
      requires: ["--permission-mode", "plan"],
      args: ["--permission-mode", "plan"],
    },
    ask: {
      requires: ["--permission-mode", "manual"],
      args: ["--permission-mode", "manual"],
    },
    auto: {
      requires: ["--permission-mode", "acceptEdits"],
      args: ["--permission-mode", "acceptEdits"],
    },
  },
  codex: {
    "read-only": {
      requires: ["--sandbox", "read-only"],
      args: ["--sandbox", "read-only"],
    },
    ask: {
      requires: ["--ask-for-approval", "on-request"],
      args: ["--ask-for-approval", "on-request"],
    },
    auto: {
      requires: [
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
      ],
      args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
    },
  },
};

const helpCache = new Map<string, string>();

/** `bin --help`, cached for the process lifetime. Empty string on any failure. */
function readHelp(command: string): string {
  const cached = helpCache.get(command);
  if (cached != null) return cached;
  let text = "";
  try {
    text = execFileSync(command, ["--help"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
  } catch (e) {
    // Many CLIs exit non-zero on --help but still print usage to stdout.
    const out = e as { stdout?: Buffer | string };
    text = typeof out?.stdout === "string" ? out.stdout : (out?.stdout?.toString() ?? "");
  }
  helpCache.set(command, text);
  return text;
}

export function resolveApproval(
  agent: ExternalAgentId,
  requested: AgentApprovalPolicy,
  command: string | undefined,
  opts: { probe?: boolean } = {},
): AgentApprovalState {
  if (requested === "inherit") {
    return {
      requested,
      applied: "inherit",
      args: [],
      detail: "Using the CLI's own default approval mode.",
    };
  }
  const spec = APPROVAL_FLAGS[agent]?.[requested];
  if (!spec) {
    return {
      requested,
      applied: "inherit",
      args: [],
      detail: `${agent} has no verified approval flag — Cortex cannot enforce "${requested}" here.`,
    };
  }
  if (!command) {
    return {
      requested,
      applied: "inherit",
      args: [],
      detail: "CLI not resolved, so no approval flag was applied.",
    };
  }
  if (opts.probe !== false) {
    const help = readHelp(command);
    const missing = spec.requires.filter((flag) => !help.includes(flag));
    if (missing.length) {
      return {
        requested,
        applied: "inherit",
        args: [],
        detail: `Installed CLI does not advertise ${missing.join(", ")} — left at its own default.`,
      };
    }
  }
  return {
    requested,
    applied: requested,
    args: [...spec.args],
    detail: `Enforced with \`${spec.args.join(" ")}\`.`,
  };
}

// ── Working directory scope ─────────────────────────────────────────────────

/** Most recently touched project workspace, if one exists on disk. */
function activeProjectDir(): { dir: string; name: string } | null {
  try {
    const projects = [...getState().projects].sort((a, b) =>
      (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
    for (const p of projects) {
      const candidate = p.appPath || p.workspacePath;
      if (candidate && isDir(candidate)) {
        return { dir: candidate, name: p.name };
      }
    }
  } catch {
    /* store unavailable — fall through to home */
  }
  return null;
}

export function resolveWorkspace(
  scope: AgentWorkspaceScope,
  customDir: string,
  explicit?: string,
): { cwd: string; scope: AgentWorkspaceScope | "explicit"; detail: string } {
  const home = homeDir();

  if (explicit) {
    const dir = expandHome(explicit);
    if (isDir(dir)) {
      return { cwd: dir, scope: "explicit", detail: "Directory chosen for this session." };
    }
    return {
      cwd: home,
      scope: "home",
      detail: `Requested directory does not exist (${explicit}) — fell back to the home folder.`,
    };
  }

  if (scope === "custom") {
    const dir = expandHome((customDir || "").trim());
    if (dir && isDir(dir)) {
      return { cwd: dir, scope: "custom", detail: "Fixed workspace from Settings." };
    }
    return {
      cwd: home,
      scope: "home",
      detail:
        "Custom workspace is unset or missing — fell back to the home folder. Set one in Settings › Fleet governance.",
    };
  }

  if (scope === "project") {
    const active = activeProjectDir();
    if (active) {
      return {
        cwd: active.dir,
        scope: "project",
        detail: `Scoped to the active project "${active.name}".`,
      };
    }
    const fallback = expandHome((customDir || "").trim());
    if (fallback && isDir(fallback)) {
      return {
        cwd: fallback,
        scope: "custom",
        detail: "No project workspace yet — using the fixed workspace from Settings.",
      };
    }
    return {
      cwd: home,
      scope: "home",
      detail:
        "No project workspace yet — the whole home folder is in scope. Set a fixed workspace in Settings › Fleet governance to narrow it.",
    };
  }

  return {
    cwd: home,
    scope: "home",
    detail: "Home folder scope — every file you own is visible to this agent.",
  };
}

// ── Plan ────────────────────────────────────────────────────────────────────

export function buildLaunchPlan(opts: {
  agent: ExternalAgentId;
  command?: string;
  /** Per-session override, e.g. ?cwd= on the terminal route. */
  cwd?: string;
  probeApproval?: boolean;
}): AgentLaunchPlan {
  const settings = getSettings();
  const auth = detectAgentAuth(opts.agent, settings.claudeAuthPreference ?? "auto");
  const approval = resolveApproval(
    opts.agent,
    settings.agentApprovalPolicy ?? "inherit",
    opts.command,
    { probe: opts.probeApproval },
  );
  const workspace = resolveWorkspace(
    settings.agentWorkspaceScope ?? "project",
    settings.agentWorkspaceDir ?? "",
    opts.cwd,
  );

  const notes: string[] = [];
  if (auth.billing === "metered" && auth.mode === "both") {
    notes.push(
      "Two credentials are active for this agent — check Settings › Fleet governance if the billing is not what you expect.",
    );
  }
  if (workspace.scope === "home") notes.push(workspace.detail);
  if (approval.requested !== "inherit" && approval.applied === "inherit") {
    notes.push(approval.detail);
  }

  return {
    agent: opts.agent,
    cwd: workspace.cwd,
    cwdScope: workspace.scope,
    cwdDetail: workspace.detail,
    auth,
    approval,
    extraArgs: approval.args,
    unsetEnv: auth.unsetEnv,
    notes,
  };
}
