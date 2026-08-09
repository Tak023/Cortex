/**
 * Technology / AI news for the Jarvis side panel.
 * Priority: Anthropic, Claude Code, Grok, Codex, ChatGPT, Hermes, then broader AI/tech.
 * Public RSS only (no API key required).
 */

export type NewsCategory = "priority" | "ai" | "tech";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  snippet?: string;
  publishedAt?: string;
  category: NewsCategory;
  /** Higher = show first (Anthropic/Claude/Grok/Codex/ChatGPT/Hermes/AI) */
  priority: number;
  /** Matched priority labels for UI chips */
  tags?: string[];
};

export type NewsFeedMeta = {
  id: string;
  name: string;
  category: NewsCategory;
  url: string;
  /** Boost every item from this feed slightly */
  feedBoost?: number;
};

/** Google News + tech/AI outlets. */
export const NEWS_FEEDS: NewsFeedMeta[] = [
  // ── Priority query feeds (ranked higher via content scoring) ──
  {
    id: "gnews-anthropic",
    name: "Anthropic",
    category: "priority",
    url: "https://news.google.com/rss/search?q=Anthropic+OR+%22Claude+AI%22+OR+%22Claude+Code%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 20,
  },
  {
    id: "gnews-claude-code",
    name: "Claude Code",
    category: "priority",
    url: "https://news.google.com/rss/search?q=%22Claude+Code%22+OR+%22Claude+3%22+OR+%22Claude+4%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 20,
  },
  {
    id: "gnews-grok",
    name: "Grok / xAI",
    category: "priority",
    url: "https://news.google.com/rss/search?q=Grok+OR+xAI+OR+%22Elon+Musk%22+AI+OR+%22Grok+Code%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 18,
  },
  {
    id: "gnews-codex",
    name: "Codex",
    category: "priority",
    url: "https://news.google.com/rss/search?q=%22OpenAI+Codex%22+OR+%22Codex+CLI%22+OR+%22OpenAI+coding%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 18,
  },
  {
    id: "gnews-chatgpt",
    name: "ChatGPT",
    category: "priority",
    url: "https://news.google.com/rss/search?q=ChatGPT+OR+OpenAI+OR+GPT-4+OR+GPT-5&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 16,
  },
  {
    id: "gnews-hermes",
    name: "Hermes",
    category: "priority",
    url: "https://news.google.com/rss/search?q=%22Hermes%22+AI+OR+%22Nous+Research%22+OR+%22Hermes+agent%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 16,
  },
  {
    id: "gnews-ai-general",
    name: "AI News",
    category: "ai",
    url: "https://news.google.com/rss/search?q=artificial+intelligence+OR+LLM+OR+%22large+language+model%22+OR+%22AI+agent%22&hl=en-US&gl=US&ceid=US:en",
    feedBoost: 8,
  },
  {
    id: "gnews-tech",
    name: "Technology",
    category: "tech",
    url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
    feedBoost: 2,
  },
  // ── Editorial tech outlets ──
  {
    id: "techcrunch-ai",
    name: "TechCrunch",
    category: "tech",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    feedBoost: 6,
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    category: "tech",
    url: "https://techcrunch.com/feed/",
    feedBoost: 3,
  },
  {
    id: "verge-ai",
    name: "The Verge",
    category: "tech",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    feedBoost: 5,
  },
  {
    id: "verge",
    name: "The Verge",
    category: "tech",
    url: "https://www.theverge.com/rss/index.xml",
    feedBoost: 2,
  },
  {
    id: "hn-ai",
    name: "Hacker News",
    category: "ai",
    url: "https://hnrss.org/newest?q=AI+OR+LLM+OR+Claude+OR+GPT+OR+OpenAI+OR+Anthropic+OR+Grok",
    feedBoost: 7,
  },
  {
    id: "hn",
    name: "Hacker News",
    category: "tech",
    url: "https://hnrss.org/frontpage",
    feedBoost: 3,
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    category: "tech",
    url: "https://feeds.arstechnica.com/arstechnica/technology-lab",
    feedBoost: 4,
  },
  {
    id: "mit-tech-review",
    name: "MIT Tech Review",
    category: "ai",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    feedBoost: 6,
  },
];

export const NEWS_CATEGORIES: { id: NewsCategory | "all"; label: string }[] = [
  { id: "all", label: "All AI" },
  { id: "priority", label: "Labs" },
  { id: "ai", label: "AI" },
  { id: "tech", label: "Tech" },
];

