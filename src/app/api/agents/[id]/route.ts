import { NextResponse } from "next/server";
import { getAgent, pushActivity, updateAgent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json({ agent });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const agent = getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const action = body.action as string | undefined;

  if (action === "start") {
    const updated = updateAgent(id, {
      status: "idle",
      currentTaskId: null,
      currentTaskLabel: null,
    });
    pushActivity({
      type: "agent_status",
      message: `${agent.name} started (online)`,
      agentId: id,
    });
    return NextResponse.json({ agent: updated });
  }

  if (action === "stop") {
    const updated = updateAgent(id, {
      status: "offline",
      currentTaskId: null,
      currentTaskLabel: null,
    });
    pushActivity({
      type: "agent_status",
      message: `${agent.name} stopped`,
      agentId: id,
    });
    return NextResponse.json({ agent: updated });
  }

  if (action === "restart") {
    const updated = updateAgent(id, {
      status: "idle",
      currentTaskId: null,
      currentTaskLabel: null,
    });
    pushActivity({
      type: "agent_status",
      message: `${agent.name} restarted`,
      agentId: id,
    });
    return NextResponse.json({ agent: updated });
  }

  const updated = updateAgent(id, {
    ...(body.status ? { status: body.status } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.config
      ? { config: { ...agent.config, ...body.config } }
      : {}),
  });

  return NextResponse.json({ agent: updated });
}
