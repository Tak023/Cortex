/**
 * Second brain (Obsidian vault) integration.
 *
 * The vault is plain Markdown on disk — Obsidian is the human interface,
 * Cortex agents are the intelligent layer. The contract lives in the vault's
 * root CLAUDE.md: `raw/` is read-only source material, agents own `wiki/`,
 * `projects/`, and `daily/`, and `log.md` is an append-only activity timeline.
 *
 * Used for:
 * - Grounding Jarvis chat answers in local notes (searchVault)
 * - Seeding pipeline research with prior knowledge (searchVault)
 * - Writing project outcomes back as long-term memory (writeVaultProjectNote)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { getSettings } from "../store";
import type { Project } from "../types";

export interface VaultHit {
  /** Vault-relative path, e.g. "wiki/concepts/agents.md" */
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface VaultContext {
  hits: VaultHit[];
  /** Preformatted block for prompt injection */
  block: string;
}

export interface VaultStatus {
  enabled: boolean;
  dir: string;
  available: boolean;
  noteCount: number;
}

const DEFAULT_VAULT_DIR = "~/Documents/hermes-second-brain";
const MAX_DEPTH = 6;
const MAX_NOTES = 2000;

function expandHome(p: string): string {
  if (!p) return p;
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function getVaultDir(): string {
  const fromEnv = process.env.CORTEX_VAULT_DIR?.trim();
  const fromSettings = (getSettings().vaultDir || "").trim();
  return expandHome(fromEnv || fromSettings || DEFAULT_VAULT_DIR);
}

function vaultAvailableAt(dir: string): boolean {
  try {
    return (
      fs.existsSync(dir) &&
      (fs.existsSync(path.join(dir, "CLAUDE.md")) ||
        fs.existsSync(path.join(dir, ".obsidian")))
    );
  } catch {
    return false;
  }
}

export function isVaultEnabled(): boolean {
  return getSettings().vaultEnabled && vaultAvailableAt(getVaultDir());
}

export function vaultStatus(): VaultStatus {
  const dir = getVaultDir();
  const available = vaultAvailableAt(dir);
  return {
    enabled: getSettings().vaultEnabled,
    dir,
    available,
    noteCount: available ? listNotes(dir).length : 0,
  };
}

// ── Note scanning (mtime-cached reads) ──────────────────────────────────────

const contentCache = new Map<string, { mtimeMs: number; content: string }>();

/**
 * Directories never indexed as notes. `graphify-out/` is generated build
 * output — its GRAPH_REPORT.md outranked hand-written notes in search and ate
 * slots in the top-N block injected into prompts. The semantic graph layer
 * still reads `graphify-out/graph.json` directly, so excluding it here does
 * not affect Graphify.
 */
const EXCLUDED_DIRS = new Set(["graphify-out"]);

/** Shared by both note walkers (vault.ts and graph.ts) so they cannot drift. */
export function isIndexedVaultEntry(name: string): boolean {
  // dotfiles cover .obsidian, .git, and friends
  return !name.startsWith(".") && !EXCLUDED_DIRS.has(name);
}

export function listVaultNoteDocuments(): Array<{
  id: string;
  path: string;
  title: string;
  text: string;
}> {
  if (!isVaultEnabled()) return [];
  const dir = getVaultDir();
  const out: Array<{ id: string; path: string; title: string; text: string }> =
    [];
  for (const abs of listNotes(dir)) {
    const rel = path.relative(dir, abs);
    const text = readNote(abs);
    if (!text.trim()) continue;
    out.push({
      id: `vault:${rel}`,
      path: rel,
      title: path.basename(rel, ".md"),
      text,
    });
  }
  return out;
}

function listNotes(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length >= MAX_NOTES) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!isIndexedVaultEntry(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      listNotes(abs, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(abs);
      if (out.length >= MAX_NOTES) return out;
    }
  }
  return out;
}

function readNote(abs: string): string {
  try {
    const mtimeMs = fs.statSync(abs).mtimeMs;
    const cached = contentCache.get(abs);
    if (cached && cached.mtimeMs === mtimeMs) return cached.content;
    const content = fs.readFileSync(abs, "utf-8");
    contentCache.set(abs, { mtimeMs, content });
    return content;
  } catch {
    return "";
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "are", "with", "this", "that", "what", "when", "where",
  "who", "how", "why", "can", "could", "should", "would", "does", "did", "has",
  "have", "was", "were", "will", "you", "your", "about", "tell", "show", "give",
  "make", "want", "need", "know", "please", "some", "any", "all", "from", "into",
  "his", "her", "its", "our", "their", "get", "use", "using", "one", "two",
]);

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ).slice(0, 12);
}

