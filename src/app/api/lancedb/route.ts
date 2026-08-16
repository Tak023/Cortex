import { NextResponse } from "next/server";
import { lanceStatus, reindexLance, searchLance } from "@/lib/lancedb/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    return NextResponse.json(await lanceStatus());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ready: false, rows: 0, error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    query?: string;
    limit?: number;
  };
  const action = String(body.action || "search");
  try {
    if (action === "reindex") {
      const status = await reindexLance();
      return NextResponse.json({ ok: true, ...status });
    }
    if (action === "search") {
      const hits = await searchLance(String(body.query || ""), Number(body.limit) || 8);
      return NextResponse.json({ ok: true, hits });
    }
    return NextResponse.json({ error: "action must be search or reindex" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
