/**
 * Technology / AI news for the Jarvis side panel.
 * Priority: Anthropic, Claude Code, Grok, Codex, ChatGPT, Hermes, then broader AI/tech.
 * Plus GitHub trending (high-star / newly rising repos via Search API).
 * Public RSS + public GitHub API (no key required; GITHUB_TOKEN optional for higher rate limits).
 */

export type NewsCategory = "priority" | "ai" | "tech" | "github";

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
  /** GitHub star count when item is a repo */
  stars?: number;
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
  { id: "github", label: "GitHub" },
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
  // GitHub tab / github items: highest stars first (newest-window already filtered)
  if (a.category === "github" && b.category === "github") {
    if ((b.stars ?? 0) !== (a.stars ?? 0)) {
      return (b.stars ?? 0) - (a.stars ?? 0);
    }
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (tb !== ta) return tb - ta;
    return a.title.localeCompare(b.title);
  }
  if (b.priority !== a.priority) return b.priority - a.priority;
  if ((b.stars ?? 0) !== (a.stars ?? 0)) return (b.stars ?? 0) - (a.stars ?? 0);
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (tb !== ta) return tb - ta;
  return a.title.localeCompare(b.title);
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Map star count → priority so mega-repos surface under GitHub / All. */
function starsToPriority(stars: number): number {
  // log scale: 100★≈55, 1k★≈70, 10k★≈85, 50k★≈95, 100k★≈100
  if (stars <= 0) return 40;
  const p = 40 + Math.log10(stars + 1) * 18;
  return Math.min(110, Math.round(p));
}

type GhRepo = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  topics?: string[];
  fork?: boolean;
};

/**
 * GitHub tab rule:
 *   Top N projects **created in the past 14 days**, ranked by **most stars**.
 * (Not evergreen repos; not “updated recently” — only brand-new projects.)
 */
export const GITHUB_TOP_N = 20;
export const GITHUB_CREATED_WITHIN_DAYS = 14;

/**
 * Top star-ranked repositories created within the last 2 weeks.
 * Uses public Search API (no key required; set GITHUB_TOKEN for higher limits).
 */
export async function fetchGitHubTrending(
  limit = GITHUB_TOP_N,
): Promise<NewsItem[]> {
  const topN = Math.min(Math.max(limit, 1), GITHUB_TOP_N);
  const since = isoDateDaysAgo(GITHUB_CREATED_WITHIN_DAYS);
  const cutoffMs =
    Date.now() - GITHUB_CREATED_WITHIN_DAYS * 24 * 60 * 60 * 1000;

  // Single search: new projects only, GitHub sorts by stars for us
  const query = `created:>=${since} fork:false`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cortex/0.2 (Jarvis GitHub news; +local)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  let raw: GhRepo[] = [];
  try {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(Math.min(100, Math.max(topN, 30))));
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { items?: GhRepo[] };
      raw = Array.isArray(json.items) ? json.items : [];
    }
  } catch {
    raw = [];
  }

  // Keep only non-forks created in the last 14 days; rank by stars
  const repos = raw
    .filter((repo) => {
      if (!repo?.id || repo.fork) return false;
      const created = repo.created_at ? Date.parse(repo.created_at) : 0;
      return created > 0 && created >= cutoffMs;
    })
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, topN);

  const items: NewsItem[] = [];
  for (let rank = 0; rank < repos.length; rank++) {
    const repo = repos[rank];
    const stars = repo.stargazers_count ?? 0;
    const tags: string[] = [
      `#${rank + 1}`,
      `★ ${formatStars(stars)}`,
      "New (2w)",
    ];
    if (repo.language) tags.push(repo.language);
    for (const t of (repo.topics || []).slice(0, 1)) {
      if (!tags.includes(t)) tags.push(t);
    }

    // Pure star ranking for GitHub tab (higher stars = higher priority)
    const priority = 200 - rank; // #1 highest

    const created = repo.created_at ? Date.parse(repo.created_at) : 0;
    const ageDays =
      created > 0
        ? Math.max(0, Math.floor((Date.now() - created) / 86_400_000))
        : 0;

    items.push({
      id: `gh-top-${repo.id}`,
      title: repo.full_name,
      url: repo.html_url,
      source: "GitHub",
      snippet:
        (repo.description || "No description").slice(0, 200) +
        ` · ★ ${formatStars(stars)}` +
        (repo.language ? ` · ${repo.language}` : "") +
        ` · created ${ageDays}d ago`,
      publishedAt: repo.created_at || repo.updated_at,
      category: "github",
      priority,
      tags: tags.slice(0, 5),
      stars,
    });
  }

  return items;
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
 * Includes GitHub trending (high-star / rising repos) for `github` and `all`.
 */
export async function fetchNewsBundle(opts?: {
  category?: NewsCategory | "all";
  limit?: number;
}): Promise<NewsBundle> {
  const category = opts?.category ?? "all";
  const limit = Math.min(Math.max(opts?.limit ?? 28, 6), 50);

  // GitHub-only tab: top 20 new projects (created last 14 days) by stars
  if (category === "github") {
    const gh = await fetchGitHubTrending(GITHUB_TOP_N);
    // Already sorted by stars; do not re-mix with news priority rules
    return {
      items: gh.slice(0, GITHUB_TOP_N),
      fetchedAt: new Date().toISOString(),
      providers: gh.length ? ["GitHub"] : [],
      category,
      focus: "technology-ai",
    };
  }

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

  // In All/Tech, surface a few of the same top new GitHub projects
  const includeGithub = category === "all" || category === "tech";
  const [results, githubItems] = await Promise.all([
    Promise.all(feeds.map((f) => fetchFeed(f, perFeed))),
    includeGithub
      ? fetchGitHubTrending(category === "all" ? 8 : 5)
      : Promise.resolve([] as NewsItem[]),
  ]);

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
        if (
          item.priority >= 35 ||
          item.category === "ai" ||
          item.category === "priority"
        ) {
          flat.push(item);
        }
      } else if (item.category === "tech" || isTechRelevant(item)) {
        flat.push(item);
      }
    }
  }

  for (const item of githubItems) {
    providers.add(item.source);
    flat.push(item);
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
