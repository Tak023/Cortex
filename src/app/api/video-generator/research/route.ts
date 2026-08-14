import { NextResponse } from "next/server";
import {
  loadVideoResearchReport,
  runVideoResearch,
} from "@/lib/video/research";
import { pushActivity } from "@/lib/store";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureSecretsLoaded();
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const cached = loadVideoResearchReport();
  if (!force) {
    if (cached) return NextResponse.json({ ...cached, cached: true });
    return NextResponse.json({
      researchedAt: null,
      query: "",
      researcher: "Cortex researcher · YouTube + live web search",
      source: "idle",
      types: [],
      notes: [],
      cached: false,
    });
  }
  try {
    const report = await runVideoResearch();
    pushActivity({
      type: "info",
      message: `Video research: ${report.types.length} viral AI-generatable types ranked from YouTube.`,
    });
    return NextResponse.json({ ...report, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true,
        stale: true,
        error: msg,
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  ensureSecretsLoaded();
  try {
    const report = await runVideoResearch();
    pushActivity({
      type: "info",
      message: `Video research refreshed: ${report.types.length} types from YouTube.`,
    });
    return NextResponse.json({ ...report, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
