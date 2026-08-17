import { ensureSecretsLoaded } from "@/lib/env/secrets";
import { fetchGitHubTrending } from "@/lib/news/feeds";
import { fetchPageExcerpt } from "./fetchPage";
import { searchRivalSearch } from "@/lib/search/rivalSearch";
import {
  githubKeywords,
  parseResearchQuery,
  tokenize,
  type ParsedResearchQuery,
  type ResearchIntent,
} from "./query";
import type { ResearchKind } from "./types";

export type RawHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  kind: ResearchKind;
  score: number;
  extra?: string;
  why?: string;
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

const SEO_HOSTS = new Set([
  "researchgate.net",
  "spj.science.org",
  "ghtrends.dev",
  "gittrend.io",
  "trending.magikaru.com",
  "git-trends.github.io",
  "gitdiscover.org",
  "findarepo.com",
  "gitstar.space",
  "video-rankings.com",
  "reelmind.ai",
  "promptiex.com",
  "toolradar.com",
  "fast.io",
]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function isSeoFarm(host: string): boolean {
  if (SEO_HOSTS.has(host)) return true;
  return /(trend|ranking|listicle|top-?10)/i.test(host);
}

function overlapScore(query: string, text: string): number {
  const q = tokenize(query);
  if (!q.length) return 0;
  const hay = new Set(tokenize(text));
  let hit = 0;
  for (const w of q) if (hay.has(w)) hit += 1;
  return (hit / q.length) * 22;
}

export function scoreHit(
  hit: Pick<RawHit, "kind" | "url" | "title" | "snippet">,
  parsed: ParsedResearchQuery,
): number {
  const host = hostOf(hit.url);
  const path = pathOf(hit.url);
  const blob = `${hit.title} ${hit.snippet} ${host}`;
  let s = 6 + overlapScore(parsed.search, blob);

  if (parsed.intent === "github") {
    if (hit.kind === "github") s += 16;
    if (hit.kind === "youtube") s -= 10;
  } else if (parsed.intent === "youtube") {
    if (hit.kind === "youtube") s += 16;
    if (hit.kind === "github") s -= 8;
  } else if (parsed.intent === "papers") {
    if (hit.kind === "youtube") s -= 6;
    if (/\barxiv\.org|\.edu$|\.gov$|acm\.org|ieee\.org|nature\.com|sciencedirect\.com\b/i.test(host)) {
      s += 10;
    }
  } else {
    if (hit.kind === "github") s += 4;
    if (hit.kind === "youtube") s += 3;
  }

  if (/\b(docs|developer|official)\b/i.test(host + hit.title)) s += 5;
  if (/\.(edu|gov)$/i.test(host)) s += 4;
  if (hit.title.length > 12) s += 1;

  if (isSeoFarm(host)) s -= 18;
  if (host.endsWith("wikipedia.org")) {
    const leaf = (path.split("/").pop() || "").replace(/_/g, " ");
    const wikiOverlap = overlapScore(parsed.search, leaf);
    if (wikiOverlap < 8) s -= 28;
    else if (parsed.intent !== "general" && parsed.intent !== "papers") s -= 10;
    else s -= 3;
  }

  return s;
}

export function hitKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return `yt:${u.pathname.replace(/^\//, "")}`;
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `yt:${v}`;
    }
    if (host === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `gh:${parts[0]}/${parts[1]}`.toLowerCase();
    }
    return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

