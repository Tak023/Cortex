"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import type { Concept } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function ConceptCard({
  concept,
  selected,
  onSelect,
  onLaunch,
  launching,
}: {
  concept: Concept;
  selected?: boolean;
  onSelect?: () => void;
  onLaunch?: () => void;
  launching?: boolean;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-blue-500/40",
        selected && "border-blue-500/50 ring-1 ring-blue-500/30",
      )}
      onClick={onSelect}
    >
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-snug">{concept.title}</h3>
          <Badge className="shrink-0 border-violet-500/30 bg-violet-500/10 text-violet-300">
            <Sparkles className="h-3 w-3" />
            {concept.score}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted">{concept.summary}</p>
        <ul className="space-y-1">
          {concept.features.slice(0, 4).map((f) => (
            <li key={f} className="flex gap-2 text-xs text-foreground/80">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {f}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1">
          {concept.stack.map((s) => (
            <Badge
              key={s}
              className="border-border bg-panel-elevated text-muted"
            >
              {s}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1 text-xs text-muted">
          <span>
            {concept.difficulty} · {concept.estimatedEffort}
          </span>
          <span className="truncate max-w-[50%]">
            via {concept.agentsUsed.join(", ")}
          </span>
        </div>
        {onLaunch && (
          <Button
            className="w-full"
            size="sm"
            disabled={launching}
            onClick={(e) => {
              e.stopPropagation();
              onLaunch();
            }}
          >
            {launching ? "Launching pipeline…" : "Select & execute"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
