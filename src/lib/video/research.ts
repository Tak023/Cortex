/**
 * Video Generator researcher — YouTube-backed ranking of AI-generatable
 * viral formats. Live view counts come from watch-page metadata; web search
 * (Tavily / RivalSearch) finds extra examples. Types are ranked by the
 * highest verified example view count.
 */
import fs from "fs";
import path from "path";
import { chatWithGrok, isAiConfigured } from "@/lib/ai/client";
import { searchRivalSearch } from "@/lib/search/rivalSearch";
import { getDataDir } from "@/lib/store";
import { ensureSecretsLoaded } from "@/lib/env/secrets";

export type VideoExample = {
  title: string;
  url: string;
  videoId: string;
  channel: string;
  views: number | null;
  viewsLabel: string;
};

export type ViralVideoType = {
  rank: number;
  name: string;
  slug: string;
  description: string;
  whyAiGeneratable: string;
  tools: string[];
  examples: VideoExample[];
  views: number;
  viewsLabel: string;
};

export type VideoResearchReport = {
  researchedAt: string;
  query: string;
  researcher: string;
  source: string;
  types: ViralVideoType[];
  notes: string[];
};

type SeedType = {
  name: string;
  slug: string;
  description: string;
  whyAiGeneratable: string;
  tools: string[];
  seeds: string[];
  queries: string[];
};

const RESEARCH_QUERY =
  "YouTube top trending viral AI-generated video types 2026 Sora Veo Kling Ghibli";

