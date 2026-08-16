"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ModeBadge, ReportBody } from "@/components/research/ReportBody";
import { ResultsList } from "@/components/research/ResultsList";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { ResearchReport } from "@/lib/research/types";

export default function ResearchHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/research/history/${id}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ResearchReport & { error?: string };
        if (!res.ok) throw new Error(json.error || "Not found");
        if (!cancelled) setReport(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Not found");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <>
      <PageHeader
        title={report?.topic || "Research"}
        description={
          report
            ? `${report.mode === "quick" ? "Quick Research" : report.mode === "deep" ? "Deep Report" : "Research"} · ${report.results.length} sources · ${new Date(report.researchedAt).toLocaleString()}`
            : "Loading saved research…"
        }
        actions={
          <Link href="/research-center/history">
            <Button type="button" variant="secondary" size="sm">
              <ArrowLeft className="h-4 w-4" />
              History
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {!report && !error ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        {report ? (
          <>
            {report.report ? (
              <Card>
                <CardHeader>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      {report.mode === "quick" ? "Briefing" : "Report"}
                    </h2>
                    <ModeBadge mode={report.mode} />
                  </div>
                  {report.engines?.length ? (
                    <span className="text-[11px] text-muted">
                      {report.engines.join(" · ")}
                    </span>
                  ) : null}
                </CardHeader>
                <CardBody>
                  <ReportBody markdown={report.report} />
                </CardBody>
              </Card>
            ) : (
              <p className="text-sm leading-relaxed text-foreground/90">
                {report.summary}
              </p>
            )}
            <ResultsList results={report.results} />
            {report.notes.length ? (
              <p className="text-[11px] text-muted">{report.notes.join(" · ")}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
