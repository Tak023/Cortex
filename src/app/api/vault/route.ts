import { NextResponse } from "next/server";
import { searchVault, vaultStatus } from "@/lib/vault/vault";
import { searchLance } from "@/lib/lancedb/store";

export const dynamic = "force-dynamic";

/** Vault status, plus keyword search results when ?q= is provided. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const vault = vaultStatus();
  if (!q) return NextResponse.json({ vault });
  const keyword = searchVault(q, { limit: 8 });
  let lance: Awaited<ReturnType<typeof searchLance>> = [];
  try {
    lance = await searchLance(q, 8);
  } catch {
    lance = [];
  }
  const seen = new Set((keyword?.hits || []).map((h) => h.path));
  const merged = [
    ...(keyword?.hits || []),
    ...lance
      .filter((h) => h.source === "vault" && !seen.has(h.path))
      .map((h) => ({
        path: h.path,
        title: h.title,
        snippet: h.snippet,
        score: h.score,
      })),
  ].slice(0, 8);
  return NextResponse.json({
    vault,
    results: merged,
    lancedb: lance.length,
  });
}