/** Formats that can actually be produced with current AI video tools. */
const SEED_TYPES: SeedType[] = [
  {
    name: "Cinematic text-to-video showcases",
    slug: "cinematic-t2v",
    description:
      "Short films and model demos with camera moves, lighting, and multi-character scenes generated from a prompt (Sora, Veo, Kling).",
    whyAiGeneratable:
      "Native text-to-video models output 5–120s cinematic clips with audio. No footage or crew required.",
    tools: ["Sora", "Google Veo", "Kling", "Runway"],
    seeds: [
      "https://www.youtube.com/watch?v=HK6y8DAPN_0",
      "https://www.youtube.com/watch?v=gzneGhpXwjU",
    ],
    queries: [
      "site:youtube.com Introducing Sora OpenAI",
      "site:youtube.com Veo 3 AI video cinematic",
    ],
  },
  {
    name: "Abandoned / analog-horror walkthroughs",
    slug: "abandoned-horror",
    description:
      "First-person walks through empty malls, houses, and liminal spaces. High watch time; often faceless.",
    whyAiGeneratable:
      "Image-to-video + consistent location prompts recreate decaying interiors. Free tools can batch these.",
    tools: ["Kling", "Runway", "Luma", "Pika"],
    seeds: ["https://www.youtube.com/watch?v=JoCW4kMKxbY"],
    queries: [
      "site:youtube.com abandoned AI video viral",
      "site:youtube.com liminal space AI generated",
    ],
  },
  {
    name: "AI video model bake-offs",
    slug: "model-bakeoff",
    description:
      "Side-by-side rankings of Sora vs Veo vs Kling vs Grok using the same prompt. Recurring 2026 YouTube format.",
    whyAiGeneratable:
      "Each clip in the compilation is generated; the video is a montage of model outputs.",
    tools: ["Sora", "Veo", "Kling", "Grok Imagine", "Wan"],
    seeds: [
      "https://www.youtube.com/watch?v=-vwHldNaGPI",
      "https://www.youtube.com/watch?v=12Qm1KfgRic",
    ],
    queries: [
      "site:youtube.com best AI video generators 2026",
      "site:youtube.com Sora vs Veo vs Kling",
    ],
  },
  {
    name: "Ghibli / anime lifestyle stories",
    slug: "ghibli-anime",
    description:
      "Painterly day-in-the-life and travel stories in a Studio Ghibli look. 155M+ TikTok clips; YouTube long-form is growing fast.",
    whyAiGeneratable:
      "Still images in a Ghibli style (ChatGPT / Midjourney) plus image-to-video (Kling, Seedance) produce full narrated or silent stories.",
    tools: ["ChatGPT images", "Kling", "Seedance", "OpenArt"],
    seeds: [
      "https://www.youtube.com/watch?v=0vYU1sQ9x0U",
      "https://www.youtube.com/watch?v=y0jJnsgVLzs",
    ],
    queries: [
      "site:youtube.com Ghibli style AI video",
      "site:youtube.com Ghibli Days AI",
    ],
  },
  {
    name: "UGC product ads & talking heads",
    slug: "ugc-talking-head",
    description:
      "Creator-style product spots and multilingual talking heads. Highest conversion format for brands in 2026.",
    whyAiGeneratable:
      "Kling / Veo lip-sync and avatar tools generate UGC ads without a camera or talent.",
    tools: ["Kling", "Veo", "HeyGen", "Hedra"],
    seeds: ["https://www.youtube.com/watch?v=lHhHEw-Nkg0"],
    queries: [
      "site:youtube.com AI UGC ad generator",
      "site:youtube.com Kling talking head AI video",
    ],
  },
  {
    name: "Physics morph effects (Cakeify, squish, inflate)",
    slug: "physics-morph",
    description:
      "Objects become cake, inflate, melt, or float. Short-form effect templates dominating TikTok/Shorts in 2026.",
    whyAiGeneratable:
      "Effect-tuned image-to-video models apply one transform to any still. Fully generative; no VFX artist.",
    tools: ["Kling", "Pika", "Runway", "CapCut AI"],
    seeds: ["https://www.youtube.com/watch?v=P1ikZ8Dic20"],
    queries: [
      "site:youtube.com AI Cakeify video",
      "site:youtube.com AI inflate squish effect",
    ],
  },
  {
    name: "Faceless AI story / history niches",
    slug: "faceless-story",
    description:
      "Narrated history, 'what if', and story channels with generated b-roll. New channels hitting tens of millions of views.",
    whyAiGeneratable:
      "TTS + generated b-roll + stock-free scenes. Entire channels ship with no on-camera host.",
    tools: ["ElevenLabs", "Veo", "InVideo", "Kling"],
    seeds: ["https://www.youtube.com/watch?v=RkvH_933QpE"],
    queries: [
      "site:youtube.com faceless AI YouTube niche million views",
      "site:youtube.com AI history story channel",
    ],
  },
  {
    name: "Satisfying / ASMR AI clips",
    slug: "asmr-satisfying",
    description:
      "Glass fruit, cutting, slime, mermaid-animal hybrids, and other loopable satisfying clips. Individual shorts have been cited at 10M–244M views off-platform.",
    whyAiGeneratable:
      "Short loops from a single prompt. Ideal for Shorts; no live-action capture.",
    tools: ["Kling", "Pika", "Sora", "Veo"],
    seeds: ["https://www.youtube.com/watch?v=hYJRsBGr3zM"],
    queries: [
      "site:youtube.com AI ASMR satisfying video",
      "site:youtube.com mermaid dog AI video",
    ],
  },
  {
    name: "AI music videos & vocal clones",
    slug: "ai-music-video",
    description:
      "Prompted music videos synced to Suno/Udio tracks, plus viral vocal-clone performances.",
    whyAiGeneratable:
      "Audio models write the song; video models generate the visual. End-to-end generative.",
    tools: ["Suno", "Udio", "Sora", "Runway"],
    seeds: ["https://www.youtube.com/watch?v=i8_Pz7sBp_M"],
    queries: [
      "site:youtube.com AI generated music video Suno",
      "site:youtube.com Sora music video",
    ],
  },
  {
    name: "How-to / workflow videos about making AI video",
    slug: "howto-workflow",
    description:
      "Tutorials that both explain and demonstrate generating viral AI video. Consistently high YouTube search demand in 2026.",
    whyAiGeneratable:
      "The A-roll can be a talking avatar; the B-roll is the generated output itself.",
    tools: ["Kling", "ChatGPT", "Google Flow", "OpenArt"],
    seeds: [
      "https://www.youtube.com/watch?v=R3rwxET3VC8",
      "https://www.youtube.com/watch?v=VwMTbQx0MMs",
    ],
    queries: [
      "site:youtube.com how to make viral AI videos 2026",
      "site:youtube.com AI video workflow tutorial",
    ],
  },
];

