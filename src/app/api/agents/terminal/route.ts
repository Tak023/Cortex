import { NextResponse } from "next/server";
import { EXTERNAL_AGENTS, type ExternalAgentId } from "@/lib/agents/externalAgents";
import { createTerminalSession } from "@/lib/agents/terminalSessions";
import { resolveAgentCommand } from "@/lib/agents/resolveAgentCommand";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID = new Set(EXTERNAL_AGENTS.map((a) => a.id));

/**
 * POST { agent, cols?, rows?, cwd? }
 * Creates an in-app PTY session for the agent CLI (does not open Terminal.app).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agent?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
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

  const result = createTerminalSession({
    agent,
    cols: body.cols,
    rows: body.rows,
    cwd: body.cwd,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, agent, detail: result.detail, error: result.detail },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    session: result.session,
  });
}

/**
 * GET ?agent=claude-code[&cwd=…] — resolve the CLI *and* the governance that
 * will be applied (auth mode, approval flags, workspace scope) without
 * starting a session. The desktop shell calls this before `pty:start` so the
 * main-process PTY spawns under the same policy as the web path.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agent = (url.searchParams.get("agent") || "").trim() as ExternalAgentId;
  if (!agent) {
    return NextResponse.json({ agents: EXTERNAL_AGENTS });
  }
  if (!VALID.has(agent)) {
    return NextResponse.json({ ok: false, error: "Unknown agent" }, { status: 400 });
  }
  const cwd = url.searchParams.get("cwd")?.trim() || undefined;
  const resolved = resolveAgentCommand(agent, { cwd });
  return NextResponse.json(resolved, { status: resolved.ok ? 200 : 404 });
}
