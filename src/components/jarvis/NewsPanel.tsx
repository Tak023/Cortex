"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Newspaper,
  RefreshCw,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  NEWS_CATEGORIES,
  type NewsCategory,
  type NewsItem,
} from "@/lib/news/feeds";

type NewsResponse = {
  items: NewsItem[];
  fetchedAt: string;
  providers: string[];
  category: NewsCategory | "all";
  focus?: string;
  cached?: boolean;
  error?: string;
};

type Props = {
  className?: string;
  /** Send a headline into Jarvis chat */
  onAsk?: (headline: string, url?: string) => void;
};

function formatRelative(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function NewsPanel({ className, onAsk }: Props) {
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [data, setData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (opts?: { refresh?: boolean; cat?: NewsCategory | "all" }) => {
      const cat = opts?.cat ?? category;
      const refresh = Boolean(opts?.refresh);
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({
          category: cat,
          limit: "28",
        });
        if (refresh) q.set("refresh", "1");
        const res = await fetch(`/api/news?${q}`);
        const json = (await res.json()) as NewsResponse;
        if (!res.ok) {
          throw new Error(json.error || `News failed (${res.status})`);
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load news");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [category],
  );

  useEffect(() => {
    void load({ cat: category });
  }, [category, load]);

  // Auto-refresh every 5 minutes while panel is mounted
  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ refresh: true });
    }, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const items = data?.items ?? [];

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-l border-border-subtle bg-panel/40",
        className,
      )}
      aria-label="AI technology news feeds"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Newspaper className="h-4 w-4 shrink-0 text-sky-300" />
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
              AI · Tech news
            </div>
            <div className="truncate text-[10px] text-muted">
              Priority: Anthropic · Claude · Grok · Codex · ChatGPT · Hermes
              {data?.fetchedAt ? (
                <span className="text-muted/70">
                  {" "}
                  · {formatRelative(data.fetchedAt)}
                  {data.cached ? " · cached" : ""}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={loading || refreshing}
          onClick={() => void load({ refresh: true })}
          aria-label="Refresh news"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-2 py-2">
        {NEWS_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide uppercase transition-colors",
              category === c.id
                ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40"
                : "text-muted hover:bg-white/5 hover:text-foreground/90",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading feeds…
          </div>
        ) : error && !items.length ? (
          <div className="space-y-2 px-2 py-6 text-center">
            <p className="text-xs text-amber-300/90">{error}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void load({ refresh: true })}
            >
              Retry
            </Button>
          </div>
        ) : !items.length ? (
          <p className="px-2 py-8 text-center text-xs text-muted">
            No headlines right now. Try refresh or another tab.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <article
                  className={cn(
                    "group rounded-lg border border-transparent px-2.5 py-2 transition-colors",
                    "hover:border-border/80 hover:bg-panel-elevated/70",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
                    <span className="truncate text-sky-300/80">{item.source}</span>
                    {item.publishedAt ? (
                      <>
                        <span className="opacity-40">·</span>
                        <span>{formatRelative(item.publishedAt)}</span>
                      </>
                    ) : null}
                    {(item.priority ?? 0) >= 75 ? (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-violet-200 ring-1 ring-violet-400/30">
                        Priority
                      </span>
                    ) : null}
                  </div>
                  {item.tags?.length ? (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-border-subtle px-1.5 py-0.5 text-[9px] font-medium text-sky-200/90"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[13px] font-medium leading-snug text-foreground/95 group-hover:text-sky-100"
                  >
                    {item.title}
                  </a>
                  {item.snippet ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                      {item.snippet}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/5 hover:text-sky-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </a>
                    {onAsk ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/5 hover:text-sky-300"
                        onClick={() =>
                          onAsk(
                            `Brief me on this headline: "${item.title}"`,
                            item.url,
                          )
                        }
                      >
                        <MessageSquare className="h-3 w-3" />
                        Ask Jarvis
                      </button>
                    ) : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
