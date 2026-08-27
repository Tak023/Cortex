/**
 * Headless adapter for the passthrough coding CLIs (Claude Code, Codex).
 *
 * Before this, these agents had no adapter: the pipeline labelled a phase
 * "Claude Code" and then produced it with the simulation adapter, which emits
 * a canned document. Architecture and polish phases were therefore *named*
 * after an agent that never ran.
 *
 * Both CLIs expose a verified non-interactive mode, confirmed against the
 * installed binaries rather than assumed:
 *
 *   claude -p --output-format json   → single JSON object with result + usage
 *   codex exec --json                → JSONL; agent_message item + turn usage
 *
 * Two safety properties, both deliberate:
 *
 *  - **Documents, not writes.** These phases produce Markdown. Claude runs with
 *    Write/Edit/Bash disallowed and Codex in a read-only sandbox, so a phase
 *    that is supposed to describe the work cannot silently perform it.
 *  - **Fleet auth policy applies.** The env is built through the same
 *    governance that covers the embedded terminals, so a Claude run here
 *    cannot fall through to metered API billing when a plan session exists.
 *
 * Server-only (child_process).
 */
import { spawn } from "child_process";
import type { Agent } from "../../types";
import { getSettings } from "../../store";
import { detectAgentAuth } from "../governance";
import { resolveAgentBinary } from "../resolveAgentCommand";
import type { ExternalAgentId } from "../externalAgents";
import { parseClaudeJson, parseCodexJsonl } from "./cliOutput";
import type {
  AgentAdapter,
  AgentHealth,
  AgentInvokeRequest,
  AgentInvokeResult,
} from "./types";

/** Generating a full architecture document is slow; bound it generously. */
const DEFAULT_TIMEOUT_MS = 240_000;
/**
 * Writing a feature across several files takes far longer than describing it.
 * A measured run over a six-feature concept wrote ~40 files and ran past ten
 * minutes, so this is set well above that rather than at it.
 */
const WRITE_TIMEOUT_MS = 1_500_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Write access is only ever granted inside Cortex's own generated workspace
 * tree. A coding agent loose in the user's home directory is exactly the P0
 * the review raised, and a pipeline is unattended — so this is asserted
 * structurally rather than left to the caller's discipline.
 */
function assertContainedWorkspace(dir: string): { ok: boolean; reason?: string } {
  if (!dir) return { ok: false, reason: "no working directory supplied" };
  // Lazily required so this module stays importable where fs is unavailable.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");

  let resolvedDir: string;
  try {
    resolvedDir = fs.realpathSync(dir);
  } catch {
    return { ok: false, reason: `working directory does not exist (${dir})` };
  }
  if (!fs.statSync(resolvedDir).isDirectory()) {
    return { ok: false, reason: "working directory is not a directory" };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDataDir } = require("../../store") as typeof import("../../store");
  let root: string;
  try {
    root = fs.realpathSync(path.join(getDataDir(), "workspaces"));
  } catch {
    return { ok: false, reason: "Cortex workspace root is missing" };
  }

  const rel = path.relative(root, resolvedDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      reason: `${resolvedDir} is outside the Cortex workspace root (${root})`,
    };
  }
  return { ok: true };
}

interface CliSpec {
  external: ExternalAgentId;
  backend: string;
  /** Arguments for a one-shot, read-only, machine-readable run. */
  args: string[];
  /**
   * Arguments for a run that may write files, confined to `cwd`. Values are
   * taken from each CLI's own `--help` enum, verified against the installed
   * binary — a wrong value here does not degrade behaviour, it aborts launch.
   */
  writeArgs: string[];
  /** When true the prompt goes on stdin rather than argv. */
  promptOnStdin: boolean;
  parse(stdout: string): { content: string; tokens?: number; error?: string };
}

const CLI_SPECS: Record<string, CliSpec> = {
  "agent-claude-code": {
    external: "claude-code",
    backend: "claude-code",
    args: [
      "-p",
      "--output-format",
      "json",
      // This phase writes a document. It must not touch the filesystem.
      "--disallowed-tools",
      "Write",
      "Edit",
      "NotebookEdit",
      "Bash",
    ],
    writeArgs: [
      "-p",
      "--output-format",
      "json",
      // Edits applied without prompting — there is no human in a pipeline run.
      // Scope is the cwd the caller passes, which is asserted to be inside
      // Cortex's own workspace tree before write mode is ever enabled.
      "--permission-mode",
      "acceptEdits",
    ],
    promptOnStdin: true,
    parse: parseClaudeJson,
  },
  "agent-codex": {
    external: "codex",
    backend: "codex",
    args: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only"],
    writeArgs: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
    ],
    promptOnStdin: false,
    parse: parseCodexJsonl,
  },
};

/** Agents that can write code, not just describe it. */
export function canGenerateCode(agentId: string): boolean {
  return agentId in CLI_SPECS;
}

export function isCliAgent(agent: Agent): boolean {
  return agent.id in CLI_SPECS;
}

