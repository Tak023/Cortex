"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Globe,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Server,
  Smartphone,
  Sparkles,
  Terminal,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConceptCard } from "@/components/ideas/ConceptCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { VoiceTextArea } from "@/components/ui/VoiceTextArea";
import { useIdeas, useSettings, useTemplates } from "@/lib/hooks";
import type { Concept, Idea } from "@/lib/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  globe: Globe,
  terminal: Terminal,
  "layout-dashboard": LayoutDashboard,
  server: Server,
  bot: Bot,
  smartphone: Smartphone,
};

export default function IdeasPage() {
  const router = useRouter();
  const templates = useTemplates();
  const { settings } = useSettings();
  const { ideas, generate, launchProject } = useIdeas();
  const [statement, setStatement] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    idea: Idea;
    concepts: Concept[];
    team: string[];
    mode: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Tick a visible clock while Grok works. setState lives in the interval
  // callback, not the effect body, so this stays off the cascading-render path.
  useEffect(() => {
    if (!generating) return;
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [generating]);

  const onGenerate = async () => {
    if (!statement.trim()) return;
    setGenerating(true);
    setError(null);
    setElapsed(0);
    try {
      const data = await generate(statement.trim(), templateId);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const onLaunch = async (conceptId: string) => {
    if (!result) return;
    setLaunchingId(conceptId);
    try {
      const project = await launchProject(result.idea.id, conceptId);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
      setLaunchingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Ideas"
        description="Capture a rough idea — agents brainstorm concrete concepts, then run the full pipeline"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card>
          <CardBody className="space-y-4">
            <VoiceTextArea
              label="Problem / idea"
              value={statement}
              onChange={setStatement}
              rows={5}
              speechMode={settings?.voiceInputMode ?? "auto"}
              placeholder="Type or speak your idea… e.g. An app that finds and views all Docker containers on my machine with start/stop and logs."
              hint="Tip: Voice = record then transcribe · Dictation app = Whisperflow / macOS Dictation (Settings for default)."
            />

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted">
                Template library
              </label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => {
                  const Icon = ICONS[t.icon] || Lightbulb;
                  const active = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setTemplateId(active ? null : t.id)
                      }
                      className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? "border-blue-500/50 bg-accent-soft"
                          : "border-border bg-panel-elevated/50 hover:border-border hover:bg-panel-elevated"
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <div>
                        <div className="text-sm font-medium">{t.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {t.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                disabled={generating || !statement.trim()}
                onClick={onGenerate}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Routing to agents…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Concepts
                  </>
                )}
              </Button>
              {/* A silent 45s spinner is indistinguishable from a hang — show
                  the clock and say what it is waiting on. */}
              {generating && (
                <span className="text-xs text-muted" aria-live="polite">
                  Grok is drafting 10 concepts — typically 40–60s.{" "}
                  <span className="tabular-nums text-sky-300">{elapsed}s</span>
                  {elapsed >= 75 && " · almost at the limit, will fall back to local synthesis"}
                </span>
              )}
              {!generating && result && (
                <span className="text-xs text-muted">
                  Team: {result.team.join(", ")} · mode: {result.mode}
                </span>
              )}
            </div>
            {error && (
              <p className="text-sm text-rose-400">{error}</p>
            )}
          </CardBody>
        </Card>

        {result && result.concepts.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium">
              Concepts{" "}
              <span className="text-muted font-normal">
                — pick one to launch the multi-agent pipeline
              </span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {result.concepts.map((c) => (
                <ConceptCard
                  key={c.id}
                  concept={c}
                  onLaunch={() => onLaunch(c.id)}
                  launching={launchingId === c.id}
                />
              ))}
            </div>
          </section>
        )}

        {ideas.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Recent ideas
            </h2>
            <div className="space-y-2">
              {ideas.slice(0, 8).map((idea) => (
                <div
                  key={idea.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel/60 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{idea.statement}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {idea.status} · {idea.concepts.length} concepts
                      {idea.projectId ? " · project linked" : ""}
                    </p>
                  </div>
                  {idea.projectId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => router.push(`/projects/${idea.projectId}`)}
                    >
                      Open project
                    </Button>
                  )}
                  {!idea.projectId && idea.concepts.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setStatement(idea.statement);
                        setResult({
                          idea,
                          concepts: idea.concepts,
                          team: idea.concepts[0]?.agentsUsed ?? [],
                          mode: "cached",
                        });
                      }}
                    >
                      View concepts
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
