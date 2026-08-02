import OpenAI from "openai";
import type { Concept } from "../types";
import { nanoid } from "nanoid";

function getClient(): OpenAI | null {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.x.ai/v1",
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

/**
 * Generate 4–8 concrete product concepts from a rough idea.
 * Uses Grok via SpaceXAI when XAI_API_KEY is set; otherwise local synthesis.
 */
export async function generateConcepts(
  statement: string,
  templateHint?: string,
  agentsUsed: string[] = ["Grok", "Hermes", "Claude Code"],
): Promise<Concept[]> {
  const client = getClient();
  if (client) {
    try {
      return await generateWithGrok(client, statement, templateHint, agentsUsed);
    } catch (err) {
      console.warn("Grok generation failed, falling back to local", err);
    }
  }
  return generateLocalConcepts(statement, templateHint, agentsUsed);
}

async function generateWithGrok(
  client: OpenAI,
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

Return ONLY valid JSON (no markdown) as an array of 6 concept objects with this shape:
{
  "title": string,
  "summary": string (2-3 sentences),
  "features": string[] (4-6 concrete features),
  "stack": string[] (3-6 technologies),
  "difficulty": "easy" | "medium" | "hard",
  "estimatedEffort": string (e.g. "1 week", "3-4 weeks"),
  "score": number 0-100
}

Make concepts meaningfully different angles (MVP vs ambitious, niche vs broad, local-first vs SaaS, etc.).
Be specific and actionable — these will feed a full build pipeline.`;

  const resp = await client.chat.completions.create({
    model: "grok-4.5",
    messages: [
      {
        role: "system",
        content:
          "You return only compact JSON arrays. No prose, no code fences.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.85,
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? "[]";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Array<{
    title: string;
    summary: string;
    features: string[];
    stack: string[];
    difficulty: "easy" | "medium" | "hard";
    estimatedEffort: string;
    score: number;
  }>;

  return parsed.slice(0, 8).map((c) => ({
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

function generateLocalConcepts(
  statement: string,
  templateHint: string | undefined,
  agentsUsed: string[],
): Concept[] {
  const seed = statement.trim() || "Untitled product";
  const short =
    seed.length > 48 ? seed.slice(0, 45).trim() + "…" : seed;
  const kind = (templateHint || detectKind(seed)).toLowerCase();

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
      title: `${short} · Focused MVP`,
      lens: "Ship the smallest lovable version that validates the core loop.",
      features: [
        "Single primary workflow end-to-end",
        "Local data persistence",
        "Minimal auth / guest mode",
        "Export / share of results",
        "Basic observability",
      ],
      stack: stackFor(kind, "mvp"),
      difficulty: "easy",
      effort: "1–2 weeks",
      score: 88,
    },
    {
      title: `${short} · Multi-agent control plane`,
      lens: "Treat the problem as an orchestration surface where specialized agents collaborate with human gates.",
      features: [
        "Agent registry with live status",
        "Idea → concept → pipeline routing",
        "Shared project memory & handoffs",
        "Approval gates on plans",
        "Activity feed & usage metrics",
        "Local + cloud hybrid execution",
      ],
      stack: ["Next.js", "TypeScript", "SQLite", "xAI Grok", "Tailwind"],
      difficulty: "hard",
      effort: "4–6 weeks",
      score: 94,
    },
    {
      title: `${short} · CLI-first power tool`,
      lens: "Optimize for developers who live in the terminal; thin TUI + optional web UI later.",
      features: [
        "Composable subcommands",
        "Config via file + env",
        "Streaming progress output",
        "Plugin hooks for agents",
        "JSON / human dual output",
      ],
      stack: stackFor("cli", "cli"),
      difficulty: "medium",
      effort: "2–3 weeks",
      score: 82,
    },
    {
      title: `${short} · Real-time ops dashboard`,
      lens: "Make state visible: live boards, metrics, and intervention controls for operators.",
      features: [
        "Live Kanban of workstreams",
        "Dependency graph of tasks",
        "Searchable agent list",
        "Cost / token tracking",
        "Pause / reassign / approve controls",
      ],
      stack: stackFor("dashboard", "web"),
      difficulty: "medium",
      effort: "2–4 weeks",
      score: 86,
    },
    {
      title: `${short} · API + SDK platform`,
      lens: "Expose the capability as a clean API that other tools and agents can call.",
      features: [
        "Versioned REST / RPC API",
        "OpenAPI schema",
        "API keys & rate limits",
        "Webhook events",
        "Typed client SDK",
      ],
      stack: stackFor("api", "api"),
      difficulty: "medium",
      effort: "3–4 weeks",
      score: 79,
    },
    {
      title: `${short} · Local-only privacy edition`,
      lens: "Everything on-device via LM Studio / local agents; no cloud dependency for the happy path.",
      features: [
        "Offline-first store",
        "LM Studio model picker",
        "Encrypted local workspace",
        "Optional cloud agents as plugins",
        "Full history export",
      ],
      stack: ["Next.js", "SQLite", "LM Studio", "Hermes", "TypeScript"],
      difficulty: "hard",
      effort: "3–5 weeks",
      score: 90,
    },
  ];

  return angles.map((a) => ({
    id: `concept-${nanoid(8)}`,
    title: a.title,
    summary: `${a.lens} Built around: ${seed}`,
    features: a.features,
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

  const templates: Record<
    string,
    { summary: string; artifactName: string; content: string }
  > = {
    research: {
      summary: `Research complete for "${projectName}": users, constraints, and competitive landscape mapped.`,
      artifactName: "research-brief.md",
      content: `# Research Brief — ${projectName}

## Problem
${conceptSummary}

## Users
- Primary: builders who orchestrate multiple AI agents
- Secondary: solo developers wanting a command center

## Constraints
- Local-first preferred
- Hybrid cloud + local models
- Human-in-the-loop gates required

## Findings
- Fragmented tooling across Claude Code, Codex, Hermes, Grok, LM Studio
- Strong demand for shared project memory and visible handoffs
- Approval gates reduce runaway agent costs

## Prior context
${prior || "_none_"}
`,
    },
    planning: {
      summary: `Execution plan drafted with milestones, risks, and success metrics for "${projectName}".`,
      artifactName: "execution-plan.md",
      content: `# Execution Plan — ${projectName}

## Goal
${conceptSummary}

## Milestones
1. Scaffold workspace & agent registry
2. Ideas → concepts flow
3. Pipeline orchestration with approval gates
4. Project Kanban + live activity
5. Export & usage tracking

## Risks
- Agent CLI availability varies
- API rate limits on cloud agents
- Context drift across phases

## Success metrics
- Concept generation < 30s
- Full pipeline visible on Kanban
- Human can pause/reassign mid-flight

## Depends on research
${memory.research?.slice(0, 300) || "_pending_"}
`,
    },
    architecture: {
      summary: `System architecture defined: modules, data model, and agent routing for "${projectName}".`,
      artifactName: "architecture.md",
      content: `# Architecture — ${projectName}

## Overview
Local-first control plane with Next.js UI, file-backed state, and an in-process orchestration engine.

## Modules
- **Agent Registry** — status, strengths, config
- **Router** — phase → best agent
- **Orchestrator** — task graph, handoffs, approvals
- **Workspace** — shared memory, artifacts, history
- **Activity Bus** — real-time feed

## Data model
Agent, Idea, Concept, Project, Task, Artifact, ActivityEvent, UsageRecord

## Handoff protocol
Each phase writes artifacts into shared memory; next phase reads prior keys.

## Prior
${memory.planning?.slice(0, 300) || memory.research?.slice(0, 300) || "_none_"}
`,
    },
    implementation: {
      summary: `Core implementation for "${projectName}" scaffolded with primary flows wired.`,
      artifactName: "implementation-notes.md",
      content: `# Implementation Notes — ${projectName}

## Delivered
- UI shell with sidebar navigation
- Agents panel with status & actions
- Ideas → Generate Concepts → select
- Project workspace with Kanban
- Orchestration tick loop with approvals

## Key files
- \`src/lib/orchestration/engine.ts\`
- \`src/lib/agents/router.ts\`
- \`src/lib/store.ts\`
- \`src/app/ideas/page.tsx\`
- \`src/app/projects/[id]/page.tsx\`

## Follow-ups
- Wire real CLI adapters for Hermes / Claude Code / Codex
- Stream SSE for activity feed
`,
    },
    testing: {
      summary: `Test plan executed for "${projectName}"; critical paths green with notes.`,
      artifactName: "test-report.md",
      content: `# Test Report — ${projectName}

## Coverage
- Concept generation (mock + live path)
- Project creation from concept
- Task transitions & approval gates
- Agent status updates during run
- Pause / resume / reassign

## Results
| Area | Status |
|------|--------|
| Ideas flow | PASS |
| Routing | PASS |
| Kanban | PASS |
| Approvals | PASS |
| Export | PASS |

## Notes
Simulation mode validates coordination without requiring all API keys.
`,
    },
    polish: {
      summary: `Polish pass complete for "${projectName}": UX, copy, empty states, and export ready.`,
      artifactName: "release-notes.md",
      content: `# Release Notes — ${projectName}

## Highlights
- Dark command-center UI
- Multi-agent concept brainstorm
- Live pipeline with human gates
- Project workspace + history export

## Concept
${conceptSummary}

## Ready for
Local demo, further agent adapter integration, and real API keys via Settings.
`,
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
