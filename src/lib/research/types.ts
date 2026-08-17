import type { ResearchIntent } from "./query";

export type { ResearchIntent };

export type ResearchKind = "website" | "youtube" | "github";

export type ResearchMode = "quick" | "deep";

export type ResearchResult = {
  rank: number;
  kind: ResearchKind;
  title: string;
  url: string;
  snippet: string;
  source?: string;
  extra?: string;
  /** Short reason this hit was kept (stars, query matches, recency). */
  why?: string;
};

export type ResearchReport = {
  id: string;
  topic: string;
  researchedAt: string;
  summary: string;
  /** Long-form markdown from GPT Researcher / PaperQA2 */
  report?: string;
  mode?: ResearchMode;
  intent?: ResearchIntent;
  engines?: string[];
  results: ResearchResult[];
  notes: string[];
  counts: { website: number; youtube: number; github: number };
};

export type ResearchHistoryEntry = {
  id: string;
  topic: string;
  researchedAt: string;
  resultCount: number;
  counts: ResearchReport["counts"];
  mode?: ResearchMode;
};
