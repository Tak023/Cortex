"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Network,
  RefreshCw,
  Search,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  VaultGraphCanvas,
  KIND_LEGEND,
  kindColor,
} from "@/components/vault/VaultGraphCanvas";
import type { GraphNode, VaultGraph } from "@/lib/vault/graph";
import type { VaultStatus } from "@/lib/vault/vault";

type GraphResponse = {
  vault: VaultStatus;
  graph: VaultGraph | null;
  graphify: { available: boolean; path: string };
};

type Layer = "graphify" | "wikilinks";

export default function GraphifyPage() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState<Layer>("graphify");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [focusedCommunity, setFocusedCommunity] = useState<number | null>(null);

  const load = useCallback(async (which: Layer) => {
    setLoading(true);
    try {
      const url =
        which === "wikilinks" ? "/api/vault/graph?source=wikilinks" : "/api/vault/graph";
      const res = await fetch(url);
      setData((await res.json()) as GraphResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(layer);
  }, [load, layer]);

  const graph = data?.graph ?? null;

  // Neighbors of the selected node, for the detail panel.
  const connections = useMemo(() => {
    if (!graph || !selected) return [];
    const labels = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => {
        const otherId = e.source === selected.id ? e.target : e.source;
        return { edge: e, other: labels.get(otherId) };
      })
      .filter((c): c is { edge: (typeof graph.edges)[number]; other: GraphNode } =>
        Boolean(c.other),
      )
      .sort((a, b) => b.other.degree - a.other.degree);
  }, [graph, selected]);

  const matches = useMemo(() => {
    if (!graph || !query.trim()) return 0;
    const needle = query.trim().toLowerCase();
    return graph.nodes.filter((n) => n.label.toLowerCase().includes(needle)).length;
  }, [graph, query]);

  const builtAt = graph?.stats.builtAt
    ? new Date(graph.stats.builtAt).toLocaleString()
    : null;

  return (
    <>
      <PageHeader
        title="Graphify"
        description="Graph view of the Obsidian vault — concepts, rationale, and how the notes connect"
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-panel-elevated/60 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLayer("graphify")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  layer === "graphify"
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Semantic
              </button>
              <button
                type="button"
                onClick={() => setLayer("wikilinks")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  layer === "wikilinks"
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Live links
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void load(layer)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Rescan
            </Button>
          </>
        }
      />

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* ── Left rail: stats, search, legend, communities ── */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium">
                  {graph?.source === "graphify" ? "Semantic graph" : "Live link graph"}
                </span>
              </div>
              {graph ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Nodes" value={graph.stats.nodeCount} />
                    <Stat label="Edges" value={graph.stats.edgeCount} />
                    <Stat label="Communities" value={graph.stats.communityCount} />
                    <Stat label="Notes" value={graph.stats.noteCount} />
                  </div>
                  <p className="text-[11px] leading-snug text-muted">
                    {graph.source === "graphify" ? (
                      <>
                        {Math.round(graph.stats.extractedRatio * 100)}% of edges are
                        EXTRACTED, the rest INFERRED (drawn dashed).
                        {builtAt ? ` Built ${builtAt}.` : ""}
                      </>
                    ) : (
                      <>
                        Derived from <code>[[wikilinks]]</code> and tags on every scan —
                        always current, structure only.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted">
                  {loading ? "Scanning vault…" : "Vault unavailable."}
                </p>
              )}
              {graph?.notice && (
                <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
                  {graph.notice}
                </p>
              )}
              {data?.vault?.dir && (
                <p className="truncate font-mono text-[10px] text-muted/70" title={data.vault.dir}>
                  {data.vault.dir}
                </p>
              )}
            </CardBody>
          </Card>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a concept…"
              className="w-full rounded-lg border border-border bg-panel-elevated/60 py-2 pl-9 pr-8 text-sm outline-none placeholder:text-muted/70 focus:border-blue-500/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {query && (
            <p className="-mt-1 px-1 text-[11px] text-muted">
              {matches} node{matches === 1 ? "" : "s"} match
            </p>
          )}

          <Card>
            <CardHeader>
              <span className="text-xs font-medium uppercase tracking-wider text-muted">
                Node type
              </span>
            </CardHeader>
            <CardBody className="space-y-1.5">
              {KIND_LEGEND.map((entry) => (
                <div key={entry.kind} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: entry.color }}
                  />
                  <span className="text-muted">{entry.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 text-[11px] text-muted/80">
                <span className="h-px w-5 shrink-0 border-t border-dashed border-muted" />
                Inferred edge
              </div>
            </CardBody>
          </Card>

          {graph && graph.communities.length > 0 && (
            <Card>
              <CardHeader>
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  Communities
                </span>
                {focusedCommunity !== null && (
                  <button
                    type="button"
                    onClick={() => setFocusedCommunity(null)}
                    className="text-[11px] text-accent hover:underline"
                  >
                    clear
                  </button>
                )}
              </CardHeader>
              <CardBody className="space-y-0.5">
                {graph.communities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setFocusedCommunity(focusedCommunity === c.id ? null : c.id)
                    }
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      focusedCommunity === c.id
                        ? "bg-accent-soft text-accent"
                        : "text-muted hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-[10px] text-muted/70">{c.size}</span>
                  </button>
                ))}
              </CardBody>
            </Card>
          )}

          {graph && graph.hyperedges.length > 0 && (
            <Card>
              <CardHeader>
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  Group relationships
                </span>
              </CardHeader>
              <CardBody className="space-y-2">
                {graph.hyperedges.map((h) => (
                  <div key={h.id} className="text-xs">
                    <p className="font-medium text-foreground/90">{h.label}</p>
                    <p className="text-[11px] text-muted">
                      {h.nodes.length} nodes · {h.relation.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Canvas ── */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border">
          {graph && graph.nodes.length > 0 ? (
            <VaultGraphCanvas
              graph={graph}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              query={query}
              focusedCommunity={focusedCommunity}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-sm space-y-2">
                <Waypoints className="mx-auto h-8 w-8 text-muted/50" />
                <p className="text-sm text-muted">
                  {loading
                    ? "Building graph…"
                    : data?.vault && !data.vault.enabled
                      ? "The second brain is turned off. Enable it in Settings to see the graph."
                      : data?.vault && !data.vault.available
                        ? "No vault found at the configured path."
                        : "No nodes to draw yet."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right rail: selection or top hubs ── */}
        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
          {selected ? (
            <Card>
              <CardHeader>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: kindColor(selected.kind) }}
                  />
                  <span className="truncate text-sm font-medium">{selected.label}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-muted hover:text-foreground"
                  aria-label="Close details"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="border-border bg-white/5 text-muted">
                    {selected.kind}
                  </Badge>
                  <Badge className="border-blue-500/25 bg-accent-soft text-accent">
                    {selected.communityName}
                  </Badge>
                  <Badge className="border-border bg-white/5 text-muted">
                    {selected.degree} link{selected.degree === 1 ? "" : "s"}
                  </Badge>
                </div>

                {selected.rationale && (
                  <p className="rounded-md border border-border-subtle bg-black/20 px-2.5 py-2 text-[12px] leading-snug text-muted">
                    {selected.rationale}
                  </p>
                )}

                {selected.file && (
                  <p className="truncate font-mono text-[10px] text-muted/80" title={selected.file}>
                    {selected.file}
                  </p>
                )}

                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                    Connections
                  </p>
                  <ul className="space-y-1">
                    {connections.map(({ edge, other }) => (
                      <li key={`${edge.source}-${edge.target}-${edge.relation}`}>
                        <button
                          type="button"
                          onClick={() => setSelected(other)}
                          className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-white/5"
                        >
                          <span
                            className="mt-1 h-2 w-2 shrink-0 rounded-full"
                            style={{ background: kindColor(other.kind) }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground/90">
                              {other.label}
                            </span>
                            <span className="block truncate text-[10px] text-muted">
                              {edge.relation.replace(/_/g, " ")}
                              {edge.confidence !== "EXTRACTED"
                                ? ` · inferred ${edge.confidenceScore.toFixed(2)}`
                                : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  Core abstractions
                </span>
              </CardHeader>
              <CardBody className="space-y-0.5">
                <p className="mb-2 text-[11px] leading-snug text-muted">
                  The most connected nodes — graphify calls these god nodes. Click one to
                  trace it.
                </p>
                {(graph?.nodes ?? []).slice(0, 12).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setSelected(n)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-muted hover:bg-white/5 hover:text-foreground"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: kindColor(n.kind) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    <span className="shrink-0 text-[10px] text-muted/70">{n.degree}</span>
                  </button>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-black/20 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
