/**
 * Spend caps with a hard stop.
 *
 * Cortex records a `UsageRecord` for every phase it runs, so the spend is
 * already known — it just was never allowed to change a decision. This turns
 * that ledger into a gate: when a window is exhausted, metered agents stop
 * being routable, and if nothing free can do the work the project pauses with
 * an explicit reason instead of quietly spending past the cap.
 *
 * Only *metered* spend counts. Work done on a local model or inside a
 * subscription you already pay for is free at the margin and must not consume
 * a budget that exists to bound marginal cost.
 */
import type { UsageRecord } from "../types";
import { getSettings, getState } from "../store";

export type BudgetWindow = "day" | "project";

export interface BudgetState {
  /** Cap in USD, or null when the window is uncapped. */
  capUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  /** True when a cap exists and is fully consumed. */
  exhausted: boolean;
  /** Fraction of the cap used, 0–1+. null when uncapped. */
  utilization: number | null;
}

export interface BudgetReport {
  day: BudgetState;
  project: BudgetState | null;
  /** True when any cap in scope is exhausted. */
  blocked: boolean;
  reason: string | null;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sumMeteredSpend(
  usage: UsageRecord[],
  filter: (u: UsageRecord) => boolean,
): number {
  let total = 0;
  for (const u of usage) {
    if (!filter(u)) continue;
    total += Math.max(0, u.costUsd);
  }
  return total;
}

function windowState(capRaw: number | null, spentUsd: number): BudgetState {
  const cap =
    typeof capRaw === "number" && Number.isFinite(capRaw) && capRaw > 0
      ? capRaw
      : null;
  if (cap == null) {
    return {
      capUsd: null,
      spentUsd,
      remainingUsd: null,
      exhausted: false,
      utilization: null,
    };
  }
  const remaining = cap - spentUsd;
  return {
    capUsd: cap,
    spentUsd,
    remainingUsd: remaining,
    exhausted: remaining <= 0,
    utilization: spentUsd / cap,
  };
}

export function budgetReport(projectId?: string | null): BudgetReport {
  const settings = getSettings();
  const usage = getState().usage;
  const since = startOfToday();

  const daySpend = sumMeteredSpend(
    usage,
    (u) => new Date(u.createdAt).getTime() >= since,
  );
  const day = windowState(settings.dailyBudgetUsd ?? null, daySpend);

  let project: BudgetState | null = null;
  if (projectId) {
    const projectSpend = sumMeteredSpend(usage, (u) => u.projectId === projectId);
    project = windowState(settings.projectBudgetUsd ?? null, projectSpend);
  }

  const blocked = day.exhausted || Boolean(project?.exhausted);
  const reason = day.exhausted
    ? `Daily metered budget of $${day.capUsd?.toFixed(2)} is spent ($${day.spentUsd.toFixed(2)} today).`
    : project?.exhausted
      ? `Project metered budget of $${project.capUsd?.toFixed(2)} is spent ($${project.spentUsd.toFixed(2)}).`
      : null;

  return { day, project, blocked, reason };
}

/**
 * Would spending `estimateUsd` more break a cap? Used before dispatching to a
 * metered agent so the cap is a ceiling rather than something noticed after
 * the fact.
 */
export function wouldExceedBudget(
  estimateUsd: number,
  projectId?: string | null,
): { exceeds: boolean; reason: string | null; report: BudgetReport } {
  const report = budgetReport(projectId);
  // Free work cannot exceed a spend cap, even when one is already exhausted.
  // A capped day must degrade to local-only, not halt everything.
  if (estimateUsd <= 0) {
    return { exceeds: false, reason: null, report };
  }
  if (report.day.capUsd != null && report.day.spentUsd + estimateUsd > report.day.capUsd) {
    return {
      exceeds: true,
      reason: `This run (~$${estimateUsd.toFixed(2)}) would pass the $${report.day.capUsd.toFixed(2)} daily cap.`,
      report,
    };
  }
  if (
    report.project?.capUsd != null &&
    report.project.spentUsd + estimateUsd > report.project.capUsd
  ) {
    return {
      exceeds: true,
      reason: `This run (~$${estimateUsd.toFixed(2)}) would pass the $${report.project.capUsd.toFixed(2)} project cap.`,
      report,
    };
  }
  return { exceeds: report.blocked, reason: report.reason, report };
}
