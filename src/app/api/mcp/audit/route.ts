import { NextResponse } from "next/server";
import { clearAudit, listAudit } from "@/lib/mcp/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 80);
  return NextResponse.json({ entries: listAudit(limit) });
}

export async function DELETE() {
  clearAudit();
  return NextResponse.json({ ok: true });
}
