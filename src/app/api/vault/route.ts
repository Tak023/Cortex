import { NextResponse } from "next/server";
import { searchVault, vaultStatus } from "@/lib/vault/vault";

export const dynamic = "force-dynamic";

/** Vault status, plus keyword search results when ?q= is provided. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const vault = vaultStatus();
  if (!q) return NextResponse.json({ vault });
  const results = searchVault(q, { limit: 8 });
  return NextResponse.json({ vault, results: results?.hits ?? [] });
}
