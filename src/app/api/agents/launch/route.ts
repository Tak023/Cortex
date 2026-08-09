import { NextResponse } from "next/server";
import { EXTERNAL_AGENTS, type ExternalAgentId } from "@/lib/agents/externalAgents";
import { launchExternalAgent } from "@/lib/agents/launchExternal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID = new Set(EXTERNAL_AGENTS.map((a) => a.id));

/**
 * POST { agent: "hermes" | "claude-code" | "codex" | "grok", mode?: "external" }
 *
 * Preferred UX: the sidebar opens an in-app terminal via /agents/terminal
 * (Electron child window). This endpoint remains for explicit external launch
 * (macOS Terminal.app) when mode === "external".
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agent?: string;
    mode?: string;
  };
  const agent = (body.agent || "").trim() as ExternalAgentId;
  if (!VALID.has(agent)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown agent. Use one of: ${[...VALID].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Default: tell clients to use the embedded terminal (no Terminal.app).
  if (body.mode !== "external") {
    return NextResponse.json({
      ok: true,
      agent,
      method: "embed",
      detail: "Open /agents/terminal in an in-app window",
      path: `/agents/terminal?agent=${encodeURIComponent(agent)}`,
    });
  }

  try {
    const result = launchExternalAgent(agent);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, agent, detail: message, error: message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ agents: EXTERNAL_AGENTS });
}
