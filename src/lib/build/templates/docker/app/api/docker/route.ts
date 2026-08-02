import { NextResponse } from "next/server";
import {
  listContainers,
  openDockerDesktop,
  restartContainer,
  startContainer,
  stopContainer,
} from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await listContainers();
  return NextResponse.json(info);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const id = String(body.id || "");

  try {
    if (action === "open_desktop") {
      await openDockerDesktop();
      return NextResponse.json({ ok: true, message: "Opening Docker Desktop…" });
    }
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    if (action === "start") {
      const out = await startContainer(id);
      return NextResponse.json({ ok: true, out });
    }
    if (action === "stop") {
      const out = await stopContainer(id);
      return NextResponse.json({ ok: true, out });
    }
    if (action === "restart") {
      const out = await restartContainer(id);
      return NextResponse.json({ ok: true, out });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
