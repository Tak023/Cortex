import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getIdeas, upsertIdea } from "@/lib/store";
import type { Idea } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ideas: getIdeas() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const statement = String(body.statement || "").trim();
  if (!statement) {
    return NextResponse.json(
      { error: "statement is required" },
      { status: 400 },
    );
  }

  const idea: Idea = {
    id: `idea-${nanoid(8)}`,
    statement,
    templateId: body.templateId ?? null,
    concepts: [],
    selectedConceptId: null,
    projectId: null,
    createdAt: new Date().toISOString(),
    status: "draft",
  };

  upsertIdea(idea);
  return NextResponse.json({ idea }, { status: 201 });
}
