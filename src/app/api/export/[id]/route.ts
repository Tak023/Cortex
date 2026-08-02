import { NextResponse } from "next/server";
import { getProject, getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const activity = getState().activity.filter((a) => a.projectId === id);
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    project,
    activity,
    agents: getState().agents.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      roles: a.roles,
    })),
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cortex-${id}.json"`,
    },
  });
}
