import { ensureSecretsLoaded } from "@/lib/env/secrets";
import { searchRivalSearch } from "@/lib/search/rivalSearch";
import type { ResearchKind } from "./types";

export type RawHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  kind: ResearchKind;
  score: number;
  extra?: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyUrl(url: string): ResearchKind {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) {
      return "youtube";
    }
    if (host === "github.com" || host === "gist.github.com") return "github";
  } catch {
    /* ignore */
  }
  return "website";
}

function asAbsoluteUrl(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

function unwrapRedirect(raw: string): string {
  try {
    const u = new URL(asAbsoluteUrl(raw));
    const host = u.hostname.replace(/^www\./, "");
    if (host === "duckduckgo.com" && (u.pathname === "/l/" || u.pathname === "/l")) {
      return u.searchParams.get("uddg") || raw;
    }
    if (host.endsWith("google.com") && u.pathname === "/url") {
      return u.searchParams.get("q") || u.searchParams.get("url") || raw;
    }
    if (host.endsWith("yahoo.com") && u.searchParams.get("RU")) {
      return u.searchParams.get("RU") || raw;
    }
    if (host.endsWith("bing.com") && u.pathname === "/ck/a") {
      const u2 = u.searchParams.get("u");
      if (u2) return u2.startsWith("a1") ? Buffer.from(u2.slice(2), "base64").toString("utf8") : u2;
    }
  } catch {
    /* keep original */
  }
  return raw;
}

function isAdOrTrackerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "duckduckgo.com" && u.pathname === "/y.js") return true;
    if (u.searchParams.has("ad_domain") || u.searchParams.has("ad_provider")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function normalizeUrl(raw: string): string | null {
  try {
    const unwrapped = unwrapRedirect(raw);
    if (unwrapped !== raw) return normalizeUrl(unwrapped);
    const u = new URL(asAbsoluteUrl(unwrapped));
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    const href = u.toString();
    if (isAdOrTrackerUrl(href)) return null;
    return href;
  } catch {
    return null;
  }
}

function scoreHit(kind: ResearchKind, url: string, title: string): number {
  let s = 10;
  if (kind === "github") s += 12;
  if (kind === "youtube") s += 10;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (/\b(docs|developer|dev|wiki|official)\b/i.test(host + title)) s += 6;
  if (/\.(edu|gov)$/i.test(host)) s += 4;
  if (title.length > 12) s += 2;
  return s;
}

async function searchTavily(query: string): Promise<RawHit[]> {
  ensureSecretsLoaded();
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: 10,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return toHits(data.results || [], "tavily");
  } catch {
    return [];
  }
}

async function searchDdgHtml(query: string): Promise<RawHit[]> {
  try {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 12) {
      const href = decodeXml(m[1] || "");
      const title = decodeXml(m[2] || "");
      if (!title || !href) continue;
      const after = html.slice(m.index, m.index + 1800);
      const snip =
        /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|span)>/i.exec(after);
      const snippet = decodeXml(snip?.[1] || "") || title;
      out.push({ title, url: href, snippet });
    }
    return toHits(out, "duckduckgo");
  } catch {
    return [];
  }
}

function decodeJsString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\u0026/g, "&").replace(/\\"/g, '"');
  }
}

async function searchYoutube(topic: string): Promise<RawHit[]> {
  try {
    const url = new URL("https://www.youtube.com/results");
    url.searchParams.set("search_query", topic);
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const seen = new Set<string>();
    const out: RawHit[] = [];
    const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 10) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const slice = html.slice(m.index, m.index + 4000);
      const titleM = /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/.exec(slice);
      const authorM =
        /"ownerText":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/.exec(slice) ||
        /"longBylineText":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/.exec(slice);
      const title = titleM ? decodeJsString(titleM[1]) : `YouTube video ${id}`;
      const author = authorM ? decodeJsString(authorM[1]) : "";
      out.push({
        title: title.slice(0, 220),
        url: `https://www.youtube.com/watch?v=${id}`,
        snippet: (author ? `${author} · YouTube` : "YouTube video").slice(0, 400),
        source: "youtube",
        kind: "youtube",
        score: 22,
        extra: author || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function searchGithubRepos(topic: string): Promise<RawHit[]> {
  try {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", topic);
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "10");
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Cortex-Research",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{
        full_name?: string;
        html_url?: string;
        description?: string | null;
        stargazers_count?: number;
        language?: string | null;
      }>;
    };
    return (data.items || [])
      .map((repo) => {
        const url = repo.html_url || "";
        const stars = repo.stargazers_count ?? 0;
        const lang = repo.language ? ` · ${repo.language}` : "";
        return {
          title: repo.full_name || url,
          url,
          snippet: (repo.description || "GitHub repository").slice(0, 400),
          source: "github-api",
          kind: "github" as const,
          score: 18 + Math.min(25, Math.log10(stars + 1) * 10),
          extra: `${stars.toLocaleString()} stars${lang}`,
        };
      })
      .filter((h) => h.url);
  } catch {
    return [];
  }
}

