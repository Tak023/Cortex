"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { History, Loader2, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResultsList } from "@/components/research/ResultsList";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { VoiceTextArea } from "@/components/ui/VoiceTextArea";
import { useSettings } from "@/lib/hooks";
import { formatRelative } from "@/lib/utils";
import type {
  ResearchHistoryEntry,
  ResearchReport,
} from "@/lib/research/types";

const TIMEOUT_MS = 180_000;

export default function ResearchPage() {
  const { settings } = useSettings();
  const [topic, setTopic] = useState("");
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [recent, setRecent] = useState<ResearchHistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/research/history", { cache: "no-store" });
      const json = (await res.json()) as { entries?: ResearchHistoryEntry[] };
      setRecent((json.entries || []).slice(0, 8));
    } catch {
      /* history is optional */
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running]);

  const run = async () => {
    const q = topic.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    setElapsed(0);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: q }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json()) as ResearchReport & { error?: string };
      if (!res.ok) throw new Error(json.error || `Research failed (${res.status})`);
      setReport(json);
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Research"
        description="Type or speak a topic — Cortex deep-researches the web, YouTube, and GitHub and lists the top 50 sources"
        actions={
          <Link href="/research-center/history">
            <Button type="button" variant="secondary" size="sm">
              <History className="h-4 w-4" />
              History
            </Button>
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card>
          <CardBody className="space-y-4">
            <VoiceTextArea
              label="What do you want to research?"
              value={topic}
              onChange={setTopic}
              rows={4}
              speechMode={settings?.voiceInputMode ?? "auto"}
              placeholder="e.g. Open-source agents that generate short-form video from a script"
              hint="Voice = record then transcribe · or type normally."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="lg"
                disabled={running || !topic.trim()}
                onClick={() => void run()}
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {running ? "Researching…" : "Deep research"}
              </Button>
              {running ? (
                <span className="text-xs text-muted" aria-live="polite">
                  Searching the web, YouTube, and GitHub…
                  <span className="ml-1 tabular-nums text-sky-300">
                    {elapsed}s
                  </span>
                </span>
              ) : (
                <span className="text-xs text-muted">⌘/Ctrl + Enter</span>
              )}
            </div>
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          </CardBody>
        </Card>

        {report ? (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">
                Top {report.results.length} results
                <span className="ml-2 font-normal text-muted">
                  {report.counts.website} web · {report.counts.youtube} YouTube ·{" "}
                  {report.counts.github} GitHub
                </span>
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                {report.summary}
              </p>
            </div>
            <ResultsList results={report.results} />
            {report.notes.length ? (
              <p className="text-[11px] text-muted">{report.notes.join(" · ")}</p>
            ) : null}
          </section>
        ) : null}

        {recent.length ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Recent topics</h2>
              <Link
                href="/research-center/history"
                className="text-xs text-sky-300 hover:underline"
              >
                View all
              </Link>
            </div>
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/research-center/history/${entry.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/5"
                  >
                    <span className="min-w-0 truncate text-sm">{entry.topic}</span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {entry.resultCount} sources · {formatRelative(entry.researchedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
