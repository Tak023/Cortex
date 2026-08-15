import { NextResponse } from "next/server";
import { MAX_TOPIC_LENGTH, runDeepResearch } from "@/lib/research/run";
import { pushActivity } from "@/lib/store";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  ensureSecretsLoaded();
  const body = (await req.json().catch(() => ({}))) as { topic?: string };
  const topic = String(body.topic || "").trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json(
      { error: `Topic must be under ${MAX_TOPIC_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const report = await runDeepResearch(topic);
    pushActivity({
      type: "info",
      message: `Research: “${report.topic}” — ${report.results.length} sources`,
    });
    return NextResponse.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
