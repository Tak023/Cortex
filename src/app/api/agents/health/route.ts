import { NextResponse } from "next/server";
import { fleetHealth } from "@/lib/agents/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/health — live fleet strip: installed, version, auth mode,
 * approval posture and workspace scope for every embedded agent CLI.
 *
 * `?versions=0` skips the `--version` probes when only policy state is needed.
 */
export async function GET(req: Request) {
  const probeVersions =
    new URL(req.url).searchParams.get("versions") !== "0";
  try {
    return NextResponse.json({
      agents: fleetHealth({ probeVersions }),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fleet health failed" },
      { status: 500 },
    );
  }
}
