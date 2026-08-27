/**
 * Feature code generation — the phase that actually builds the app.
 *
 * The Implementation phase used to scaffold a fixed starter page that
 * interpolated the concept's title, summary, features and stack. Whatever you
 * asked for, you got the same page. This runs a coding agent against the
 * scaffold with write access, so the features described in the concept and the
 * architecture document are implemented rather than listed.
 *
 * Three properties make that safe to run unattended:
 *
 *  1. **Contained.** Writes go only into the project's own generated workspace,
 *     asserted in the adapter itself, not just here.
 *  2. **Governed.** A `read-only` fleet approval policy disables code
 *     generation outright rather than quietly ignoring the setting.
 *  3. **Never worse off.** The scaffold is snapshotted first. If generation
 *     breaks the build and the repair rounds cannot fix it, the working
 *     scaffold is restored and the failure is reported honestly.
 *
 * Server-only.
 */
import fs from "fs";
import path from "path";
import type { Project } from "../types";
import { getSettings } from "../store";
import { invokeAgent } from "../agents/adapters";
import { canGenerateCode } from "../agents/adapters/cliAgent";
import { verifyAppBuild } from "./verify";
import { findUnstyledClasses } from "./styleCheck";

/** Directories never copied in a snapshot — regenerable and huge. */
const SNAPSHOT_SKIP = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "test-results",
  ".git",
]);

export interface CodegenResult {
  ok: boolean;
  /** True when generation was skipped rather than attempted. */
  skipped: boolean;
  reason: string;
  /** Repair rounds used after the first generation attempt. */
  repairRounds: number;
  filesChanged: string[];
  tokens: number;
  restoredFromSnapshot: boolean;
  log: string[];
}

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SNAPSHOT_SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(abs, base, out);
    else if (e.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

function snapshot(appDir: string, dest: string) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of listFiles(appDir)) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(appDir, rel), to);
  }
}

function restore(appDir: string, from: string) {
  // Remove generated source but leave node_modules so a restore does not
  // trigger a fresh install.
  for (const rel of listFiles(appDir)) {
    try {
      fs.rmSync(path.join(appDir, rel), { force: true });
    } catch {
      /* best effort */
    }
  }
  for (const rel of listFiles(from)) {
    const to = path.join(appDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(from, rel), to);
  }
}

/**
 * Tolerance before missing styles are treated as a defect. A couple of
 * unmatched names can be legitimate (global resets, third-party hooks); a
 * hundred means the stylesheet was never written.
 */
const MAX_TOLERATED_UNSTYLED = 3;

/** Files whose content changed, added or removed, versus the snapshot. */
function diffAgainst(appDir: string, snapDir: string): string[] {
  const before = new Set(listFiles(snapDir));
  const after = listFiles(appDir);
  const changed: string[] = [];
  for (const rel of after) {
    if (!before.has(rel)) {
      changed.push(rel);
      continue;
    }
    try {
      const a = fs.readFileSync(path.join(appDir, rel));
      const b = fs.readFileSync(path.join(snapDir, rel));
      if (!a.equals(b)) changed.push(rel);
    } catch {
      changed.push(rel);
    }
    before.delete(rel);
  }
  for (const rel of before) changed.push(`${rel} (removed)`);
  return changed;
}

