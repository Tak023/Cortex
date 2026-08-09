import { NextResponse } from "next/server";
import {
  getTerminalSession,
  killTerminal,
} from "@/lib/agents/terminalSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = getTerminalSession(id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    session: {
      id: session.id,
      agent: session.agent,
      label: session.label,
      display: session.display,
      cwd: session.cwd,
      createdAt: session.createdAt,
      exited: session.exited,
      exitCode: session.exitCode,
    },
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = killTerminal(id);
  return NextResponse.json({ ok });
}
