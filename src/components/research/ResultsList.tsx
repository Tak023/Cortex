import { ExternalLink, FolderGit2, Globe, PlayCircle } from "lucide-react";
import type { ResearchKind, ResearchResult } from "@/lib/research/types";
import { cn } from "@/lib/utils";

const KIND: Record<
  ResearchKind,
  { label: string; className: string; Icon: typeof Globe }
> = {
  website: {
    label: "Web",
    className: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    Icon: Globe,
  },
  youtube: {
    label: "YouTube",
    className: "border-rose-400/30 bg-rose-500/10 text-rose-200",
    Icon: PlayCircle,
  },
  github: {
    label: "GitHub",
    className: "border-violet-400/30 bg-violet-500/10 text-violet-200",
    Icon: FolderGit2,
  },
};

export function ResultsList({ results }: { results: ResearchResult[] }) {
  if (!results.length) {
    return <p className="text-sm text-muted">No results.</p>;
  }
  return (
    <ol className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border">
      {results.map((r) => {
        const meta = KIND[r.kind];
        const Icon = meta.Icon;
        return (
          <li key={`${r.rank}-${r.url}`}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 px-4 py-3 hover:bg-white/5"
            >
              <span className="w-7 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-muted">
                {r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      meta.className,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                  {r.extra ? (
                    <span className="text-[11px] text-muted">{r.extra}</span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-start gap-1.5 text-sm font-medium text-sky-200">
                  <span className="min-w-0 flex-1 leading-snug">{r.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                  {r.snippet}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-muted/80">
                  {r.url}
                </p>
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