export function mixForIntent(
  intent: ResearchIntent,
  limit: number,
): Record<ResearchKind, number> {
  if (intent === "github") {
    return {
      github: Math.round(limit * 0.6),
      website: Math.round(limit * 0.25),
      youtube: Math.round(limit * 0.15),
    };
  }
  if (intent === "youtube") {
    return {
      youtube: Math.round(limit * 0.6),
      website: Math.round(limit * 0.3),
      github: Math.round(limit * 0.1),
    };
  }
  if (intent === "papers") {
    return {
      website: Math.round(limit * 0.7),
      github: Math.round(limit * 0.2),
      youtube: Math.round(limit * 0.1),
    };
  }
  return {
    website: Math.round(limit * 0.4),
    youtube: Math.round(limit * 0.3),
    github: Math.round(limit * 0.3),
  };
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
        max_results: 20,
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
    while ((m = re.exec(html)) && out.length < 25) {
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
    while ((m = re.exec(html)) && out.length < 25) {
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

function githubHeaders(): Record<string, string> {
  ensureSecretsLoaded();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cortex-Research",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function searchGithubTrending(
  parsed: ParsedResearchQuery,
  limit: number,
): Promise<RawHit[]> {
  const days = parsed.days || 14;
  const keywords = githubKeywords(parsed.search);
  try {
    const items = await fetchGitHubTrending(Math.min(30, Math.max(limit, 15)), {
      days,
      keywords,
    });
    return items.map((it) => ({
      title: it.title,
      url: it.url,
      snippet: (it.snippet || "New GitHub repository").slice(0, 400),
      source: "github-trending",
      kind: "github" as const,
      score: 0,
      extra: it.tags?.filter((t) => !t.startsWith("#")).join(" · ") || undefined,
    }));
  } catch {
    return [];
  }
}

async function searchGithubRepos(
  topic: string,
  parsed?: ParsedResearchQuery,
): Promise<RawHit[]> {
  try {
    const parts = [topic.trim(), "fork:false"].filter(Boolean);
    if (parsed?.days) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - parsed.days);
      parts.push(`created:>=${d.toISOString().slice(0, 10)}`);
    }
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", parts.join(" "));
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "25");
    const res = await fetch(url.toString(), {
      headers: githubHeaders(),
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
      score: 0,
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

function rescore(hits: RawHit[], parsed: ParsedResearchQuery): RawHit[] {
  return hits.map((h) => ({ ...h, score: scoreHit(h, parsed) }));
}

/** Deep pass: rewritten query + intent-aware providers. */
export async function gatherResearchHits(topic: string): Promise<{
  hits: RawHit[];
  notes: string[];
  parsed: ParsedResearchQuery;
}> {
  const parsed = parseResearchQuery(topic);
  const q = parsed.search;
  const notes: string[] = [
    `Search “${q}” · ${parsed.intent}${parsed.days ? ` · last ${parsed.days}d` : ""}`,
  ];

  const wantYt = parsed.intent !== "github" && parsed.intent !== "papers";
  const wantGhWeb = parsed.intent !== "youtube";

  const [web, ytWeb, ytApi, ghSearch, ghApi, ghTrend] = await Promise.all([
    searchWebQuery(q),
    wantYt ? searchWebQuery(`${q} site:youtube.com`) : Promise.resolve([]),
    parsed.intent === "papers" ? Promise.resolve([]) : searchYoutube(q),
    wantGhWeb ? searchWebQuery(`${q} site:github.com`) : Promise.resolve([]),
    parsed.intent === "youtube"
      ? Promise.resolve([])
      : searchGithubRepos(githubKeywords(q) || q, parsed),
    parsed.intent === "github" || parsed.wantsTrending
      ? searchGithubTrending(parsed, 30)
      : Promise.resolve([]),
  ]);

  const yt = [...ytWeb, ...ytApi];
  const merged = rescore(
    [...web, ...yt, ...ghSearch, ...ghApi, ...ghTrend],
    parsed,
  );
  if (!web.length) notes.push("General web search returned no hits");
  if (wantYt && !yt.some((h) => h.kind === "youtube")) {
    notes.push("No YouTube videos found");
  }
  if (
    !ghApi.length &&
    !ghTrend.length &&
    !ghSearch.some((h) => h.kind === "github")
  ) {
    notes.push("No GitHub projects found");
  } else if (ghTrend.length) {
    notes.push(
      `GitHub trending: ${ghTrend.length} repos created in the last ${parsed.days || 14}d`,
    );
  } else {
    notes.push("GitHub ranked by stars when the API responded");
  }

  return { hits: merged, notes, parsed };
}

export function pickTopResults(
  hits: RawHit[],
  limit = 50,
  intent: ResearchIntent = "general",
): RawHit[] {
  const byUrl = new Map<string, RawHit>();
  for (const hit of hits) {
    const key = hitKey(hit.url);
    const prev = byUrl.get(key);
    if (!prev || hit.score > prev.score) byUrl.set(key, hit);
  }
  let wikiKept = 0;
  const unique = [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .filter((h) => {
      if (!hostOf(h.url).endsWith("wikipedia.org")) return true;
      wikiKept += 1;
      return wikiKept <= 1;
    });

  const buckets: Record<ResearchKind, RawHit[]> = {
    website: [],
    youtube: [],
    github: [],
  };
  for (const h of unique) buckets[h.kind].push(h);

  const mix = mixForIntent(intent, limit);
  const picked: RawHit[] = [];
  const take = (kind: ResearchKind, n: number) => {
    while (n > 0 && buckets[kind].length) {
      picked.push(buckets[kind].shift()!);
      n -= 1;
    }
  };
  take("website", mix.website);
  take("youtube", mix.youtube);
  take("github", mix.github);
  const rest = [...buckets.website, ...buckets.youtube, ...buckets.github].sort(
    (a, b) => b.score - a.score,
  );
  for (const h of rest) {
    if (picked.length >= limit) break;
    picked.push(h);
  }
  return picked.slice(0, limit);
}

export function prettySourceTitle(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    if (host === "youtu.be" || host.includes("youtube.com")) {
      return u.searchParams.get("v") || host;
    }
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last).replace(/[-_]+/g, " ").slice(0, 80);
    return host;
  } catch {
    return url;
  }
}

export function whyHit(hit: RawHit, parsed: ParsedResearchQuery): string {
  const bits: string[] = [];
  if (hit.extra) bits.push(hit.extra);
  const hay = new Set(tokenize(`${hit.title} ${hit.snippet}`));
  const matches = tokenize(parsed.search).filter((w) => hay.has(w));
  if (matches.length) bits.push(`matches ${matches.slice(0, 4).join(", ")}`);
  if (hit.source === "github-trending") bits.push("created in window");
  if (hit.source === "gpt-researcher") bits.push("GPT Researcher");
  return bits.join(" · ");
}

/** Fetch excerpts for the top web/GitHub hits and bump scores from page text. */
export async function enrichHits(
  hits: RawHit[],
  parsed: ParsedResearchQuery,
  fetchLimit = 10,
): Promise<RawHit[]> {
  const out = hits.map((h) => ({ ...h }));
  const jobs: Promise<void>[] = [];
  let n = 0;
  for (const hit of out) {
    if (n >= fetchLimit) break;
    if (hit.kind === "youtube") continue;
    n += 1;
    jobs.push(
      (async () => {
        const page = await fetchPageExcerpt(hit.url);
        if (!page) return;
        if (page.title && (hit.title === hit.url || hit.title.length < 10)) {
          hit.title = page.title;
        }
        hit.snippet = page.text.slice(0, 400);
        hit.score = scoreHit(hit, parsed) + 5;
      })(),
    );
  }
  await Promise.all(jobs);
  return out.sort((a, b) => b.score - a.score);
}
