"use client";

import { useEffect, useRef } from "react";
import type { GraphNode, VaultGraph } from "@/lib/vault/graph";
import { GraphView, SURFACE } from "./graphView";

export { KIND_LEGEND, kindColor } from "./graphView";

/**
 * Thin React wrapper around {@link GraphView}. The component owns the canvas
 * element and the view's lifetime; the simulation itself lives outside React so
 * its per-frame mutation never touches reactive state.
 */
export function VaultGraphCanvas({
  graph,
  selectedId,
  onSelect,
  query,
  focusedCommunity,
}: {
  graph: VaultGraph;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  query: string;
  focusedCommunity: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Rebuild the simulation only when the graph itself changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = new GraphView(canvas, graph, (node) => onSelectRef.current(node));
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    viewRef.current?.setState({ selectedId, query, focusedCommunity });
  }, [selectedId, query, focusedCommunity]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none rounded-xl"
        style={{ cursor: "grab", background: SURFACE }}
      />
      {graph.nodes.length > 1200 && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 text-[10px] text-amber-300">
          {graph.nodes.length} nodes — layout may take a moment
        </p>
      )}
      <p className="pointer-events-none absolute bottom-3 left-3 text-[10px] text-muted/70">
        Drag to pan · scroll to zoom · double-click to fit
      </p>
    </div>
  );
}
