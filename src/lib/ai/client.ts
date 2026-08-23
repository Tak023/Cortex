import OpenAI from "openai";
import type { Concept } from "../types";
import { nanoid } from "nanoid";

/**
 * Hard ceiling on any single xAI request.
 *
 * The SDK defaults to a 10-minute timeout with 2 retries, so one stalled call
 * could occupy a request for ~30 minutes with no way for the UI to recover —
 * which is what made "Generate concepts" look permanently frozen. Concept
 * generation legitimately takes ~45s, so the bound has to clear that with room
 * to spare while still failing in a human timeframe.
 */
const XAI_TIMEOUT_MS = 90_000;

function getClient(): OpenAI | null {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.x.ai/v1",
    timeout: XAI_TIMEOUT_MS,
    maxRetries: 1,
  });
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

/** Default Grok model for interactive Jarvis chat (override with JARVIS_GROK_MODEL). */
export function getGrokChatModel(): string {
  return (
    process.env.JARVIS_GROK_MODEL?.trim() ||
    process.env.XAI_CHAT_MODEL?.trim() ||
    "grok-4.5"
  );
}

export type GrokChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GrokChatResult = {
  content: string;
  model: string;
  tokens?: number;
  latencyMs: number;
  raw: unknown;
};

/**
 * Multi-turn chat via xAI Grok (OpenAI-compatible API).
 * Used by Jarvis hybrid mode for live / current-events questions.
 */
export async function chatWithGrok(opts: {
  messages: GrokChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<GrokChatResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "XAI_API_KEY is not set. Add it to .env.local for Grok hybrid chat.",
    );
  }
  const model = opts.model?.trim() || getGrokChatModel();
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 1400,
  });
  const content = (resp.choices[0]?.message?.content ?? "").trim();
  if (!content) {
    throw new Error("Empty response from Grok");
  }
  return {
    content,
    model: resp.model || model,
    tokens: resp.usage?.total_tokens,
    latencyMs: Date.now() - t0,
    raw: resp,
  };
}

export type ConceptGeneration = {
  concepts: Concept[];
  /** Which engine actually produced the concepts */
  source: "grok" | "local";
  /** Model used when source === "grok" */
  model?: string;
  /** Why Grok was not used (missing key, API error, parse failure, …) */
  fallbackReason?: string;
};

/**
 * Generate 10 concrete product concepts from a rough idea.
 * Uses Grok when XAI_API_KEY is set and the API call succeeds; otherwise
 * falls back to local synthesis and REPORTS WHY via `fallbackReason` so the
 * UI never silently pretends canned concepts came from Grok.
 */
export async function generateConcepts(
  statement: string,
  templateHint?: string,
  agentsUsed: string[] = ["Grok", "Hermes", "Claude Code"],
): Promise<ConceptGeneration> {
  const client = getClient();
  if (!client) {
    return {
      concepts: generateLocalConcepts(statement, templateHint, agentsUsed),
      source: "local",
      fallbackReason: "XAI_API_KEY is not set",
    };
  }
  const model = getGrokChatModel();
  try {
    const concepts = await generateWithGrok(
      client,
      model,
      statement,
      templateHint,
      agentsUsed,
    );
    return { concepts, source: "grok", model };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("Grok concept generation failed, falling back to local:", reason);
    return {
      concepts: generateLocalConcepts(statement, templateHint, agentsUsed),
      source: "local",
      fallbackReason: reason,
    };
  }
}

