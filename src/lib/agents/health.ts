/**
 * Fleet health — one place that answers "what is actually installed, how is it
 * authenticated, and what can it touch?" for every embedded agent CLI.
 *
 * Everything here is read live from the machine. Nothing is seeded: when a
 * value cannot be determined it comes back null and the UI renders a dash
 * rather than a confident-looking guess.
 *
 * Server-only (child_process).
 */
import { execFileSync } from "child_process";
import { EXTERNAL_AGENTS, type ExternalAgentId } from "./externalAgents";
import { resolveAgentBinary } from "./resolveAgentCommand";
import { buildLaunchPlan } from "./governance";
import type { AgentApprovalPolicy, AgentWorkspaceScope } from "../types";

export interface AgentHealthRow {
  id: ExternalAgentId;
  label: string;
  installed: boolean;
  /** Absolute path to the binary Cortex will run. */
  command: string | null;
  /** First line of `bin --version`, or null when the CLI does not report one. */
  version: string | null;
  auth: { label: string; billing: string; detail: string };
  approval: { requested: AgentApprovalPolicy; applied: AgentApprovalPolicy; detail: string };
  workspace: { cwd: string; scope: AgentWorkspaceScope | "explicit"; detail: string };
  notes: string[];
  detail: string;
}

const VERSION_TTL_MS = 5 * 60_000;
const versionCache = new Map<string, { at: number; value: string | null }>();

/** `bin --version`, trimmed to its first meaningful line. Null on any failure. */
export function probeVersion(command: string): string | null {
  const cached = versionCache.get(command);
  if (cached && Date.now() - cached.at < VERSION_TTL_MS) return cached.value;

  let value: string | null = null;
  try {
    const raw = execFileSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    value =
      raw
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? null;
    if (value && value.length > 120) value = `${value.slice(0, 117)}…`;
  } catch {
    value = null;
  }
  versionCache.set(command, { at: Date.now(), value });
  return value;
}

export function fleetHealth(opts: { probeVersions?: boolean } = {}): AgentHealthRow[] {
  return EXTERNAL_AGENTS.map((meta) => {
    const resolved = resolveAgentBinary(meta.id);
    const installed = Boolean(resolved.ok && resolved.command);
    const command = installed ? resolved.command! : null;
    const plan = buildLaunchPlan({ agent: meta.id, command: command ?? undefined });

    return {
      id: meta.id,
      label: meta.label,
      installed,
      command,
      version:
        installed && opts.probeVersions !== false ? probeVersion(command!) : null,
      auth: {
        label: plan.auth.label,
        billing: plan.auth.billing,
        detail: plan.auth.detail,
      },
      approval: {
        requested: plan.approval.requested,
        applied: plan.approval.applied,
        detail: plan.approval.detail,
      },
      workspace: {
        cwd: plan.cwd,
        scope: plan.cwdScope,
        detail: plan.cwdDetail,
      },
      notes: plan.notes,
      detail: resolved.detail,
    };
  });
}
