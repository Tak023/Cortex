export type ResearchKind = "website" | "youtube" | "github";

export type ResearchResult = {
  rank: number;
  kind: ResearchKind;
  title: string;
  url: string;
  snippet: string;
  source?: string;
  extra?: string;
};

export type ResearchReport = {
  id: string;
  topic: string;
  researchedAt: string;
  summary: string;
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
};