/** Child env with the fleet auth policy applied (see governance.ts). */
function childEnv(external: ExternalAgentId): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  try {
    const auth = detectAgentAuth(
      external,
      getSettings().claudeAuthPreference ?? "auto",
    );
    for (const key of auth.unsetEnv) delete env[key];
  } catch {
    /* governance unavailable — inherit as-is rather than fail the phase */
  }
  // Never leak the Cortex server's Next internals into a child CLI.
  for (const k of Object.keys(env)) {
    if (k.startsWith("__NEXT_PRIVATE_")) delete env[k];
  }
  // NODE_ENV is readonly on the typed ProcessEnv but still deletable at runtime;
  // leaving it set makes child CLIs behave as if they were in a build.
  for (const k of ["NODE_ENV", "PORT", "HOSTNAME"]) {
    delete (env as Record<string, string | undefined>)[k];
  }
  return env;
}

function run(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; detail?: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: opts.cwd, env: opts.env });
    } catch (e) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        detail: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (r: { ok: boolean; detail?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: r.ok, stdout, stderr, detail: r.detail });
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish({ ok: false, detail: `timed out after ${opts.timeoutMs}ms` });
    }, opts.timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString();
    });
    child.on("error", (e) => finish({ ok: false, detail: e.message }));
    child.on("close", (code) =>
      finish({ ok: code === 0, detail: code === 0 ? undefined : `exit ${code}` }),
    );

    if (opts.stdin != null) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

export const cliAgentAdapter: AgentAdapter = {
  id: "cli-agent",

  supports(agent) {
    return isCliAgent(agent);
  },

  async health(agent): Promise<AgentHealth> {
    const spec = CLI_SPECS[agent.id];
    if (!spec) {
      return { ok: false, backend: "cli-agent", detail: "Not a passthrough CLI agent." };
    }
    const resolved = resolveAgentBinary(spec.external);
    if (!resolved.ok || !resolved.command) {
      return { ok: false, backend: spec.backend, detail: resolved.detail };
    }
    const auth = detectAgentAuth(
      spec.external,
      getSettings().claudeAuthPreference ?? "auto",
    );
    return {
      ok: auth.mode !== "unknown",
      backend: spec.backend,
      endpoint: resolved.command,
      detail:
        auth.mode === "unknown"
          ? `${agent.name} is installed but not signed in — ${auth.detail}`
          : `${agent.name} ready (${auth.label})`,
    };
  },

  async invoke(req: AgentInvokeRequest): Promise<AgentInvokeResult> {
    const t0 = Date.now();
    const spec = CLI_SPECS[req.agent.id];
    if (!spec) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: "cli-agent",
        error: `No CLI spec for ${req.agent.id}`,
      };
    }

    const resolved = resolveAgentBinary(spec.external);
    if (!resolved.ok || !resolved.command) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: spec.backend,
        error: resolved.detail,
      };
    }

    const system = req.systemPrompt || req.agent.config.systemPrompt || "";
    const prompt = system ? `${system}\n\n---\n\n${req.prompt}` : req.prompt;

    // ── write mode ──────────────────────────────────────────────────────
    // Only the code-generating phase asks for this, and only into a directory
    // Cortex created. The containment check is here rather than only at the
    // call site so no future caller can hand this adapter an arbitrary path.
    const wantsWrite = req.extras?.writeAccess === true;
    const workDir =
      typeof req.extras?.workDir === "string" ? req.extras.workDir : "";
    let write = false;
    if (wantsWrite) {
      const guard = assertContainedWorkspace(workDir);
      if (!guard.ok) {
        return {
          ok: false,
          content: "",
          agentId: req.agent.id,
          backend: spec.backend,
          error: `Refusing write access: ${guard.reason}`,
        };
      }
      write = true;
    }

    const baseArgs = write ? spec.writeArgs : spec.args;
    const args = spec.promptOnStdin ? baseArgs : [...baseArgs, prompt];
    const cwd = write ? workDir : resolved.cwd;
    const timeoutMs = write ? WRITE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    const result = await run(resolved.command, args, {
      cwd,
      env: childEnv(spec.external),
      stdin: spec.promptOnStdin ? prompt : undefined,
      timeoutMs,
    });

    const latencyMs = Date.now() - t0;

    if (!result.ok && !result.stdout.trim()) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: spec.backend,
        error:
          `${req.agent.name} failed (${result.detail ?? "unknown"})` +
          (result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 300)}` : ""),
        usage: { latencyMs },
      };
    }

    const parsed = spec.parse(result.stdout);
    if (parsed.error || !parsed.content) {
      return {
        ok: false,
        content: "",
        agentId: req.agent.id,
        backend: spec.backend,
        error: parsed.error || `${req.agent.name} returned an empty document.`,
        usage: { latencyMs },
      };
    }

    return {
      ok: true,
      content: parsed.content,
      agentId: req.agent.id,
      backend: spec.backend,
      model: req.agent.model,
      usage: { tokens: parsed.tokens, latencyMs },
    };
  },
};
