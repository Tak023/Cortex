import type { ReactNode } from "react";
import type { ResearchMode } from "@/lib/research/types";
import { cn } from "@/lib/utils";

export function ModeBadge({ mode }: { mode?: ResearchMode }) {
  if (!mode) return null;
  const deep = mode === "deep";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        deep
          ? "border-violet-400/30 bg-violet-500/10 text-violet-200"
          : "border-amber-400/30 bg-amber-500/10 text-amber-200",
      )}
    >
      {deep ? "Deep Report" : "Quick Research"}
    </span>
  );
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2]) {
      nodes.push(
        <strong key={`b-${i++}`} className="font-semibold text-foreground">
          {m[2]}
        </strong>,
      );
    } else if (m[3]) {
      nodes.push(
        <code
          key={`c-${i++}`}
          className="rounded bg-black/40 px-1 py-0.5 font-mono text-[12px] text-sky-200"
        >
          {m[3]}
        </code>,
      );
    } else if (m[4] && m[5]) {
      nodes.push(
        <a
          key={`a-${i++}`}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-300 underline-offset-2 hover:underline"
        >
          {m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ReportBody({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`pre-${k++}`}
          className="overflow-x-auto rounded-lg border border-border-subtle bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-sky-100"
        >
          {lang ? (
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted">
              {lang}
            </div>
          ) : null}
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "text-base font-semibold"
          : level === 2
            ? "text-sm font-semibold"
            : "text-sm font-medium text-foreground/90";
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as
        | "h3"
        | "h4"
        | "h5";
      blocks.push(
        <Tag key={`h-${k++}`} className={cn("mt-3 first:mt-0", cls)}>
          {renderInline(heading[2])}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${k++}`} className="border-border-subtle" />);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`l-${k++}`}
          className={cn(
            "space-y-1 text-sm leading-relaxed text-foreground/90",
            ordered ? "list-decimal pl-5" : "list-disc pl-5",
          )}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p
        key={`p-${k++}`}
        className="text-sm leading-relaxed text-foreground/90"
      >
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
