import { nanoid } from "nanoid";
import { chatWithGrok, isAiConfigured } from "@/lib/ai/client";
import { gatherResearchHits, pickTopResults } from "./search";
import { saveReport } from "./store";
import type { ResearchReport, ResearchResult } from "./types";

export const MAX_TOPIC_LENGTH = 400;
export const RESULT_LIMIT = 50;

export async function runDeepResearch(topicRaw: string): Promise<ResearchReport> {
  const topic = topicRaw.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_LENGTH);
  if (!topic) {
    throw new Error("Enter a topic to research.");
  }

  const { hits, notes } = await gatherResearchHits(topic);
  const top = pickTopResults(hits, RESULT_LIMIT);
  if (!top.length) {
    throw new Error(
      `No live results for “${topic}”. Check network / search providers and try again.`,
    );
  }

  const results: ResearchResult[] = top.map((h, i) => ({
    rank: i + 1,
    kind: h.kind,
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    source: h.source,
    extra: h.extra,
  }));

  const counts = {
    website: results.filter((r) => r.kind === "website").length,
    youtube: results.filter((r) => r.kind === "youtube").length,
    github: results.filter((r) => r.kind === "github").length,
  };

  let summary = `Found ${results.length} sources (${counts.website} web, ${counts.youtube} YouTube, ${counts.github} GitHub).`;
  if (isAiConfigured()) {
    try {
      const grok = await chatWithGrok({
        temperature: 0.2,
        maxTokens: 280,
        messages: [
          {
            role: "system",
            content:
              "You are a research analyst. In 3–5 sentences, summarize what the sources say about the topic. Do not invent URLs or facts not supported by the titles/snippets.",
          },
          {
            role: "user",
            content: `Topic: ${topic}\n\nSources:\n${results
              .slice(0, 12)
              .map((r) => `${r.rank}. [${r.kind}] ${r.title} — ${r.snippet}`)
              .join("\n")}`,
          },
        ],
      });
      if (grok.content.trim()) summary = grok.content.trim();
    } catch {
      notes.push("Grok summary skipped — showing source list only");
    }
  }

  const report: ResearchReport = {
    id: `res-${nanoid(10)}`,
    topic,
    researchedAt: new Date().toISOString(),
    summary,
    results,
    notes,
    counts,
  };
  saveReport(report);
  return report;
}