/** Priority keywords → score boost + tag (higher first). */
const PRIORITY_RULES: Array<{ re: RegExp; score: number; tag: string }> = [
  { re: /\banthropic\b/i, score: 100, tag: "Anthropic" },
  { re: /\bclaude\s*code\b/i, score: 95, tag: "Claude Code" },
  { re: /\bclaude\b/i, score: 90, tag: "Claude" },
  { re: /\bgrok\b/i, score: 88, tag: "Grok" },
  { re: /\bxai\b|\bx\.?ai\b/i, score: 85, tag: "xAI" },
  { re: /\bcodex\b/i, score: 88, tag: "Codex" },
  { re: /\bchatgpt\b/i, score: 86, tag: "ChatGPT" },
  { re: /\bopenai\b/i, score: 80, tag: "OpenAI" },
  { re: /\bgpt[-\s]?[45]\b|\bgpt\b/i, score: 75, tag: "GPT" },
  { re: /\bhermes\b/i, score: 88, tag: "Hermes" },
  { re: /\bnous\s*research\b/i, score: 82, tag: "Nous" },
  { re: /\bcursor\b/i, score: 55, tag: "Cursor" },
  { re: /\bwindsurf\b|\bdevin\b|\baider\b/i, score: 50, tag: "Coding agents" },
  {
    re: /\b(llm|large language model|foundation model|ai agent|agentic|generative ai|artificial intelligence|\bai\b)/i,
    score: 40,
    tag: "AI",
  },
  {
    re: /\b(machine learning|\bml\b|deep learning|neural net|transformer model)/i,
    score: 35,
    tag: "ML",
  },
];

function scoreItem(
  title: string,
  snippet: string | undefined,
  feedBoost: number,
): { priority: number; tags: string[] } {
  const text = `${title} ${snippet || ""}`;
  let priority = feedBoost;
  const tags: string[] = [];
  for (const rule of PRIORITY_RULES) {
    if (rule.re.test(text)) {
      priority += rule.score;
      if (!tags.includes(rule.tag)) tags.push(rule.tag);
    }
  }
  return { priority, tags };
}

/** Keep only tech/AI-relevant items (or high priority matches). */
function isTechRelevant(item: NewsItem): boolean {
  if (item.priority >= 40) return true;
  if (item.category === "priority" || item.category === "ai") return true;
  const t = `${item.title} ${item.snippet || ""}`.toLowerCase();
  return (
    /\b(tech|software|startup|silicon|developer|programming|coding|github|api|cloud|chip|nvidia|gpu|semiconductor|saas|app|browser|robot|automation)\b/i.test(
      t,
    ) || item.tags?.some((tag) => tag === "AI" || tag === "ML") === true
  );
}

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
    if (!link) {
      const self = block.match(
        /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i,
      );
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

    const { priority, tags } = scoreItem(title, snippet, feed.feedBoost ?? 0);

    items.push({
      id: `${feed.id}-${hashId(link || title)}`,
      title: title.slice(0, 220),
      url: link,
      source: feed.name,
      snippet: snippet?.slice(0, 280),
      publishedAt,
      category: feed.category,
      priority,
      tags: tags.length ? tags : undefined,
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
        "User-Agent": "Cortex/0.2 (Jarvis AI news panel; +local)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(10_000),
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

export type NewsBundle = {
  items: NewsItem[];
  fetchedAt: string;
  providers: string[];
  category: NewsCategory | "all";
  focus: "technology-ai";
};

function sortByPriorityThenDate(a: NewsItem, b: NewsItem): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (tb !== ta) return tb - ta;
  return a.title.localeCompare(b.title);
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function dedupeByTitle(items: NewsItem[]): NewsItem[] {
  // items should already be sorted highest-priority first
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = normalizeTitleKey(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Aggregate technology / AI feeds with priority ranking. Never throws.
 */
export async function fetchNewsBundle(opts?: {
  category?: NewsCategory | "all";
  limit?: number;
}): Promise<NewsBundle> {
  const category = opts?.category ?? "all";
  const limit = Math.min(Math.max(opts?.limit ?? 28, 6), 50);

  const feeds =
    category === "all"
      ? NEWS_FEEDS
      : NEWS_FEEDS.filter(
          (f) =>
            f.category === category ||
            // Always include priority lab feeds when viewing AI
            (category === "ai" && f.category === "priority"),
        );

  const perFeed = category === "priority" ? 10 : 8;

  const results = await Promise.all(feeds.map((f) => fetchFeed(f, perFeed)));

  const providers = new Set<string>();
  const flat: NewsItem[] = [];
  for (const batch of results) {
    for (const item of batch) {
      providers.add(item.source);
      // Category filter
      if (category === "all") {
        if (isTechRelevant(item)) flat.push(item);
      } else if (category === "priority") {
        if (item.priority >= 75 || item.category === "priority") flat.push(item);
      } else if (category === "ai") {
        if (item.priority >= 35 || item.category === "ai" || item.category === "priority") {
          flat.push(item);
        }
      } else if (item.category === "tech" || isTechRelevant(item)) {
        flat.push(item);
      }
    }
  }

  const items = dedupeByTitle(flat.sort(sortByPriorityThenDate)).slice(0, limit);

  return {
    items,
    fetchedAt: new Date().toISOString(),
    providers: [...providers].sort(),
    category,
    focus: "technology-ai",
  };
}