function reportPath(): string {
  return path.join(getDataDir(), "video-research.json");
}

export function loadVideoResearchReport(): VideoResearchReport | null {
  try {
    const p = reportPath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as VideoResearchReport;
    if (!raw?.types?.length) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveVideoResearchReport(report: VideoResearchReport) {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPath(), JSON.stringify(report, null, 2), "utf8");
}

export function formatViewCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace("/", "").slice(0, 11) || null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

function parseCompactViews(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  const m = s.match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mul =
    m[2]?.toUpperCase() === "B"
      ? 1_000_000_000
      : m[2]?.toUpperCase() === "M"
        ? 1_000_000
        : m[2]?.toUpperCase() === "K"
          ? 1_000
          : 1;
  return Math.round(n * mul);
}

async function fetchYoutubeMeta(
  videoId: string,
): Promise<Omit<VideoExample, "url" | "videoId"> | null> {
  const url = watchUrl(videoId);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const viewExact = html.match(/"viewCount"\s*:\s*"(\d+)"/);
    const viewSimple = html.match(
      /"shortViewCountText"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"/,
    );
    const title =
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
      html.match(/"title"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"/)?.[1] ||
      html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(
        /\s*-\s*YouTube\s*$/i,
        "",
      ) ||
      `YouTube ${videoId}`;
    const channel =
      html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i)?.[1] ||
      html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/)?.[1] ||
      html.match(/"author"\s*:\s*"([^"]+)"/)?.[1] ||
      "YouTube";
    const views =
      viewExact?.[1] != null
        ? Number(viewExact[1])
        : viewSimple?.[1]
          ? parseCompactViews(viewSimple[1])
          : null;
    return {
      title: decodeHtml(title),
      channel: decodeHtml(channel),
      views: views != null && Number.isFinite(views) ? views : null,
      viewsLabel: formatViewCount(
        views != null && Number.isFinite(views) ? views : null,
      ),
    };
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collectYoutubeUrls(text: string): string[] {
  const out: string[] = [];
  const re =
    /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]{11}[^\s)"']*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0].split("&")[0]);
  return out;
}

async function searchTavilyUrls(query: string): Promise<string[]> {
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
        search_depth: "basic",
        max_results: 6,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ url?: string; content?: string }>;
    };
    const urls: string[] = [];
    for (const r of data.results || []) {
      if (r.url) urls.push(r.url);
      if (r.content) urls.push(...collectYoutubeUrls(r.content));
    }
    return urls;
  } catch {
    return [];
  }
}

async function discoverUrls(queries: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const q of queries.slice(0, 2)) {
    const [tavily, rival] = await Promise.all([
      searchTavilyUrls(q),
      searchRivalSearch(q, { mode: "web", timeoutMs: 10_000 }).catch(
        () => null,
      ),
    ]);
    found.push(...tavily);
    for (const h of rival?.hits || []) {
      if (h.url) found.push(h.url);
      found.push(...collectYoutubeUrls(`${h.title} ${h.snippet}`));
    }
  }
  return found;
}

const metaCache = new Map<string, VideoExample>();

