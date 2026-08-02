import { NextResponse } from "next/server";
import {
  getAgents,
  getIdea,
  getProjects,
  pushActivity,
  upsertIdea,
  upsertProject,
} from "@/lib/store";
import { createProjectFromConcept } from "@/lib/orchestration/pipeline";
import { startProjectRunner } from "@/lib/orchestration/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: getProjects() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const ideaId = body.ideaId as string;
  const conceptId = body.conceptId as string;

  const idea = getIdea(ideaId);
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  const concept = idea.concepts.find((c) => c.id === conceptId);
  if (!concept) {
    return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  }

  const project = createProjectFromConcept({
    ideaId,
    concept,
    agents: getAgents(),
  });

  upsertProject(project);
  upsertIdea({
    ...idea,
    selectedConceptId: conceptId,
    projectId: project.id,
    status: "selected",
  });

  pushActivity({
    type: "project_created",
    message: `Project launched: "${project.name}"`,
    projectId: project.id,
  });

  startProjectRunner(project.id);

  return NextResponse.json({ project }, { status: 201 });
}
