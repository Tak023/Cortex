import { NextResponse } from "next/server";
import { generateConcepts, isAiConfigured } from "@/lib/ai/client";
import { routeBrainstormTeam } from "@/lib/agents/router";
import {
  getAgents,
  getIdea,
  pushActivity,
  pushUsage,
  updateAgent,
  upsertIdea,
} from "@/lib/store";
import { TEMPLATES } from "@/lib/templates";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  let idea = body.ideaId ? getIdea(body.ideaId) : null;
  const statement = String(body.statement || idea?.statement || "").trim();
  const templateId = body.templateId ?? idea?.templateId ?? null;

  if (!statement) {
    return NextResponse.json(
      { error: "statement is required" },
      { status: 400 },
    );
  }

  if (!idea) {
    idea = {
      id: `idea-${nanoid(8)}`,
      statement,
      templateId,
      concepts: [],
      selectedConceptId: null,
      projectId: null,
      createdAt: new Date().toISOString(),
      status: "generating",
    };
  } else {
    idea = {
      ...idea,
      statement,
      templateId,
      status: "generating",
    };
  }
  upsertIdea(idea);

  const agents = getAgents().filter((a) => a.config.enabled);
  const team = routeBrainstormTeam(agents, 3);
  const teamNames = team.map((a) => a.name);

  for (const a of team) {
    updateAgent(a.id, {
      status: "busy",
      currentTaskId: `brainstorm-${idea.id}`,
      currentTaskLabel: `Brainstorm: ${statement.slice(0, 40)}…`,
    });
  }

  pushActivity({
    type: "info",
    message: `Brainstorm team assembled: ${teamNames.join(", ")}`,
  });

  const template = TEMPLATES.find((t) => t.id === templateId);
  const started = Date.now();

  try {
    const generation = await generateConcepts(
      statement,
      template?.name,
      teamNames,
    );
    const { concepts, source, model, fallbackReason } = generation;

    const latency = Date.now() - started;
    idea = {
      ...idea,
      concepts,
      status: "ready",
    };
    upsertIdea(idea);

    for (const a of team) {
      updateAgent(a.id, {
        status: "idle",
        currentTaskId: null,
        currentTaskLabel: null,
        metrics: {
          ...a.metrics,
          tokensUsed: a.metrics.tokensUsed + Math.floor(1200 / team.length),
          tasksCompleted: a.metrics.tasksCompleted + 1,
        },
      });
      pushUsage({
        id: `use-${nanoid(8)}`,
        agentId: a.id,
        tokens: Math.floor(800 + Math.random() * 1500),
        costUsd: source === "grok" ? 0.01 : 0,
        latencyMs: Math.floor(latency / team.length),
        createdAt: new Date().toISOString(),
      });
    }

    // Never let a Grok failure masquerade as AI output — tell the user why
    // they're seeing locally synthesized concepts.
    if (source === "local" && isAiConfigured()) {
      pushActivity({
        type: "error",
        message: `Grok concept generation failed — used local synthesis instead. Reason: ${(fallbackReason || "unknown").slice(0, 180)}`,
      });
    }

    pushActivity({
      type: "concept_generated",
      message: `Generated ${concepts.length} concepts (${source === "grok" ? `Grok · ${model}` : "local synthesis"}) for "${statement.slice(0, 60)}${statement.length > 60 ? "…" : ""}"`,
    });

    return NextResponse.json({
      idea,
      concepts,
      team: teamNames,
      mode:
        source === "grok"
          ? `grok (${model})`
          : `local-synthesis${isAiConfigured() ? " — Grok call failed" : " — no API key"}`,
      fallbackReason: fallbackReason ?? null,
    });
  } catch (err) {
    for (const a of team) {
      updateAgent(a.id, {
        status: "idle",
        currentTaskId: null,
        currentTaskLabel: null,
      });
    }
    idea = { ...idea, status: "draft" };
    upsertIdea(idea);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Generation failed",
      },
      { status: 500 },
    );
  }
}