async function exampleFromUrl(url: string): Promise<VideoExample | null> {
  const id = youtubeVideoId(url);
  if (!id) return null;
  const hit = metaCache.get(id);
  if (hit) return hit;
  const meta = await fetchYoutubeMeta(id);
  const example: VideoExample = {
    videoId: id,
    url: watchUrl(id),
    title: meta?.title || `YouTube ${id}`,
    channel: meta?.channel || "YouTube",
    views: meta?.views ?? null,
    viewsLabel: meta?.viewsLabel || "—",
  };
  metaCache.set(id, example);
  return example;
}

async function uniqueExamples(
  urls: string[],
  limit: number,
): Promise<VideoExample[]> {
  const seen = new Set<string>();
  const out: VideoExample[] = [];
  for (const url of urls) {
    const id = youtubeVideoId(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ex = await exampleFromUrl(url);
    if (ex) out.push(ex);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
}

async function grokRefine(
  types: ViralVideoType[],
): Promise<{ types: ViralVideoType[]; note?: string }> {
  if (!isAiConfigured()) {
    return { types, note: "Grok not configured — ranked from live YouTube metadata." };
  }
  try {
    const compact = types.map((t) => ({
      slug: t.slug,
      name: t.name,
      topViews: t.views,
      examples: t.examples.map((e) => ({
        title: e.title,
        url: e.url,
        views: e.views,
      })),
    }));
    const result = await chatWithGrok({
      temperature: 0.2,
      maxTokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You are a YouTube research analyst. Return ONLY valid JSON: " +
            '{"notes": string, "order": string[]} where order is the slugs ' +
            "sorted by how viral/generatable the format is, preferring higher view counts. Do not invent URLs.",
        },
        {
          role: "user",
          content:
            "Rank these AI-generatable YouTube video types using the live examples:\n" +
            JSON.stringify(compact),
        },
      ],
    });
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { types, note: `Grok ${result.model} (unparsed)` };
    const parsed = JSON.parse(jsonMatch[0]) as {
      notes?: string;
      order?: string[];
    };
    if (!parsed.order?.length) {
      return { types, note: parsed.notes || `Grok ${result.model}` };
    }
    const bySlug = new Map(types.map((t) => [t.slug, t]));
    const ordered: ViralVideoType[] = [];
    for (const slug of parsed.order) {
      const t = bySlug.get(slug);
      if (t) ordered.push(t);
    }
    for (const t of types) {
      if (!ordered.some((x) => x.slug === t.slug)) ordered.push(t);
    }
    return {
      types: ordered,
      note: parsed.notes || `Ranked with Grok (${result.model})`,
    };
  } catch (e) {
    return {
      types,
      note: `Grok ranking skipped: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function runVideoResearch(): Promise<VideoResearchReport> {
  ensureSecretsLoaded();
  const notes: string[] = [];
  const built = await Promise.all(
    SEED_TYPES.map(async (seed) => {
      const discovered = await discoverUrls(seed.queries);
      const examples = await uniqueExamples(
        [...seed.seeds, ...discovered],
        3,
      );
      const views = examples.reduce(
        (max, e) => Math.max(max, e.views ?? 0),
        0,
      );
      return {
        rank: 0,
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        whyAiGeneratable: seed.whyAiGeneratable,
        tools: seed.tools,
        examples,
        views,
        viewsLabel: formatViewCount(views || null),
      } satisfies ViralVideoType;
    }),
  );

  const refined = await grokRefine(built);
  if (refined.note) notes.push(refined.note);

  const ranked = [...refined.types]
    .sort((a, b) => b.views - a.views)
    .slice(0, 10)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const ytCount = ranked.reduce((n, t) => n + t.examples.length, 0);
  notes.unshift(
    `Live YouTube metadata on ${ytCount} example videos · types ranked by highest example views.`,
  );

  const report: VideoResearchReport = {
    researchedAt: new Date().toISOString(),
    query: RESEARCH_QUERY,
    researcher: "Cortex researcher · YouTube + live web search",
    source: isAiConfigured() ? "youtube+search+grok" : "youtube+search",
    types: ranked,
    notes,
  };
  saveVideoResearchReport(report);
  return report;
}
