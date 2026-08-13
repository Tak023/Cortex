import { NextResponse } from "next/server";
import { getProviderUsageCards } from "@/lib/providers/usage";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = {
  at: number;
  cards: Awaited<ReturnType<typeof getProviderUsageCards>>;
};
let cache: CacheEntry | null = null;
const TTL_MS = 60_000;
/** Hard ceiling so Command Center never waits on slow portal APIs. */
const FETCH_BUDGET_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`provider usage timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function GET(req: Request) {
  ensureSecretsLoaded();
  const force = new URL(req.url).searchParams.get("refresh") === "1";

  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({
      providers: cache.cards,
      cached: true,
      fetchedAt: new Date(cache.at).toISOString(),
    });
  }

  try {
    const cards = await withTimeout(getProviderUsageCards(), FETCH_BUDGET_MS);
    cache = { at: Date.now(), cards };
    return NextResponse.json({
      providers: cards,
      cached: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Prefer stale cache over empty Command Center
    if (cache?.cards?.length) {
      return NextResponse.json({
        providers: cache.cards,
        cached: true,
        stale: true,
        error: msg,
        fetchedAt: new Date(cache.at).toISOString(),
      });
    }
    return NextResponse.json(
      { error: msg, providers: [] },
      { status: 500 },
    );
  }
}
