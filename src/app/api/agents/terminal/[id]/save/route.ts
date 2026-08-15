import { NextResponse } from "next/server";
import { saveTerminalSessionToVault } from "@/lib/agents/terminalSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/agents/terminal/[id]/save
 * Saves the current terminal session output and summary into the second-brain vault daily note.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
  };

  const res = saveTerminalSessionToVault(id, body);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error || "Failed to save session to vault" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    path: res.path,
    message: `Saved terminal session to second brain (${res.path})`,
  });
}