async function generateWithGrok(
  client: OpenAI,
  model: string,
  statement: string,
  templateHint: string | undefined,
  agentsUsed: string[],
): Promise<Concept[]> {
  const prompt = `You are the brainstorm coordinator for Cortex, a multi-agent OS.
A user submitted this idea:
"""
${statement}
"""
${templateHint ? `Preferred product type: ${templateHint}` : ""}

Return ONLY valid JSON (no markdown) as an array of 10 concept objects with this shape:
{
  "title": string,
  "summary": string (2-3 sentences),
  "features": string[] (4-6 concrete features),
  "stack": string[] (3-6 technologies),
  "difficulty": "easy" | "medium" | "hard",
  "estimatedEffort": string (e.g. "1 week", "3-4 weeks"),
  "score": number 0-100
}

HARD REQUIREMENTS:
- Every concept must be a direct product take on the user's idea above — same
  problem domain and goal, explored from a different angle (scope, audience,
  platform, pricing, local-first vs SaaS). Never propose unrelated apps.
- Titles must name the user's subject matter, not a generic archetype.
- Features must be specific to the idea's domain (name its nouns), not
  boilerplate like "basic auth" or "export results".
- Pick the stack that genuinely fits each concept; vary stacks across
  concepts where justified rather than repeating one default stack.
Be specific and actionable — these will feed a full build pipeline.`;

  const resp = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "You return only compact JSON arrays. No prose, no code fences.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.85,
      // Ten fully-specified concepts run ~4k tokens. Cap generously: too low
      // truncates the JSON array and throws away an otherwise good response.
      max_tokens: 8000,
    },
    // No retry here — this call already takes ~45s, and a second attempt would
    // double the wait for no gain. Failure falls through to local synthesis,
    // which reports why via fallbackReason.
    { maxRetries: 0 },
  );

  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  // Tolerate prose / fenced output: extract the outermost JSON array
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error(
      `Grok returned no JSON array (starts with: ${text.slice(0, 80)})`,
    );
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{
    title: string;
    summary: string;
    features: string[];
    stack: string[];
    difficulty: "easy" | "medium" | "hard";
    estimatedEffort: string;
    score: number;
  }>;

  return parsed.slice(0, 10).map((c) => ({
    id: `concept-${nanoid(8)}`,
    title: c.title,
    summary: c.summary,
    features: c.features ?? [],
    stack: c.stack ?? [],
    difficulty: c.difficulty ?? "medium",
    estimatedEffort: c.estimatedEffort ?? "2-3 weeks",
    agentsUsed,
    score: c.score ?? 70,
  }));
}

/**
 * Domain profiles used by local synthesis so offline concepts still center on
 * the user's idea: matched profiles contribute idea-relevant features and
 * stack picks instead of one-size-fits-all boilerplate.
 */
type DomainProfile = {
  name: string;
  test: RegExp;
  features: string[];
  stack: string[];
};

const DOMAIN_PROFILES: DomainProfile[] = [
  {
    name: "containers",
    test: /\b(docker|containers?|kubernetes|k8s|pods?|images?)\b/i,
    features: [
      "Auto-discover running and stopped containers via the Docker socket",
      "Inventory of images, volumes, and networks with sizes",
      "One-click start / stop / restart / remove actions",
      "Live CPU / memory / network usage per container",
      "Detect orphaned images and volumes and suggest cleanup",
      "Export container inventory as JSON / CSV",
    ],
    stack: ["dockerode", "Node.js"],
  },
  {
    name: "system-scan",
    test: /\b(scan|disk|files?|folders?|duplicates?|storage|cleanup|computer|machine)\b/i,
    features: [
      "Fast recursive filesystem scan with ignore rules",
      "Size / type / age breakdown of what was found",
      "Duplicate and large-file detection",
      "Safe review-before-delete workflow",
      "Scheduled rescans with change diffs",
    ],
    stack: ["Node.js", "fast-glob"],
  },
  {
    name: "web-data",
    test: /\b(scrape|scraping|crawl|monitor|prices?|rss|news|feeds?|websites?)\b/i,
    features: [
      "Configurable source list with per-site selectors",
      "Change detection with diff highlighting",
      "Alert rules (email / webhook) on matches",
      "Historical snapshots and trend view",
      "Rate-limited polite fetching with retries",
    ],
    stack: ["Playwright", "Cheerio", "Node.js"],
  },
  {
    name: "finance",
    test: /\b(budget|expenses?|finance|invoices?|money|stocks?|crypto|portfolio|accounting)\b/i,
    features: [
      "Transaction import (CSV / OFX) with dedupe",
      "Category rules and auto-tagging",
      "Monthly budget vs actual views",
      "Recurring charge detection",
      "Net-worth / balance trend charts",
    ],
    stack: ["PostgreSQL", "Recharts"],
  },
  {
    name: "media",
    test: /\b(photos?|images?|videos?|music|audio|podcasts?|gallery)\b/i,
    features: [
      "Bulk import with metadata extraction",
      "Auto-organization by date / content / tags",
      "Fast thumbnail grid with lazy loading",
      "Duplicate and near-duplicate detection",
      "Batch edit / convert / export pipeline",
    ],
    stack: ["sharp", "SQLite"],
  },
  {
    name: "productivity",
    test: /\b(todos?|tasks?|notes?|habits?|journal|calendar|schedule|reminders?)\b/i,
    features: [
      "Quick capture with keyboard-first entry",
      "Views by project, due date, and priority",
      "Recurring items and smart reminders",
      "Full-text search across everything",
      "Daily / weekly review summaries",
    ],
    stack: ["SQLite", "Tiptap"],
  },
  {
    name: "chat-ai",
    test: /\b(chat(bot)?|assistant|\bai\b|llm|gpt|grok|agents?)\b/i,
    features: [
      "Streaming chat with conversation history",
      "Model picker (local + cloud) with fallback",
      "Tool / function calling for real actions",
      "Prompt templates and saved workflows",
      "Per-conversation cost and token tracking",
    ],
    stack: ["Vercel AI SDK", "LM Studio"],
  },
  {
    name: "commerce",
    test: /\b(shop|store|e-?commerce|marketplace|cart|orders?|inventory|products?)\b/i,
    features: [
      "Product catalog with variants and stock levels",
      "Cart and checkout flow with payment provider",
      "Order management and status tracking",
      "Low-stock alerts and reorder suggestions",
      "Sales dashboard with top-seller breakdown",
    ],
    stack: ["Stripe", "PostgreSQL"],
  },
  {
    name: "community",
    test: /\b(social|community|forum|share|feed|comments?|profiles?|members?)\b/i,
    features: [
      "User profiles with activity feeds",
      "Posts, replies, and reactions",
      "Moderation queue and report handling",
      "Notifications and mentions",
      "Search and trending topics",
    ],
    stack: ["PostgreSQL", "WebSockets"],
  },
  {
    name: "health",
    test: /\b(health|fitness|workouts?|meals?|nutrition|sleep|weight)\b/i,
    features: [
      "Daily logging with minimal-tap entry",
      "Progress charts and streak tracking",
      "Goal setting with adaptive targets",
      "Weekly summary and insight digest",
      "Data export for records",
    ],
    stack: ["SQLite", "Recharts"],
  },
];

