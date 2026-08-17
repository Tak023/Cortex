import { nanoid } from "nanoid";
import { chatWithGrok, isAiConfigured } from "@/lib/ai/client";
import {
  classifyUrl,
  enrichHits,
  gatherResearchHits,
  hitKey,
  pickTopResults,
  prettySourceTitle,
  whyHit,
} from "./search";
import { saveReport } from "./store";
import { runGptResearcher, runPaperQa } from "./python";
import type { ParsedResearchQuery } from "./query";
import type {
  ResearchMode,
  ResearchReport,
  ResearchResult,
} from "./types";

export const MAX_TOPIC_LENGTH = 400;
export const RESULT_LIMIT = 50;
export const QUICK_RESULT_LIMIT = 20;

function mergeEngineUrls(
  results: ResearchResult[],
  urls: string[] | undefined,
): ResearchResult[] {
  const have = new Set(results.map((r) => hitKey(r.url)));
  const extra: ResearchResult[] = [];
  for (const raw of urls || []) {
    const url = String(raw || "").trim();
    if (!url.startsWith("http")) continue;
    const key = hitKey(url);
    if (have.has(key)) continue;
    have.add(key);
    extra.push({
      rank: results.length + extra.length + 1,
      kind: classifyUrl(url),
      title: prettySourceTitle(url),
      url,
      snippet: "GPT Researcher source",
      source: "gpt-researcher",
      why: "GPT Researcher",
    });
  }
  return [...results, ...extra].map((r, i) => ({ ...r, rank: i + 1 }));
}

async function grokWriteup(
  topic: string,
  results: ResearchResult[],
  mode: ResearchMode,
  notes: string[],
  parsed?: ParsedResearchQuery,
): Promise<string> {
  if (!isAiConfigured()) {
    return `Found ${results.length} sources. Configure XAI_API_KEY (or OpenAI) to write a ${mode === "quick" ? "briefing" : "full report"}.`;
  }
  const listHint =
    parsed?.intent === "github"
      ? "If they asked for top/trending repos, lead with a markdown table: Rank | Repo | Why | Stars/age | URL."
      : parsed?.intent === "youtube"
        ? "If they asked for top videos, lead with a markdown table: Rank | Video | Channel | Why | URL."
        : "If they asked for a ranked list, lead with a markdown table of the best matching items.";
  try {
    const grok = await chatWithGrok({
      temperature: 0.2,
      maxTokens: mode === "quick" ? 700 : 1600,
      messages: [
        {
          role: "system",
          content:
            "You are a research analyst. Answer the user's question first using only the sources below. " +
            "Do not invent URLs, dates, or star counts. Do not narrate the search process. " +
            "If a source is an aggregator or off-topic, skip it. " +
            listHint,
        },
        {
          role: "user",
          content: `Question: ${topic}\nIntent: ${parsed?.intent || "general"}${
            parsed?.days ? `\nRecency: last ${parsed.days} days` : ""
          }\n\nSources (already ranked):\n${results
            .slice(0, mode === "quick" ? 16 : 28)
            .map(
              (r) =>
                `${r.rank}. [${r.kind}] ${r.title} — ${r.snippet}${r.extra ? ` (${r.extra})` : ""}${r.why ? ` [${r.why}]` : ""} (${r.url})`,
            )
            .join("\n")}`,
        },
      ],
    });
    return grok.content.trim();
  } catch {
    notes.push("Grok writeup skipped");
    return `Found ${results.length} sources (${results.filter((r) => r.kind === "website").length} web).`;
  }
}

export async function runDeepResearch(
  topicRaw: string,
  mode: ResearchMode = "deep",
): Promise<ResearchReport> {
  const topic = topicRaw.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_LENGTH);
  if (!topic) {
    throw new Error("Enter a topic to research.");
  }

  const limit = mode === "quick" ? QUICK_RESULT_LIMIT : RESULT_LIMIT;
  const { hits, notes, parsed } = await gatherResearchHits(topic);
  const fetchLimit = mode === "quick" ? 8 : 12;
  const candidates = pickTopResults(
    hits,
    Math.min(hits.length, Math.max(limit * 2, fetchLimit)),
    parsed.intent,
  );
  const enriched = await enrichHits(candidates, parsed, fetchLimit);
  const top = pickTopResults(enriched, limit, parsed.intent);
  if (!top.length) {
    throw new Error(
      `No live results for “${topic}”. Check network / search providers and try again.`,
    );
  }
  notes.push(`Fetched excerpts for up to ${fetchLimit} pages`);

  let results: ResearchResult[] = top.map((h, i) => ({
    rank: i + 1,
    kind: h.kind,
    title:
      !h.title.trim() || h.title === h.url ? prettySourceTitle(h.url) : h.title,
    url: h.url,
    snippet: h.snippet,
    source: h.source,
    extra: h.extra,
    why: whyHit(h, parsed) || undefined,
  }));

  const engines: string[] = ["cortex-search"];
  const reportParts: string[] = [];
  const engineQuery = parsed.search || topic;
  const sourceUrls = results
    .filter((r) => r.kind !== "youtube")
    .map((r) => r.url)
    .slice(0, 16);
  const runPapers = mode === "deep" && parsed.intent === "papers";

  notes.push(
    mode === "quick"
      ? "Quick Research — Grok briefing + GPT Researcher"
      : "Deep Report — Grok briefing + GPT Researcher + optional PaperQA2",
  );
  if (sourceUrls.length) {
    notes.push(`GPT Researcher seeded with ${sourceUrls.length} ranked URLs`);
  }

  const [briefing, gptr, pqa] = await Promise.all([
    grokWriteup(topic, results, mode, notes, parsed),
    runGptResearcher(
      engineQuery,
      mode === "quick" ? "quick" : "deep",
      mode === "quick" ? 150_000 : 240_000,
      sourceUrls,
    ),
    runPapers
      ? runPaperQa(engineQuery, 240_000)
      : Promise.resolve({
          ok: false as const,
          error: "skipped — not a literature query",
        }),
  ]);

  reportParts.push(briefing);
  if (gptr.ok && gptr.report?.trim()) {
    engines.push("gpt-researcher");
    reportParts.push(`## GPT Researcher\n\n${gptr.report.trim()}`);
    results = mergeEngineUrls(results, gptr.urls);
  } else {
    notes.push(`GPT Researcher skipped (${gptr.error || "no report"})`);
  }
  if (pqa.ok && pqa.answer?.trim()) {
    engines.push("paper-qa");
    reportParts.push(`## Literature (PaperQA2)\n\n${pqa.answer.trim()}`);
  } else if (mode === "deep") {
    notes.push(`PaperQA2 skipped (${pqa.error || "no answer"})`);
  }

  const reportMd = reportParts.join("\n\n");
  const firstPara =
    reportMd
      .split(/\n\n+/)
      .map((p) => p.replace(/^#+.+\n/, "").trim())
      .find((p) => p.length > 40) || reportMd.slice(0, 400);

  const counts = {
    website: results.filter((r) => r.kind === "website").length,
    youtube: results.filter((r) => r.kind === "youtube").length,
    github: results.filter((r) => r.kind === "github").length,
  };

  const report: ResearchReport = {
    id: `res-${nanoid(10)}`,
    topic,
    researchedAt: new Date().toISOString(),
    summary: firstPara.slice(0, 800),
    report: reportMd,
    mode,
    intent: parsed.intent,
    engines,
    results,
    notes,
    counts,
  };
  saveReport(report);
  return report;
}
