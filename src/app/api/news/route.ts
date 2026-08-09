import { NextRequest, NextResponse } from "next/server";
import {
  fetchNewsBundle,
  type NewsBundle,
  type NewsCategory,
} from "@/lib/news/feeds";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { at: number; data: NewsBundle };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

const VALID: Array<NewsCategory | "all"> = [
  "all",
  "top",
  "world",
  "tech",
  "business",
];

export async function GET(req: NextRequest) {
  ensureSecretsLoaded();

  const sp = req.nextUrl.searchParams;
  const rawCat = (sp.get("category") || "all").toLowerCase();
  const category = (
    VALID.includes(rawCat as NewsCategory | "all") ? rawCat : "all"
  ) as NewsCategory | "all";
  const limit = Number(sp.get("limit") || "24") || 24;
  const force = sp.get("refresh") === "1";

  const key = `${category}:${limit}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({
      ...hit.data,
      cached: true,
      cacheAgeMs: Date.now() - hit.at,
    });
  }

  const data = await fetchNewsBundle({ category, limit });
  cache.set(key, { at: Date.now(), data });

  return NextResponse.json({
    ...data,
    cached: false,
    cacheAgeMs: 0,
  });
}
