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
/** GitHub trending refreshes more often so the top-20 list stays current */
const GITHUB_TTL_MS = 2 * 60 * 1000;

const VALID: Array<NewsCategory | "all"> = [
  "all",
  "priority",
  "ai",
  "tech",
  "github",
];

export async function GET(req: NextRequest) {
  ensureSecretsLoaded();

  const sp = req.nextUrl.searchParams;
  const rawCat = (sp.get("category") || "all").toLowerCase();
  const category = (
    VALID.includes(rawCat as NewsCategory | "all") ? rawCat : "all"
  ) as NewsCategory | "all";
  const defaultLimit = category === "github" ? 20 : 28;
  const limit = Number(sp.get("limit") || String(defaultLimit)) || defaultLimit;
  const force = sp.get("refresh") === "1";

  // Bump cache key when GitHub ranking rules change so clients never see stale lists
  const key = `news-v3-gh2w-top20:${category}:${limit}`;
  const ttl = category === "github" ? GITHUB_TTL_MS : TTL_MS;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) {
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
