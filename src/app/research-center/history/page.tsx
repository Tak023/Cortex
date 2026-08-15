"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { formatRelative } from "@/lib/utils";
import type { ResearchHistoryEntry } from "@/lib/research/types";

export default function ResearchHistoryPage() {
  const [entries, setEntries] = useState<ResearchHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/research/history", { cache: "no-store" });
      const json = (await res.json()) as { entries?: ResearchHistoryEntry[] };
      setEntries(json.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    await fetch(`/api/research/history/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <>
      <PageHeader
        title="Research history"
        description="Topics you have already deep-researched"
        actions={
          <Link href="/research-center">
            <Button type="button" variant="secondary" size="sm">
              <ArrowLeft className="h-4 w-4" />
              New research
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {error ? <p className="mb-3 text-sm text-rose-400">{error}</p> : null}
        {!entries.length ? (
          <p className="text-sm text-muted">
            No research yet. Run a topic from the Research tab.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/5"
              >
                <Link
                  href={`/research-center/history/${entry.id}`}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-sm font-medium">{entry.topic}</div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {entry.resultCount} sources · {entry.counts.website} web ·{" "}
                    {entry.counts.youtube} YouTube · {entry.counts.github} GitHub
                    · {formatRelative(entry.researchedAt)}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="rounded-md p-2 text-muted hover:bg-white/10 hover:text-rose-300"
                  aria-label={`Delete ${entry.topic}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
