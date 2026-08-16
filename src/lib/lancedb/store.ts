/**
 * Embedded LanceDB (https://github.com/lancedb/lancedb) for Cortex.
 * Indexes the second-brain vault + research history for full-text search.
 */
import fs from "fs";
import path from "path";
import { getDataDir } from "@/lib/store";
import { listReports, getReport } from "@/lib/research/store";
import { listVaultNoteDocuments } from "@/lib/vault/vault";

const TABLE = "documents";
const TEXT_CAP = 8_000;

export type LanceDocument = {
  id: string;
  source: string;
  title: string;
  text: string;
  path: string;
  updatedAt: string;
};

export type LanceHit = {
  id: string;
  source: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
};

export type LanceStatus = {
  ready: boolean;
  dir: string;
  rows: number;
  error?: string;
};

type LanceMod = typeof import("@lancedb/lancedb");

let lanceMod: LanceMod | null = null;
let dbPromise: Promise<import("@lancedb/lancedb").Connection> | null = null;

export function getLanceDir(): string {
  return path.join(getDataDir(), "lancedb");
}

async function loadLance(): Promise<LanceMod> {
  if (!lanceMod) {
    const loader = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<LanceMod>;
    lanceMod = await loader("@lancedb/lancedb");
  }
  return lanceMod;
}

async function connectDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const dir = getLanceDir();
      fs.mkdirSync(dir, { recursive: true });
      const lance = await loadLance();
      return lance.connect(dir);
    })();
  }
  return dbPromise;
}

function snippetOf(text: string, query: string): string {
  const q = query.trim().split(/\s+/).find((w) => w.length >= 3);
  const low = text.toLowerCase();
  const idx = q ? low.indexOf(q.toLowerCase()) : 0;
  const start = Math.max(0, (idx < 0 ? 0 : idx) - 60);
  return text.slice(start, start + 280).replace(/\s+/g, " ").trim();
}

function collectDocuments(): LanceDocument[] {
  const now = new Date().toISOString();
  const docs: LanceDocument[] = [];
  for (const note of listVaultNoteDocuments()) {
    docs.push({
      id: note.id,
      source: "vault",
      title: note.title,
      text: note.text.slice(0, TEXT_CAP),
      path: note.path,
      updatedAt: now,
    });
  }
  for (const entry of listReports()) {
    const full = getReport(entry.id);
    const body = [
      entry.topic,
      full?.summary || "",
      full?.report || "",
      (full?.results || [])
        .slice(0, 20)
        .map((r) => `${r.title} ${r.snippet}`)
        .join("\n"),
    ]
      .join("\n")
      .slice(0, TEXT_CAP);
    docs.push({
      id: `research:${entry.id}`,
      source: "research",
      title: entry.topic,
      text: body || entry.topic,
      path: `/research-center/history/${entry.id}`,
      updatedAt: entry.researchedAt,
    });
  }
  return docs;
}

export async function lanceStatus(): Promise<LanceStatus> {
  const dir = getLanceDir();
  try {
    const db = await connectDb();
    const names = await db.tableNames();
    if (!names.includes(TABLE)) {
      return { ready: true, dir, rows: 0 };
    }
    const table = await db.openTable(TABLE);
    const rows = await table.countRows();
    return { ready: true, dir, rows };
  } catch (e) {
    return {
      ready: false,
      dir,
      rows: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function reindexLance(): Promise<LanceStatus> {
  const lance = await loadLance();
  const db = await connectDb();
  const docs = collectDocuments();
  const rows = docs.length
    ? docs
    : [
        {
          id: "placeholder",
          source: "system",
          title: "empty",
          text: "empty index",
          path: "",
          updatedAt: new Date().toISOString(),
        },
      ];
  const existing = await db.tableNames();
  if (existing.includes(TABLE)) {
    await db.dropTable(TABLE);
  }
  const table = await db.createTable(TABLE, rows);
  await table.createIndex("text", { config: lance.Index.fts() });
  return lanceStatus();
}

export async function searchLance(
  query: string,
  limit = 8,
): Promise<LanceHit[]> {
  const q = query.trim();
  if (!q) return [];
  const db = await connectDb();
  const names = await db.tableNames();
  if (!names.includes(TABLE)) {
    await reindexLance();
  }
  const table = await db.openTable(TABLE);
  try {
    const found = await table
      .query()
      .fullTextSearch(q)
      .limit(Math.max(1, Math.min(40, limit)))
      .toArray();
    return found
      .filter((row) => row.id !== "placeholder")
      .map((row, i) => ({
        id: String(row.id ?? ""),
        source: String(row.source ?? ""),
        title: String(row.title ?? ""),
        path: String(row.path ?? ""),
        snippet: snippetOf(String(row.text ?? ""), q),
        score: Math.max(1, 20 - i),
      }));
  } catch {
    return [];
  }
}

export const LANCEDB_TOOLS = [
  {
    name: "search",
    description: "Full-text search the local LanceDB index (vault + research)",
  },
  {
    name: "reindex",
    description: "Rebuild the LanceDB index from the vault and research history",
  },
  {
    name: "status",
    description: "Report LanceDB path and row count",
  },
];