function toHits(
  rows: Array<{ title?: string; url?: string; snippet?: string; content?: string }>,
  source: string,
): RawHit[] {
  const out: RawHit[] = [];
  for (const r of rows) {
    const url = normalizeUrl(String(r.url || ""));
    if (!url) continue;
    const title = (r.title || url).trim();
    const snippet = (r.snippet || r.content || title).trim().slice(0, 400);
    const kind = classifyUrl(url);
    out.push({
      title: title.slice(0, 220),
      url,
      snippet,
      source,
      kind,
      score: scoreHit(kind, url, title),
    });
  }
  return out;
}

async function searchWebQuery(query: string): Promise<RawHit[]> {
  const [rival, tavily, ddg] = await Promise.all([
    searchRivalSearch(query, { mode: "web", timeoutMs: 18_000 }).catch(
      () => null,
    ),
    searchTavily(query),
    searchDdgHtml(query),
  ]);
  const rivalHits = toHits(
    (rival?.hits || []).map((h) => ({
      title: h.title,
      url: h.url,
      snippet: h.snippet,
    })),
    rival?.provider || "rival-search",
  );
  return [...rivalHits, ...tavily, ...ddg];
}

/** Deep pass: general web + YouTube + GitHub in parallel. */
export async function gatherResearchHits(topic: string): Promise<{
  hits: RawHit[];
  notes: string[];
}> {
  const notes: string[] = [];
  const [web, ytWeb, ytApi, ghSearch, ghApi] = await Promise.all([
    searchWebQuery(topic),
    searchWebQuery(`${topic} site:youtube.com`),
    searchYoutube(topic),
    searchWebQuery(`${topic} site:github.com`),
    searchGithubRepos(topic),
  ]);

  const yt = [...ytWeb, ...ytApi];
  const merged = [...web, ...yt, ...ghSearch, ...ghApi];
  if (!web.length) notes.push("General web search returned no hits");
  if (!yt.some((h) => h.kind === "youtube")) notes.push("No YouTube videos found");
  if (!ghApi.length && !ghSearch.some((h) => h.kind === "github")) {
    notes.push("No GitHub projects found");
  } else {
    notes.push("GitHub ranked by stars when the API responded");
  }

  return { hits: merged, notes };
}

export function pickTopResults(hits: RawHit[], limit = 20): RawHit[] {
  const byUrl = new Map<string, RawHit>();
  for (const hit of hits) {
    const key = hit.url.replace(/\/+$/, "").toLowerCase();
    const prev = byUrl.get(key);
    if (!prev || hit.score > prev.score) byUrl.set(key, hit);
  }
  const unique = [...byUrl.values()].sort((a, b) => b.score - a.score);

  const buckets: Record<ResearchKind, RawHit[]> = {
    website: [],
    youtube: [],
    github: [],
  };
  for (const h of unique) buckets[h.kind].push(h);

  const picked: RawHit[] = [];
  const take = (kind: ResearchKind, n: number) => {
    while (n > 0 && buckets[kind].length) {
      picked.push(buckets[kind].shift()!);
      n -= 1;
    }
  };
  // Guarantee a mix when sources exist, then fill by remaining score.
  take("website", 8);
  take("youtube", 6);
  take("github", 6);
  const rest = [...buckets.website, ...buckets.youtube, ...buckets.github].sort(
    (a, b) => b.score - a.score,
  );
  for (const h of rest) {
    if (picked.length >= limit) break;
    picked.push(h);
  }
  return picked.slice(0, limit);
}
