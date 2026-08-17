"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { CourseUnit } from "@/lib/learning/types";

export function CourseOutline({
  units,
  lessonUrl,
  initiallyOpen,
}: {
  units: CourseUnit[];
  lessonUrl: (slug: string) => string;
  initiallyOpen?: string;
}) {
  const [openId, setOpenId] = useState(initiallyOpen ?? units[0]?.id ?? "");

  return (
    <div className="space-y-3">
      {units.map((unit) => {
        const open = openId === unit.id;
        const start = lessonUrl(unit.lessons[0]?.slug || "");
        return (
          <Card key={unit.id}>
            <CardHeader>
              <button
                type="button"
                onClick={() => setOpenId(open ? "" : unit.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted transition-transform",
                    open && "rotate-180",
                  )}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                      {unit.label}
                    </span>
                    <span className="text-sm font-semibold">{unit.title}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {unit.description} · {unit.lessons.length}{" "}
                    {unit.lessons.length === 1 ? "item" : "items"}
                  </p>
                </div>
              </button>
              <a href={start} target="_blank" rel="noopener noreferrer">
                <Button type="button" variant="secondary" size="sm">
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            </CardHeader>
            {open ? (
              <CardBody className="pt-0">
                <ol className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border">
                  {unit.lessons.map((lesson, i) => (
                    <li key={lesson.slug}>
                      <a
                        href={lessonUrl(lesson.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/5"
                      >
                        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{lesson.title}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted" />
                      </a>
                    </li>
                  ))}
                </ol>
              </CardBody>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