function buildPrompt(opts: {
  project: Project;
  architecture: string;
  planning: string;
  repair?: { errors: string; round: number };
}): string {
  const { project, architecture, planning, repair } = opts;
  const c = project.concept;

  if (repair) {
    return [
      `The app in this directory has a problem. Fix it.`,
      ``,
      `## What is wrong`,
      "```",
      repair.errors.slice(0, 6000),
      "```",
      ``,
      `## Rules`,
      `- Fix the errors above. Do not restructure working code.`,
      `- Do not add dependencies unless the error is a missing module that the`,
      `  feature genuinely requires; prefer removing the usage.`,
      `- Do not edit package.json scripts, next.config.mjs, tsconfig.json,`,
      `  vitest.config.ts or playwright.config.ts.`,
      `- When done, the app must build with \`npm run build\`.`,
    ].join("\n");
  }

  return [
    `Implement this application. A Next.js App Router scaffold already exists`,
    `in this directory — extend it into the real product described below.`,
    ``,
    `## Product: ${c.title}`,
    c.summary,
    ``,
    `## Features to implement`,
    ...(c.features?.length
      ? c.features.map((f) => `- ${f}`)
      : ["- (none listed — infer from the summary)"]),
    ``,
    `## Stack already configured`,
    (c.stack ?? []).join(", ") || "Next.js, React, TypeScript",
    ``,
    architecture ? `## Architecture\n${architecture.slice(0, 8000)}` : "",
    planning ? `## Plan\n${planning.slice(0, 3000)}` : "",
    ``,
    `## Rules`,
    `- Replace the placeholder page with a real implementation of the features.`,
    `- Build every feature listed. If a feature needs an image, icon or other`,
    `  asset, generate it as SVG committed into the project — do not reference`,
    `  files that will not exist, and do not link to remote placeholders.`,
    `- If the concept calls for branding or a favicon, create them (SVG, plus`,
    `  \`app/icon.svg\` for the favicon) rather than leaving them to be added.`,
    `- Use only dependencies already in package.json. If something genuinely`,
    `  cannot be built without a new dependency, implement the nearest thing`,
    `  that works without it.`,
    `- **There is no CSS framework installed.** Tailwind, CSS modules and`,
    `  styled-components are all unavailable. Every class name you put in a`,
    `  \`className\` must have a matching rule written by you in`,
    `  \`app/globals.css\`. A page that compiles but renders unstyled is a`,
    `  failure — the app must look finished, with real layout, spacing,`,
    `  typography and colour.`,
    `- Do not edit package.json scripts, next.config.mjs, tsconfig.json,`,
    `  vitest.config.ts or playwright.config.ts.`,
    `- Keep TypeScript strict-clean. The app must build with \`npm run build\`.`,
    `- Prefer static rendering; no runtime secrets or network calls at build.`,
    ``,
    `Work directly on the files. Report what you changed when finished.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate the app's feature code, then verify and repair until it builds.
 *
 * Returns `skipped` rather than failing when generation is not possible, so
 * the caller can keep the scaffold and say why.
 */
export async function generateFeatureCode(opts: {
  project: Project;
  appDir: string;
  agentId: string | null;
  /** Repair attempts after the first build failure. */
  maxRepairRounds?: number;
  onProgress?: (message: string) => void;
}): Promise<CodegenResult> {
  const { project, appDir, agentId } = opts;
  const maxRepairRounds = opts.maxRepairRounds ?? 2;
  const log: string[] = [];
  const note = (m: string) => {
    log.push(m);
    opts.onProgress?.(m);
  };

  const base: CodegenResult = {
    ok: false,
    skipped: true,
    reason: "",
    repairRounds: 0,
    filesChanged: [],
    tokens: 0,
    restoredFromSnapshot: false,
    log,
  };

  const settings = getSettings();
  if (settings.agentApprovalPolicy === "read-only") {
    return {
      ...base,
      reason:
        "Approval policy is read-only, so Cortex did not let an agent write code. " +
        "Set Settings › Fleet governance to ask or auto to enable code generation.",
    };
  }
  if (settings.codegenEnabled === false) {
    return { ...base, reason: "Code generation is disabled in Settings." };
  }
  if (!agentId || !canGenerateCode(agentId)) {
    return {
      ...base,
      reason:
        `${agentId ?? "No agent"} cannot write code — only Claude Code and Codex ` +
        `have a write-capable adapter. The scaffold was left as-is.`,
    };
  }
  if (!fs.existsSync(appDir)) {
    return { ...base, reason: `App directory missing: ${appDir}` };
  }

  const snapDir = path.join(path.dirname(appDir), ".cortex-scaffold-snapshot");
  try {
    snapshot(appDir, snapDir);
  } catch (e) {
    return {
      ...base,
      reason: `Could not snapshot the scaffold, so generation was skipped: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const architecture = project.sharedMemory?.architecture ?? "";
  const planning = project.sharedMemory?.planning ?? "";
  let tokens = 0;
  let repairRounds = 0;

  note(`Generating feature code with ${agentId}…`);
  const first = await invokeAgent({
    agentId,
    prompt: buildPrompt({ project, architecture, planning }),
    phase: "implementation",
    projectId: project.id,
    extras: { writeAccess: true, workDir: appDir },
  });
  tokens += first.usage?.tokens ?? 0;

  if (!first.ok) {
    try {
      restore(appDir, snapDir);
    } catch {
      /* scaffold may already be intact */
    }
    return {
      ...base,
      skipped: false,
      reason: `Code generation failed: ${first.error ?? "unknown error"}`,
      tokens,
      restoredFromSnapshot: true,
    };
  }

  // ── verify, then repair ──────────────────────────────────────────────
  let verify = await verifyAppBuild(appDir, {
    concept: project.concept,
    generateTests: false,
    browserInspect: false,
  });

  // A clean compile is necessary but not sufficient: the app also has to be
  // styled. Both defects go through the same repair loop.
  const styleProblem = (): string | null => {
    const missing = findUnstyledClasses(appDir);
    if (missing.length <= MAX_TOLERATED_UNSTYLED) return null;
    return [
      `The app compiles, but ${missing.length} class names used in JSX have no`,
      `CSS rule anywhere, so the page renders unstyled.`,
      ``,
      `Write the missing styles into app/globals.css. Missing classes:`,
      missing.slice(0, 120).join(", "),
    ].join("\n");
  };

  while (
    (!verify.buildOk || styleProblem()) &&
    repairRounds < maxRepairRounds
  ) {
    repairRounds += 1;
    const style = verify.buildOk ? styleProblem() : null;
    const errors = style
      ? style
      : verify.unresolvedErrors.join("\n") || verify.report.slice(-6000);
    note(
      style
        ? `Compiles but unstyled — repair round ${repairRounds}/${maxRepairRounds}…`
        : `Build failed — repair round ${repairRounds}/${maxRepairRounds}…`,
    );
    const fix = await invokeAgent({
      agentId,
      prompt: buildPrompt({
        project,
        architecture,
        planning,
        repair: { errors, round: repairRounds },
      }),
      phase: "implementation",
      projectId: project.id,
      extras: { writeAccess: true, workDir: appDir },
    });
    tokens += fix.usage?.tokens ?? 0;
    if (!fix.ok) {
      note(`Repair round ${repairRounds} could not run: ${fix.error ?? "unknown"}`);
      break;
    }
    verify = await verifyAppBuild(appDir, {
      concept: project.concept,
      generateTests: false,
      browserInspect: false,
    });
  }

  const filesChanged = diffAgainst(appDir, snapDir);
  const remainingStyleProblem = styleProblem();

  if (!verify.buildOk) {
    // Never hand back something worse than what we started with.
    let restored = false;
    try {
      restore(appDir, snapDir);
      restored = true;
    } catch {
      /* leave the broken tree; the report explains */
    }
    return {
      ok: false,
      skipped: false,
      reason:
        `Generated code did not build after ${repairRounds} repair round(s). ` +
        (restored
          ? "The working scaffold was restored, so the project still runs."
          : "The scaffold could not be restored automatically."),
      repairRounds,
      filesChanged,
      tokens,
      restoredFromSnapshot: restored,
      log,
    };
  }

  fs.rmSync(snapDir, { recursive: true, force: true });
  // Styling that is still incomplete after the repair budget is reported
  // rather than silently shipped as success.
  const styleNote = remainingStyleProblem
    ? " Some styles are still missing — see the log."
    : "";
  note(
    `Build passed with ${filesChanged.length} file(s) changed.${styleNote}`,
  );
  return {
    ok: true,
    skipped: false,
    reason: `Implemented ${filesChanged.length} file(s)${
      repairRounds ? ` after ${repairRounds} repair round(s)` : ""
    }.${styleNote}`,
    repairRounds,
    filesChanged,
    tokens,
    restoredFromSnapshot: false,
    log,
  };
}
