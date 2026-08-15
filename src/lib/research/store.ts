import fs from "fs";
import path from "path";
import { getDataDir } from "@/lib/store";
import type { ResearchHistoryEntry, ResearchReport } from "./types";

const MAX_REPORTS = 50;

function filePath(): string {
  return path.join(getDataDir(), "research-history.json");
}

function loadAll(): ResearchReport[] {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
      reports?: ResearchReport[];
    };
    return Array.isArray(raw.reports) ? raw.reports : [];
  } catch {
    return [];
  }
}

function saveAll(reports: ResearchReport[]) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(
    filePath(),
    JSON.stringify({ reports: reports.slice(0, MAX_REPORTS) }, null, 2),
    "utf8",
  );
}

export function saveReport(report: ResearchReport): void {
  const all = loadAll().filter((r) => r.id !== report.id);
  all.unshift(report);
  saveAll(all);
}

export function listReports(): ResearchHistoryEntry[] {
  return loadAll().map((r) => ({
    id: r.id,
    topic: r.topic,
    researchedAt: r.researchedAt,
    resultCount: r.results.length,
    counts: r.counts,
  }));
}

export function getReport(id: string): ResearchReport | null {
  return loadAll().find((r) => r.id === id) ?? null;
}

export function deleteReport(id: string): boolean {
  const all = loadAll();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  saveAll(next);
  return true;
}