/** Strip "build me a website that…"-style filler to get the idea's core subject. */
function extractSubject(statement: string): string {
  const s = statement.trim().replace(/\s+/g, " ");
  const stripped = s
    .replace(
      /^(please\s+)?(can you\s+)?(i\s+(want|need|would like)\s+(you\s+to\s+)?)?(build|create|make|develop|design|write|code|generate)\s+(me\s+)?(a|an|the)?\s*/i,
      "",
    )
    .replace(
      /^(website|web\s?app|app|application|tool|cli|service|platform|extension|dashboard|program)\s*(called\s+\S+\s*)?((that|which|to|for)\s+)?/i,
      "",
    )
    .trim();
  return stripped.length >= 8 ? stripped : s;
}

function matchDomains(statement: string): DomainProfile[] {
  // Rank matched profiles by how many distinct keywords hit, so the idea's
  // dominant domain contributes features first.
  return DOMAIN_PROFILES.map((d) => {
    const hits =
      statement.match(new RegExp(d.test.source, "gi"))?.length ?? 0;
    return { d, hits };
  })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.d);
}

function generateLocalConcepts(
  statement: string,
  templateHint: string | undefined,
  agentsUsed: string[],
): Concept[] {
  const seed = statement.trim() || "Untitled product";
  const subject = extractSubject(seed);
  const short =
    subject.length > 48 ? subject.slice(0, 45).trim() + "…" : subject;
  const kind = (templateHint || detectKind(seed)).toLowerCase();
  const domains = matchDomains(seed);
  const domainFeatures = domains.flatMap((d) => d.features);
  const domainStack = domains.flatMap((d) => d.stack);

  /** Pick n idea-specific features, rotating start point so angles differ. */
  const pickDomain = (offset: number, n: number): string[] => {
    if (domainFeatures.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(n, domainFeatures.length); i++) {
      out.push(domainFeatures[(offset + i) % domainFeatures.length]);
    }
    return out;
  };

  const mergeStack = (base: string[]): string[] => {
    const seen = new Set<string>();
    return [...base, ...domainStack]
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
      .slice(0, 6);
  };

  const angles: Array<{
    title: string;
    lens: string;
    features: string[];
    stack: string[];
    difficulty: "easy" | "medium" | "hard";
    effort: string;
    score: number;
  }> = [
    {
      title: `${short} — Focused MVP`,
      lens: `The smallest lovable version: ${subject}, end-to-end, nothing else.`,
      features: [
        ...pickDomain(0, 3),
        `Single streamlined workflow for ${short}`,
        "Local data persistence — works before any account exists",
      ],
      stack: mergeStack(stackFor(kind, "mvp")),
      difficulty: "easy",
      effort: "1–2 weeks",
      score: 88,
    },
    {
      title: `${short} — Full product`,
      lens: `The ambitious take: ${subject} with the complete supporting toolset.`,
      features: [
        ...pickDomain(1, 4),
        "Saved views, history, and undo",
        "Multi-device sync",
      ],
      stack: mergeStack(["Next.js", "TypeScript", "PostgreSQL", "Tailwind"]),
      difficulty: "hard",
      effort: "4–6 weeks",
      score: 92,
    },
    {
      title: `${short} — CLI power tool`,
      lens: `${subject} for people who live in the terminal; scriptable and composable.`,
      features: [
        ...pickDomain(2, 3),
        "Composable subcommands with JSON / human dual output",
        "Config via file + env for CI use",
      ],
      stack: mergeStack(stackFor("cli", "cli")),
      difficulty: "medium",
      effort: "2–3 weeks",
      score: 82,
    },
    {
      title: `${short} — Live dashboard`,
      lens: `Make the state behind "${short}" visible at a glance and act on it.`,
      features: [
        ...pickDomain(3, 3),
        "Auto-refreshing overview with drill-down detail",
        "Bulk actions from the board",
      ],
      stack: mergeStack(stackFor("dashboard", "web")),
      difficulty: "medium",
      effort: "2–4 weeks",
      score: 86,
    },
    {
      title: `${short} — API-first service`,
      lens: `Expose ${short} as a clean API other tools and scripts can call.`,
      features: [
        ...pickDomain(4, 3),
        "Versioned REST API with OpenAPI schema",
        "Webhook events on changes",
      ],
      stack: mergeStack(stackFor("api", "api")),
      difficulty: "medium",
      effort: "3–4 weeks",
      score: 79,
    },
    {
      title: `${short} — Local-first privacy edition`,
      lens: `${subject}, entirely on-device: no cloud required for the happy path.`,
      features: [
        ...pickDomain(5, 3),
        "Offline-first encrypted local store",
        "Full data export at any time",
      ],
      stack: mergeStack(["Tauri", "SQLite", "TypeScript"]),
      difficulty: "hard",
      effort: "3–5 weeks",
      score: 89,
    },
    {
      title: `${short} — Mobile companion`,
      lens: `${subject} from your pocket: capture, review, and act anywhere.`,
      features: [
        ...pickDomain(6, 3),
        "Quick-capture with offline queue",
        "Push notifications for things needing attention",
      ],
      stack: mergeStack(stackFor("mobile", "mobile")),
      difficulty: "medium",
      effort: "3–4 weeks",
      score: 78,
    },
    {
      title: `${short} — Automation worker`,
      lens: `No UI to babysit: ${subject} on schedules and triggers, reporting results.`,
      features: [
        ...pickDomain(7, 3),
        "Cron-style scheduled runs with retry + dead-letter log",
        "Notification digests (email / Slack)",
      ],
      stack: mergeStack(["Node.js", "TypeScript", "SQLite", "BullMQ"]),
      difficulty: "medium",
      effort: "2–3 weeks",
      score: 81,
    },
    {
      title: `${short} — Insights & analytics`,
      lens: `Lead with the data behind "${short}": trends, breakdowns, alerts.`,
      features: [
        ...pickDomain(8, 3),
        "Time-series charts of the key metrics",
        "Anomaly alerts and scheduled reports",
      ],
      stack: mergeStack(["Next.js", "Recharts", "DuckDB", "Tailwind"]),
      difficulty: "medium",
      effort: "3–4 weeks",
      score: 80,
    },
    {
      title: `${short} — Team edition`,
      lens: `${subject} shared with a small team: roles, review, and an audit trail.`,
      features: [
        ...pickDomain(9, 3),
        "Workspaces with member roles",
        "Change history and review / approval flow",
      ],
      stack: mergeStack(["Next.js", "PostgreSQL", "Auth.js", "Tailwind"]),
      difficulty: "hard",
      effort: "4–6 weeks",
      score: 77,
    },
  ];

  return angles.map((a) => ({
    id: `concept-${nanoid(8)}`,
    title: a.title,
    summary: `${a.lens} Built around your idea: ${seed}`,
    features: a.features.slice(0, 6),
    stack: a.stack,
    difficulty: a.difficulty,
    estimatedEffort: a.effort,
    agentsUsed,
    score: a.score,
  }));
}

