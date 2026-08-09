import { NextResponse } from "next/server";
import { resizeTerminal } from "@/lib/agents/terminalSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    cols?: number;
    rows?: number;
  };
  const cols = Number(body.cols);
  const rows = Number(body.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return NextResponse.json(
      { ok: false, error: "Expected { cols, rows }" },
      { status: 400 },
    );
  }
  const ok = resizeTerminal(id, cols, rows);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Session not found or exited" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
