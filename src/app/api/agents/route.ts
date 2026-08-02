import { NextResponse } from "next/server";
import { getAgents } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ agents: getAgents() });
}
