import { NextResponse } from "next/server";
import { vaultGraph, hasGraphifyGraph, graphifyGraphPath } from "@/lib/vault/graph";
import { vaultStatus } from "@/lib/vault/vault";

export const dynamic = "force-dynamic";

/**
 * Knowledge graph of the second brain.
 *
 * `?source=wikilinks` forces the live link-derived graph; the default prefers
 * graphify's semantic graph and falls back to live when it has not been built.
 */
export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source");
  const vault = vaultStatus();

  if (!vault.enabled || !vault.available) {
    return NextResponse.json({
      vault,
      graph: null,
      graphify: { available: false, path: graphifyGraphPath() },
    });
  }

  const graph = vaultGraph(source === "wikilinks" ? { source } : undefined);
  return NextResponse.json({
    vault,
    graph,
    graphify: { available: hasGraphifyGraph(), path: graphifyGraphPath() },
  });
}