function detectKind(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("cli") || t.includes("command")) return "cli";
  if (t.includes("dashboard") || t.includes("ops")) return "dashboard";
  if (t.includes("api") || t.includes("service")) return "api";
  if (t.includes("mobile")) return "mobile";
  if (t.includes("agent")) return "agent";
  return "web";
}

function stackFor(kind: string, mode: string): string[] {
  if (kind.includes("cli") || mode === "cli")
    return ["TypeScript", "Node.js", "Commander", "Zod"];
  if (kind.includes("api") || mode === "api")
    return ["Hono", "PostgreSQL", "Zod", "OpenAPI"];
  if (kind.includes("dashboard"))
    return ["Next.js", "Recharts", "TanStack Query", "Tailwind"];
  if (kind.includes("mobile"))
    return ["React Native", "Expo", "TypeScript"];
  return ["Next.js", "TypeScript", "Tailwind", "SQLite"];
}

/** Produce phase artifact content for the simulated pipeline */
export function synthesizePhaseOutput(
  phase: string,
  projectName: string,
  conceptSummary: string,
  memory: Record<string, string>,
): { summary: string; artifactName: string; content: string } {
  const prior = Object.entries(memory)
    .map(([k, v]) => `### ${k}\n${v.slice(0, 400)}`)
    .join("\n\n");

  /**
   * Fallback documents, used only when no live agent produced the phase.
   *
   * These were previously demo copy describing Cortex itself — an
   * "architecture" for a portfolio site would announce an Agent Registry and
   * an Orchestrator, because the template named Cortex's own modules whatever
   * the project was. That is worse than a placeholder: it is confident,
   * well-formatted content about different software.
   *
   * They now derive strictly from the concept, assert nothing that was not
   * supplied, and open with a banner saying no agent wrote them.
   */
  const banner =
    "> **Template fallback — not agent output.** No live agent was available " +
    "for this phase, so Cortex generated this outline from the concept. " +
    "Connect an agent with a live adapter (Settings › Agents) to replace it.";

  const conceptBlock = `## Concept\n${conceptSummary || "_none supplied_"}`;
  const priorBlock = `## Prior phases\n${prior || "_none_"}`;

  const templates: Record<
    string,
    { summary: string; artifactName: string; content: string }
  > = {
    research: {
      summary: `Research outline generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "research.md",
      content: `# Research — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## Questions this phase should answer\n- Who is this for, and what do they do today instead?\n- What constraints are fixed (platform, budget, data, timeline)?\n- What does success look like, measurably?\n- What comparable products exist, and where do they fall short?\n\n${priorBlock}\n`,
    },
    planning: {
      summary: `Execution outline generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "planning.md",
      content: `# Execution Plan — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## Suggested milestones\n1. Define the smallest end-to-end slice that delivers the core value\n2. Build that slice\n3. Validate it against the success criteria from research\n4. Extend feature by feature, in priority order\n\n## Risks to resolve before building\n- Unstated assumptions in the concept\n- Dependencies not yet chosen or verified\n- Anything requiring credentials or third-party access\n\n${priorBlock}\n`,
    },
    architecture: {
      summary: `Architecture outline generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "architecture.md",
      content: `# Architecture — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## What this document should contain\n- Component breakdown for *this* project, with responsibilities\n- Data model and where state lives\n- External interfaces and their contracts\n- Build, run and deploy shape\n- Decisions taken, with the alternatives rejected and why\n\nCortex cannot infer these from a concept summary alone; a live agent should write them.\n\n${priorBlock}\n`,
    },
    implementation: {
      summary: `Implementation notes generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "implementation.md",
      content: `# Implementation — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## Note on scope\nCortex scaffolds a starter application from the concept — project name, summary, feature list and stack. It does **not** generate feature code, assets, branding or icons. Everything described in the concept beyond that scaffold still needs to be built.\n\n${priorBlock}\n`,
    },
    testing: {
      summary: `Test outline generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "testing.md",
      content: `# Testing — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## Coverage this project needs\n- One test per feature listed in the concept\n- The critical end-to-end path a user actually follows\n- Failure and empty states\n\nThe generated scaffold ships smoke tests for itself only; they do not cover the concept's features.\n\n${priorBlock}\n`,
    },
    polish: {
      summary: `Release outline generated for "${projectName}" (template fallback — no agent ran).`,
      artifactName: "release-notes.md",
      content: `# Release Notes — ${projectName}\n\n${banner}\n\n${conceptBlock}\n\n## Before calling this shippable\n- Every feature in the concept is implemented, not just scaffolded\n- Empty, loading and error states exist\n- Copy has been read end to end\n- Assets referenced by the concept (branding, icons, images) actually exist\n\n${priorBlock}\n`,
    },
  };

  return (
    templates[phase] ?? {
      summary: `Completed phase ${phase} for ${projectName}`,
      artifactName: `${phase}.md`,
      content: `# ${phase}\n\n${conceptSummary}\n`,
    }
  );
}
