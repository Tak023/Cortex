"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search, Video } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { VideoResearchReport } from "@/lib/video/research";

export default function VideoResearchPage() {
  const [report, setReport] = useState<VideoResearchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRunning(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        refresh
          ? "/api/video-generator/research?refresh=1"
          : "/api/video-generator/research",
        {
          method: refresh ? "POST" : "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(refresh ? 180_000 : 20_000),
        },
      );
      const json = (await res.json()) as VideoResearchReport & {
        error?: string;
      };
      if (!res.ok && !json.types?.length) {
        throw new Error(json.error || `Research failed (${res.status})`);
      }
      if (json.types?.length) setReport(json);
      if (json.error) setError(json.error);
      if (!refresh && !json.types?.length && !json.error) {
        setLoading(false);
        await load(true);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setLoading(false);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Research"
        description="YouTube researcher — top 10 trending / viral video types that can be generated with AI, ranked by views"
        actions={
          <Button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || running}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {running ? "Researching YouTube…" : "Run research"}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-violet-400/30 bg-violet-500/10">
                <Search className="h-4 w-4 text-violet-300" />
              </span>
              <div>
                <div className="text-sm font-medium">
                  {report?.researcher || "Cortex researcher"}
                </div>
                <p className="mt-0.5 max-w-2xl text-xs text-muted">
                  Searches YouTube for formats you can actually generate
                  (Sora, Veo, Kling, Ghibli I2V, UGC avatars, morph effects).
                  Types are ranked by the highest verified example view count.
                </p>
              </div>
            </div>
            {report ? (
              <div className="text-right text-[11px] text-muted">
                <div>
                  {new Date(report.researchedAt).toLocaleString()}
                </div>
                <div className="mt-0.5 capitalize">{report.source}</div>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {error ? (
          <p className="text-sm text-amber-300/90">{error}</p>
        ) : null}

        {loading && !report ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading last research…
          </div>
        ) : null}

        {!loading && !report && !error ? (
          <Card>
            <CardBody className="space-y-3 py-10 text-center">
              <Video className="mx-auto h-8 w-8 text-muted" />
              <p className="text-sm text-muted">
                No research yet. Run the YouTube researcher to rank the top
                10 AI-generatable viral formats.
              </p>
              <Button type="button" onClick={() => void load(true)}>
                Run research
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {report?.types.map((t) => (
          <Card key={t.slug}>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sm font-semibold tabular-nums text-sky-300">
                  {t.rank}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{t.name}</h2>
                  <p className="text-[11px] text-muted">
                    Peak example · {t.viewsLabel} views
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums tracking-tight">
                  {t.viewsLabel}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  views
                </div>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-foreground/90">{t.description}</p>
              <p className="text-xs text-muted">{t.whyAiGeneratable}</p>
              <div className="flex flex-wrap gap-1.5">
                {t.tools.map((tool) => (
                  <Badge
                    key={tool}
                    className="border-violet-400/25 bg-violet-500/10 text-violet-200"
                  >
                    {tool}
                  </Badge>
                ))}
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  YouTube examples
                </div>
                {t.examples.length ? (
                  <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                    {t.examples.map((ex) => (
                      <li key={ex.videoId}>
                        <a
                          href={ex.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex items-start justify-between gap-3 px-3 py-2.5",
                            "hover:bg-white/5",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-sky-200">
                              <span className="truncate">{ex.title}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted">
                              {ex.channel}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold tabular-nums">
                              {ex.viewsLabel}
                            </div>
                            <div className="text-[10px] text-muted">views</div>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">
                    No YouTube examples resolved for this type.
                  </p>
                )}
              </div>
            </CardBody>
          </Card>
        ))}

        {report?.notes?.length ? (
          <p className="text-[11px] leading-relaxed text-muted">
            {report.notes.join(" · ")}
          </p>
        ) : null}
      </div>
    </>
  );
}
