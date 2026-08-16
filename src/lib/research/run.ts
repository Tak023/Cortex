import { nanoid } from "nanoid";
import { chatWithGrok, isAiConfigured } from "@/lib/ai/client";
import { gatherResearchHits, pickTopResults } from "./search";
import { saveReport } from "./store";
import { runGptResearcher, runPaperQa } from "./python";
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
  const have = new Set(results.map((r) => r.url.replace(/\/+$/, "").toLowerCase()));
  const extra: ResearchResult[] = [];
  for (const raw of urls || []) {
    const url = String(raw || "").trim();
    if (!url.startsWith("http")) continue;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    extra.push({
      rank: results.length + extra.length + 1,
      kind: /youtube\.com|youtu\.be/i.test(url)
        ? "youtube"
        : /github\.com/i.test(url)
          ? "github"
          : "website",
      title: url,
      url,
      snippet: "GPT Researcher source",
      source: "gpt-researcher",
    });
  }
  return [...results, ...extra].map((r, i) => ({ ...r, rank: i + 1 }));
}

async function grokWriteup(
  topic: string,
  results: ResearchResult[],
  mode: ResearchMode,
  notes: string[],
): Promise<string> {
  if (!isAiConfigured()) {
    return `Found ${results.length} sources. Configure XAI_API_KEY (or OpenAI) to write a ${mode === "quick" ? "briefing" : "full report"}.`;
  }
  try {
    const grok = await chatWithGrok({
      temperature: 0.2,
      maxTokens: mode === "quick" ? 500 : 1600,
      messages: [
        {
          role: "system",
          content:
            mode === "quick"
              ? "You are a research analyst. Write a 3–6 paragraph briefing from the sources. Do not invent URLs or facts."
              : "You are a research analyst. Write a structured report: Abstract, Key findings, Evidence, Counterpoints, Recommendations. Do not invent URLs or facts.",
        },
        {
          role: "user",
          content: `Topic: ${topic}\n\nSources:\n${results
            .slice(0, mode === "quick" ? 12 : 24)
            .map((r) => `${r.rank}. [${r.kind}] ${r.title} — ${r.snippet} (${r.url})`)
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
  const { hits, notes } = await gatherResearchHits(topic);
  const top = pickTopResults(hits, limit);
  if (!top.length) {
    throw new Error(
      `No live results for “${topic}”. Check network / search providers and try again.`,
    );
  }

  let results: ResearchResult[] = top.map((h, i) => ({
    rank: i + 1,
    kind: h.kind,
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    source: h.source,
    extra: h.extra,
  }));

  const engines: string[] = ["cortex-search"];
  const reportParts: string[] = [];

  if (mode === "quick") {
    notes.push("Quick Research — GPT Researcher (assafelovic/gpt-researcher)");
    const gptr = await runGptResearcher(topic, "quick", 150_000);
    if (gptr.ok && gptr.report?.trim()) {
      engines.push("gpt-researcher");
      reportParts.push(gptr.report.trim());
      results = mergeEngineUrls(results, gptr.urls);
    } else {
      notes.push(
        `GPT Researcher unavailable (${gptr.error || "no report"}) — Cortex briefing`,
      );
    }
  } else {
    notes.push(
      "Deep Report — GPT Researcher + PaperQA2 (Future-House/paper-qa)",
    );
    const [gptr, pqa] = await Promise.all([
      runGptResearcher(topic, "deep", 240_000),
      runPaperQa(topic, 240_000),
    ]);
    if (gptr.ok && gptr.report?.trim()) {
      engines.push("gpt-researcher");
      reportParts.push(`## Web research (GPT Researcher)\n\n${gptr.report.trim()}`);
      results = mergeEngineUrls(results, gptr.urls);
    } else {
      notes.push(`GPT Researcher skipped (${gptr.error || "no report"})`);
    }
    if (pqa.ok && pqa.answer?.trim()) {
      engines.push("paper-qa");
      reportParts.push(`## Literature (PaperQA2)\n\n${pqa.answer.trim()}`);
    } else {
      notes.push(`PaperQA2 skipped (${pqa.error || "no answer"})`);
    }
  }

  if (!reportParts.length) {
    reportParts.push(await grokWriteup(topic, results, mode, notes));
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
    engines,
    results,
    notes,
    counts,
  };
  saveReport(report);
  return report;
}
