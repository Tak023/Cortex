/**
 * Live web context for Jarvis chat.
 * Local models (LM Studio / Ollama) have no network — Cortex fetches
 * search results server-side and injects them into the prompt.
 */

export type LiveSearchHit = {
  title: string;
  url?: string;
  snippet: string;
};

export type LiveContext = {
  searched: boolean;
  query: string;
  provider?: string;
  hits: LiveSearchHit[];
  /** Ready-to-inject prompt block */
  block: string;
};

const TEMPORAL =
  /\b(today|tonight|now|current|currently|latest|recent|recently|this\s+(morning|afternoon|evening|week|month|year|weekend)|right\s+now|as\s+of|breaking|live|headline|headlines|update|updates|202[4-9]|2026)\b/i;

const LIVE_TOPICS =
  /\b(news|weather|forecast|temperature|stock|stocks|market|score|scores|election|poll|traffic|crypto|bitcoin|ethereum|price\s+of|who\s+won|what\s+happened|standings|earnings|ipo|war\s+in|conflict\s+in|president|prime\s+minister|ceo\s+of)\b/i;

/** Whether this user message likely needs live data (not just model weights). */
export function needsLiveData(prompt: string): boolean {
  const q = prompt.trim();
  if (q.length < 3) return false;
  if (TEMPORAL.test(q) || LIVE_TOPICS.test(q)) return true;
  // Open questions and “what/who/when…” almost always benefit from a live look-up
  if (
    /\b(what'?s|whats|what\s+is|who\s+is|who\s+won|how\s+much|how\s+many|when\s+is|where\s+is|tell\s+me\s+about)\b/i.test(
      q,
    ) &&
    q.length < 200
  ) {
    return true;
  }
  if (/\?$/.test(q) && q.length < 180) return true;
  return false;
}

export function formatClockContext(now = new Date()): string {
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const local = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return (
    `Current date/time: ${local} (${tz}). ` +
    `ISO: ${now.toISOString()}. ` +
    `Your weights may be outdated — treat this clock as authoritative for "today/now". ` +
    `When Live web results are provided, prefer them over training memory for facts that change.`
  );
}

function hitsToBlock(
  query: string,
  provider: string,
  hits: LiveSearchHit[],
): string {
  if (!hits.length) {
    return (
      `Live web search for "${query}" via ${provider} returned no results. ` +
      `Say you could not verify live data rather than inventing current events.`
    );
  }
  const lines = hits.slice(0, 6).map((h, i) => {
    const url = h.url ? ` (${h.url})` : "";
    return `${i + 1}. ${h.title}${url}\n   ${h.snippet}`;
  });
  return (
    `Live web results for "${query}" (source: ${provider}). ` +
    `Use these as ground truth for current facts; cite titles briefly when relevant.\n` +
    lines.join("\n")
  );
}

async function searchTavily(query: string): Promise<LiveContext | null> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const hits: LiveSearchHit[] = (data.results ?? [])
      .map((r) => ({
        title: (r.title || "Result").trim(),
        url: r.url,
        snippet: (r.content || "").trim().slice(0, 400),
      }))
      .filter((h) => h.snippet || h.title);
    if (data.answer?.trim()) {
      hits.unshift({
        title: "Tavily summary",
        snippet: data.answer.trim().slice(0, 600),
      });
    }
    return {
      searched: true,
      query,
      provider: "tavily",
      hits,
      block: hitsToBlock(query, "tavily", hits),
    };
  } catch {
    return null;
  }
}

async function searchBrave(query: string): Promise<LiveContext | null> {
  const key = process.env.BRAVE_API_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    const hits: LiveSearchHit[] = (data.web?.results ?? [])
      .map((r) => ({
        title: (r.title || "Result").trim(),
        url: r.url,
        snippet: (r.description || "").trim().slice(0, 400),
      }))
      .filter((h) => h.snippet || h.title);
    return {
      searched: true,
      query,
      provider: "brave",
      hits,
      block: hitsToBlock(query, "brave", hits),
    };
  } catch {
    return null;
  }
}