/** Folder weighting: processed knowledge ranks above raw dumps. */
function pathBoost(rel: string): number {
  if (rel === "SOUL.md" || rel.startsWith("system/memory/")) return 2;
  if (rel.startsWith("wiki/") || rel.startsWith("projects/")) return 1.5;
  if (rel.startsWith("raw/")) return 0.5;
  if (rel.startsWith("templates/")) return 0.1;
  return 1;
}

function extractSnippet(content: string, tokens: string[]): string {
  const lines = content.split("\n");
  let bestIdx = -1;
  let bestHits = 0;
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    const hits = tokens.reduce((n, t) => n + (low.includes(t) ? 1 : 0), 0);
    if (hits > bestHits && lines[i].trim().length > 10) {
      bestHits = hits;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    return lines.find((l) => l.trim().length > 10)?.trim().slice(0, 240) ?? "";
  }
  return lines
    .slice(bestIdx, bestIdx + 3)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

/**
 * Keyword search across the vault. Returns null when the vault is disabled,
 * missing, or nothing scores above the noise floor.
 */
export function searchVault(
  query: string,
  opts?: { limit?: number },
): VaultContext | null {
  if (!isVaultEnabled()) return null;
  const tokens = tokenize(query);
  if (!tokens.length) return null;

  const dir = getVaultDir();
  const limit = opts?.limit ?? 5;
  const scored: VaultHit[] = [];

  for (const abs of listNotes(dir)) {
    const rel = path.relative(dir, abs);
    const content = readNote(abs);
    if (!content) continue;

    const name = path.basename(rel, ".md").toLowerCase();
    const low = content.toLowerCase();
    let score = 0;
    let strongHits = 0;
    for (const t of tokens) {
      if (name.includes(t)) {
        score += 8;
        strongHits++;
      }
      // Headings are a strong signal of the note's subject
      const headingHits = (
        low.match(new RegExp(`^#{1,4} .*${t}`, "gm")) ?? []
      ).length;
      if (headingHits) {
        score += headingHits * 3;
        strongHits++;
      }
      const bodyHits = low.split(t).length - 1;
      score += Math.min(bodyHits, 6);
    }
    // Require at least one title/heading match or several body matches
    if (strongHits === 0 && score < 4) continue;
    score *= pathBoost(rel);
    if (score <= 0) continue;

    scored.push({
      path: rel,
      title: path.basename(rel, ".md"),
      snippet: extractSnippet(content, tokens),
      score: Math.round(score * 10) / 10,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, limit);
  if (!hits.length) return null;

  const block = hits
    .map((h) => `• [[${h.title}]] (${h.path})\n  ${h.snippet}`)
    .join("\n");
  return { hits, block };
}

// ── Writes (contract: never touch raw/, log.md is append-only) ──────────────

function assertWritable(rel: string) {
  const normalized = path.normalize(rel);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`vault write outside vault refused: ${rel}`);
  }
  if (normalized.startsWith("raw" + path.sep) || normalized === "raw") {
    throw new Error(`vault raw/ is read-only: ${rel}`);
  }
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Append a line to the vault's log.md under today's date heading
 * (newest entries at the top, per the vault's log format).
 */
export function appendVaultLog(agent: string, action: string, notes: string) {
  if (!isVaultEnabled()) return;
  const dir = getVaultDir();
  const logPath = path.join(dir, "log.md");
  const { date, time } = nowStamp();
  const line = `- ${time} | ${agent} | ${action} | ${notes}`;

  let content = "";
  try {
    content = fs.readFileSync(logPath, "utf-8");
  } catch {
    content = `# Log — Agent Activity Timeline\n\nNewest entries at the top.\nFormat: \`YYYY-MM-DD HH:MM | Agent | Action | Notes\`\n\n---\n`;
  }

  const heading = `## ${date}`;
  if (content.includes(heading)) {
    content = content.replace(heading, `${heading}\n${line}`);
  } else {
    const sep = content.indexOf("\n---\n");
    const insertion = `\n${heading}\n${line}\n`;
    content =
      sep >= 0
        ? content.slice(0, sep + 5) + insertion + content.slice(sep + 5)
        : content + insertion;
  }
  fs.writeFileSync(logPath, content, "utf-8");
  contentCache.delete(logPath);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "untitled"
  );
}

/**
 * Write (or update) a project note in the vault's projects/ folder using the
 * contract's structure (Goal / Current status / Next actions / Decisions log /
 * Related notes), and record the write in log.md.
 * Returns the vault-relative note path, or null when the vault is unavailable.
 */
export function writeVaultProjectNote(project: Project): string | null {
  if (!isVaultEnabled()) return null;
  const dir = getVaultDir();
  const rel = path.join("projects", `${slugify(project.name)}.md`);
  assertWritable(rel);

  const { date } = nowStamp();
  const failed = project.status === "failed";
  const errors = project.unresolvedErrors ?? [];
  const phases = project.tasks
    .map((t) => `| ${t.phase} | ${t.status} | ${agentLabel(project, t.agentId)} |`)
    .join("\n");

  const body = `# ${project.name}

> Cortex build project — written by the Cortex pipeline. Last updated ${date}.

## Goal

${project.concept.summary}

## Current status

- **${failed ? "Failed" : "Completed"}** (${date})${
    project.buildStatus ? ` — build/test: ${project.buildStatus}` : ""
  }
${project.workspacePath ? `- Workspace: \`${project.workspacePath}\`` : ""}
${project.launchUrl ? `- Launch URL: ${project.launchUrl}` : ""}

### Stack

${(project.concept.stack || []).map((s) => `- ${s}`).join("\n") || "- (none recorded)"}

### Features

${(project.concept.features || []).map((f) => `- ${f}`).join("\n") || "- (none recorded)"}

## Next actions

${
  failed
    ? errors.length
      ? errors.map((e) => `- [ ] Resolve: ${e}`).join("\n")
      : "- [ ] Review build-test-report.md in the Cortex workspace"
    : "- [ ] Review the built app and decide whether to iterate or ship"
}

## Decisions log

- ${date} — Pipeline ${failed ? "stopped with unresolved errors" : "completed all phases"}.

## Pipeline phases

| Phase | Status | Agent |
|-------|--------|-------|
${phases}

## Related notes

- [[log]]
`;

  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
  contentCache.delete(abs);

  appendVaultLog(
    "Cortex",
    failed ? "Project failed" : "Project completed",
    `${project.name} → [[${slugify(project.name)}]]`,
  );
  return rel;
}

export function stripAnsi(text: string): string {
  // \x1B is intentional — this strips ANSI escape sequences from captured
  // terminal output. (`no-control-regex` is not enabled in this config.)
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Append an agent entry or session summary to the daily note (daily/YYYY-MM-DD.md)
 * and record it in log.md.
 */
export function appendVaultDailyNote(entry: {
  agent: string;
  title: string;
  summary: string;
  details?: string;
  cwd?: string;
}): string | null {
  if (!isVaultEnabled()) return null;
  const dir = getVaultDir();
  const { date, time } = nowStamp();
  const rel = path.join("daily", `${date}.md`);
  assertWritable(rel);

  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  let content = "";
  if (fs.existsSync(abs)) {
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      content = "";
    }
  }

  if (!content.trim()) {
    content = `# Daily Note — ${date}\n\n## Agent Activity & Notes\n\n`;
  }

  const cleanSummary = entry.summary.trim();
  const cleanDetails = entry.details ? stripAnsi(entry.details).trim() : "";
  const cwdInfo = entry.cwd ? `\n> Working directory: \`${entry.cwd}\`\n` : "";

  const section =
    `### ${time} · ${entry.agent} — ${entry.title}\n` +
    cwdInfo +
    `\n${cleanSummary}\n` +
    (cleanDetails
      ? `\n<details><summary>Session Output / Details</summary>\n\n\`\`\`text\n${cleanDetails.slice(0, 4000)}\n\`\`\`\n</details>\n`
      : "") +
    `\n---\n\n`;

  content += `\n${section}`;
  fs.writeFileSync(abs, content, "utf-8");
  contentCache.delete(abs);

  appendVaultLog(
    entry.agent,
    entry.title,
    `${cleanSummary.slice(0, 120)} → [[${date}]]`,
  );

  return rel;
}

function agentLabel(project: Project, agentId: string | null): string {
  if (!agentId) return "—";
  return agentId;
}

