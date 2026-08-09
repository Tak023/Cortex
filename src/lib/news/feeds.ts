/**
 * Curated top news feeds for the Jarvis side panel.
 * Uses public RSS (no API key). Optional Tavily enrichment when TAVILY_API_KEY is set.
 */

export type NewsCategory = "top" | "world" | "tech" | "business";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  snippet?: string;
  publishedAt?: string;
  category: NewsCategory;
};

export type NewsFeedMeta = {
  id: string;
  name: string;
  category: NewsCategory;
  url: string;
};

/** High-signal free RSS sources that work without keys. */
export const NEWS_FEEDS: NewsFeedMeta[] = [
  {
    id: "google-top",
    name: "Google News",
    category: "top",
    url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
  },
  {
    id: "bbc-world",
    name: "BBC World",
    category: "world",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
  },
  {
    id: "npr-top",
    name: "NPR",
    category: "top",
    url: "https://feeds.npr.org/1001/rss.xml",
  },
  {
    id: "reuters-world",
    name: "Reuters",
    category: "world",
    url: "https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best",
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    category: "tech",
    url: "https://techcrunch.com/feed/",
  },
  {
    id: "verge",
    name: "The Verge",
    category: "tech",
    url: "https://www.theverge.com/rss/index.xml",
  },
  {
    id: "hn",
    name: "Hacker News",
    category: "tech",
    url: "https://hnrss.org/frontpage",
  },
  {
    id: "cnbc-business",
    name: "CNBC",
    category: "business",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
  },
  {
    id: "google-business",
    name: "Business",
    category: "business",
    url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
  },
];

export const NEWS_CATEGORIES: { id: NewsCategory | "all"; label: string }[] = [
  { id: "all", label: "Top" },
  { id: "world", label: "World" },
  { id: "tech", label: "Tech" },
  { id: "business", label: "Biz" },
];

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagContent(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function parseRssItems(
  xml: string,
  feed: NewsFeedMeta,
  limit: number,
): NewsItem[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  // Atom fallback
  const entryChunks =
    chunks.length > 0 ? chunks : xml.split(/<entry[\s>]/i).slice(1);

  const items: NewsItem[] = [];
  for (const raw of entryChunks) {
    if (items.length >= limit) break;
    const block = raw.split(/<\/item>|<\/entry>/i)[0] ?? raw;
    const title = tagContent(block, "title");
    let link =
      tagContent(block, "link") ||
      tagContent(block, "id") ||
      (() => {
        const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
        return href?.[1] ?? "";
      })();
    // Google News sometimes puts link in <link>href without body
    if (!link) {
      const self = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
      link = self?.[1] ?? "";
    }
    if (!title || !link) continue;
    const snippet =
      tagContent(block, "description") ||
      tagContent(block, "summary") ||
      tagContent(block, "content") ||
      undefined;
    const publishedAt =
      tagContent(block, "pubDate") ||
      tagContent(block, "published") ||
      tagContent(block, "updated") ||
      undefined;

    items.push({
      id: `${feed.id}-${hashId(link || title)}`,
      title: title.slice(0, 220),
      url: link,
      source: feed.name,
      snippet: snippet?.slice(0, 280),
      publishedAt,
      category: feed.category,
    });
  }
  return items;
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function fetchFeed(
  feed: NewsFeedMeta,
  perFeed: number,
): Promise<NewsItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Cortex/0.2 (Jarvis news panel; +local)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(10_000),
      // Avoid Next caching forever in prod route handlers we control ourselves
      cache: "no-store",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    if (!xml || xml.length < 40) return [];
    return parseRssItems(xml, feed, perFeed);
  } catch {
    return [];
  }
}

/** Optional Tavily “top stories” boost when key is present. */
async function fetchTavilyTop(limit: number): Promise<NewsItem[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: "top news headlines today",
        topic: "news",
        search_depth: "basic",
        max_results: Math.min(limit, 8),
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .filter((r) => r.title && r.url)
      .map((r) => ({
        id: `tavily-${hashId(r.url!)}`,
        title: (r.title || "").trim().slice(0, 220),
        url: r.url!,
        source: "Tavily",
        snippet: (r.content || "").trim().slice(0, 280),
        category: "top" as const,
      }));
  } catch {
    return [];
  }
}

export type NewsBundle = {
  items: NewsItem[];
  fetchedAt: string;
  providers: string[];
  category: NewsCategory | "all";
};

function sortByDateDesc(a: NewsItem, b: NewsItem): number {
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (tb !== ta) return tb - ta;
  return a.title.localeCompare(b.title);
}

function dedupeByTitle(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Aggregate curated feeds (+ optional Tavily). Never throws.
 */
export async function fetchNewsBundle(opts?: {
  category?: NewsCategory | "all";
  limit?: number;
}): Promise<NewsBundle> {
  const category = opts?.category ?? "all";
  const limit = Math.min(Math.max(opts?.limit ?? 24, 6), 40);

  const feeds =
    category === "all"
      ? NEWS_FEEDS
      : NEWS_FEEDS.filter((f) => f.category === category || f.category === "top");

  // For "top" / all: pull fewer per source and merge; topic views deeper
  const perFeed = category === "all" || category === "top" ? 4 : 8;

  const results = await Promise.all([
    ...feeds.map((f) => fetchFeed(f, perFeed)),
    category === "all" || category === "top"
      ? fetchTavilyTop(6)
      : Promise.resolve([] as NewsItem[]),
  ]);

  const providers = new Set<string>();
  const flat: NewsItem[] = [];
  for (const batch of results) {
    for (const item of batch) {
      providers.add(item.source);
      if (category === "all" || category === "top" || item.category === category) {
        flat.push(item);
      }
    }
  }

  const items = dedupeByTitle(flat.sort(sortByDateDesc)).slice(0, limit);

  return {
    items,
    fetchedAt: new Date().toISOString(),
    providers: [...providers].sort(),
    category,
  };
}
