import { NextResponse } from "next/server";
import { writeTerminal } from "@/lib/agents/terminalSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { data?: string };
  if (typeof body.data !== "string") {
    return NextResponse.json(
      { ok: false, error: "Expected { data: string }" },
      { status: 400 },
    );
  }
  const ok = writeTerminal(id, body.data);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Session not found or exited" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
