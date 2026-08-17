/**
 * Turn a Research-tab sentence into a search query + intent.
 * Stops “Research the top…” from matching Wikipedia/ResearchGate.
 */
export type ResearchIntent = "github" | "youtube" | "papers" | "general";

export type ParsedResearchQuery = {
  original: string;
  /** Clean keywords for search engines */
  search: string;
  intent: ResearchIntent;
  /** Recency window in days when the user asked for “last N days/weeks” or trending GitHub */
  days: number | null;
  wantsTrending: boolean;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "when",
  "how",
  "are",
  "was",
  "were",
  "you",
  "your",
  "all",
  "any",
  "can",
  "also",
  "into",
  "over",
  "than",
  "then",
  "them",
  "they",
  "have",
  "has",
  "had",
  "not",
  "but",
  "about",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function detectDays(text: string): number | null {
  const m = text.match(
    /\b(?:past|last|previous|prior)\s+(\d+)\s*(day|days|week|weeks)\b/i,
  );
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return /week/i.test(m[2]) ? n * 7 : n;
  }
  if (/\b(this|past|last)\s+week\b/i.test(text)) return 7;
  if (/\b(this|past|last)\s+month\b/i.test(text)) return 30;
  if (/\b(fortnight|two\s+weeks?|2\s*weeks?|fourteen\s+days)\b/i.test(text)) {
    return 14;
  }
  return null;
}

export function detectIntent(text: string): ResearchIntent {
  if (
    /\b(arxiv|pubmed|doi|scholar|literature|paperqa|preprint)\b/i.test(text) ||
    (/\bpapers?\b/i.test(text) && !/\bnewspapers?\b/i.test(text))
  ) {
    return "papers";
  }
  if (/\b(youtube|youtu\.be|videos?|shorts)\b/i.test(text)) return "youtube";
  if (
    /\b(github|repos?|repositories)\b/i.test(text) ||
    (/\bopen[-\s]?source\b/i.test(text) &&
      /\b(agents?|projects?|library|libraries|frameworks?|tools?|cli)\b/i.test(
        text,
      ))
  ) {
    return "github";
  }
  return "general";
}

function stripFiller(text: string): string {
  return text
    .replace(
      /^\s*(please\s+)?(research|investigate|look\s*up|find|show|list|give|tell)(\s+me)?\s+/i,
      "",
    )
    .replace(/\b(please|research|investigate|look\s+up)\b/gi, " ")
    .replace(/\bthe\s+top(\s+\d+)?\b/gi, " ")
    .replace(/\bfor the\b/gi, " ")
    .replace(/\b(past|last|previous|prior)\s+\d+\s*(days?|weeks?)\b/gi, " ")
    .replace(/\b(this|past|last)\s+(week|month)\b/gi, " ")
    .replace(
      /\b(with the highest star ratings?|fast[-\s]?growing star ratings?|even if they are not in the top \d+)\b/gi,
      " ",
    )
    .replace(
      /\b(link all the|instructions on how to|also,? show|i want to|i need)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Keywords to AND into GitHub Search (drop words the API already encodes). */
export function githubKeywords(search: string): string {
  return tokenize(
    search.replace(
      /\b(github|repos?|repositories|projects?|trending|stars?|ratings?|new|newest|latest|open[-\s]?source)\b/gi,
      " ",
    ),
  ).join(" ");
}

export function parseResearchQuery(topicRaw: string): ParsedResearchQuery {
  const original = topicRaw.trim().replace(/\s+/g, " ");
  const intent = detectIntent(original);
  let days = detectDays(original);
  const wantsTrending = /\b(trending|fast[-\s]?growing|rising|viral)\b/i.test(
    original,
  );
  if (wantsTrending && intent === "github" && days == null) days = 14;

  let search = stripFiller(original);
  if (tokenize(search).length < 2) {
    search = original.replace(/^\s*(please\s+)?research\s+/i, "").trim() || original;
  }

  return { original, search, intent, days, wantsTrending };
}