/** Wikipedia REST summary — free, good for entities / “who is”. */
async function searchWikipedia(query: string): Promise<LiveContext | null> {
  try {
    const title = query
      .replace(/^(who is|what is|what's|whats|tell me about)\s+/i, "")
      .replace(/[?!.]+$/g, "")
      .trim()
      .slice(0, 120);
    if (title.length < 2) return null;
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Cortex/0.2 (local assistant)", Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      extract?: string;
      description?: string;
      content_urls?: { desktop?: { page?: string } };
      type?: string;
    };
    if (data.type === "disambiguation" || !data.extract?.trim()) return null;
    const hits: LiveSearchHit[] = [
      {
        title: data.title || title,
        url: data.content_urls?.desktop?.page,
        snippet: [
          data.description?.trim(),
          data.extract.trim().slice(0, 600),
        ]
          .filter(Boolean)
          .join(" — "),
      },
    ];
    return {
      searched: true,
      query,
      provider: "wikipedia",
      hits,
      block: hitsToBlock(query, "wikipedia", hits),
    };
  } catch {
    return null;
  }
}

/** Free, no-key fallback via DuckDuckGo Instant Answer API. */
async function searchDuckDuckGo(query: string): Promise<LiveContext | null> {
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const res = await fetch(url, {
      headers: { "User-Agent": "Cortex/0.2 (local assistant)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      Answer?: string;
      Definition?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const hits: LiveSearchHit[] = [];
    if (data.Answer?.trim()) {
      hits.push({ title: "Direct answer", snippet: data.Answer.trim() });
    }
    if (data.AbstractText?.trim()) {
      hits.push({
        title: data.Heading || data.AbstractSource || "Summary",
        url: data.AbstractURL,
        snippet: data.AbstractText.trim().slice(0, 500),
      });
    }
    if (data.Definition?.trim()) {
      hits.push({ title: "Definition", snippet: data.Definition.trim() });
    }
    const related = data.RelatedTopics ?? [];
    for (const item of related) {
      if (hits.length >= 6) break;
      if ("Text" in item && item.Text) {
        hits.push({
          title: item.Text.slice(0, 80),
          url: item.FirstURL,
          snippet: item.Text.slice(0, 400),
        });
      } else if ("Topics" in item && item.Topics) {
        for (const t of item.Topics) {
          if (hits.length >= 6) break;
          if (t.Text) {
            hits.push({
              title: t.Text.slice(0, 80),
              url: t.FirstURL,
              snippet: t.Text.slice(0, 400),
            });
          }
        }
      }
    }
    for (const r of data.Results ?? []) {
      if (hits.length >= 6) break;
      if (r.Text) {
        hits.push({
          title: r.Text.slice(0, 80),
          url: r.FirstURL,
          snippet: r.Text.slice(0, 400),
        });
      }
    }

    // DDG abstract is sparse for news — still useful when present
    return {
      searched: true,
      query,
      provider: "duckduckgo",
      hits,
      block: hitsToBlock(query, "duckduckgo", hits),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch live context for a chat turn.
 * Prefer Tavily → Brave → DuckDuckGo. Never throws.
 */
export async function fetchLiveContext(
  prompt: string,
  opts?: { force?: boolean },
): Promise<LiveContext | null> {
  const query = prompt.trim().slice(0, 400);
  if (!query) return null;
  if (!opts?.force && !needsLiveData(query)) return null;

  const ordered = [
    searchTavily,
    searchBrave,
    searchDuckDuckGo,
    searchWikipedia,
  ];
  for (const fn of ordered) {
    const result = await fn(query);
    if (result && result.hits.length > 0) return result;
  }
  // All empty — still return a block so the model does not invent current events
  return {
    searched: true,
    query,
    provider: "none",
    hits: [],
    block: hitsToBlock(query, "none", []),
  };
}
