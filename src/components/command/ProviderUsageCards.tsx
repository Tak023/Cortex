"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type ProviderCard = {
  id: string;
  label: string;
  creditsAvailable: number | null;
  creditsAvailableLabel: string;
  spentThisMonth: number | null;
  spentThisMonthLabel: string;
  tokensThisMonth: number | null;
  tokensThisMonthLabel: string;
  source: string;
  detail?: string;
  consoleUrl?: string;
  configured: boolean;
};

const ACCENT: Record<string, string> = {
  claude: "from-orange-500/15 via-panel to-amber-500/10 border-orange-400/30",
  grok: "from-sky-500/15 via-panel to-violet-500/10 border-sky-400/30",
  hermes: "from-emerald-500/15 via-panel to-teal-500/10 border-emerald-400/30",
};

const DOT: Record<string, string> = {
  claude: "bg-orange-400",
  grok: "bg-sky-400",
  hermes: "bg-emerald-400",
};

export function ProviderUsageCards({ className }: { className?: string }) {
  const [cards, setCards] = useState<ProviderCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const ctrl = new AbortController();
      const kill = window.setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`/api/providers/usage${q}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      window.clearTimeout(kill);
      // Older desktop builds may not ship this route yet — don't blank the UI
      if (res.status === 404) {
        setError(
          "Provider credits API missing — rebuild/reinstall Cortex to enable Claude · Grok · Hermes cards.",
        );
        setCards([]);
        return;
      }
      const json = (await res.json()) as {
        providers?: ProviderCard[];
        error?: string;
        fetchedAt?: string;
      };
      if (!res.ok && !(json.providers && json.providers.length)) {
        throw new Error(json.error || `Usage failed (${res.status})`);
      }
      setCards(json.providers || []);
      setFetchedAt(json.fetchedAt || null);
      if (json.error) setError(json.error);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "Provider usage timed out — retry shortly"
            : e.message
          : "Could not load provider usage";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">
            Provider credits
          </h2>
          <p className="text-[11px] text-muted">
            Claude · Grok · Hermes — tokens & spend this month
            {fetchedAt ? (
              <span className="text-muted/70">
                {" "}
                · {new Date(fetchedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          aria-label="Refresh provider usage"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-amber-300/90">{error}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {(loading && !cards.length
          ? (["claude", "grok", "hermes"] as const).map(
              (id): ProviderCard => ({
                id,
                label:
                  id === "claude" ? "Claude" : id === "grok" ? "Grok" : "Hermes",
                creditsAvailableLabel: "—",
                spentThisMonthLabel: "—",
                tokensThisMonthLabel: "—",
                source: "local",
                configured: false,
                creditsAvailable: null,
                spentThisMonth: null,
                tokensThisMonth: null,
                detail: undefined,
                consoleUrl: undefined,
              }),
            )
          : cards
        ).map((p) => (
          <Card
            key={p.id}
            className={cn(
              "overflow-hidden border bg-gradient-to-br",
              ACCENT[p.id] || "border-border",
            )}
          >
            <CardBody className="space-y-3 !py-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      DOT[p.id] || "bg-muted",
                    )}
                  />
                  <span className="text-sm font-semibold tracking-tight">
                    {p.label}
                  </span>
                </div>
                {loading && !cards.length ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                ) : p.consoleUrl ? (
                  <a
                    href={p.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-sky-300"
                    title="Open provider console"
                  >
                    Console
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Local
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    Credits
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
                    {p.creditsAvailableLabel}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    Spent / mo
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
                    {p.spentThisMonthLabel}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    Tokens
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
                    {p.tokensThisMonthLabel}
                  </div>
                </div>
              </div>

              {p.detail ? (
                <p className="line-clamp-2 text-[10px] leading-relaxed text-muted">
                  {p.detail}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
