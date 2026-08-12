/**
 * Force-directed canvas view for the second-brain knowledge graph.
 *
 * Deliberately plain TypeScript rather than React state: the simulation mutates
 * hundreds of bodies 60 times a second, which is exactly the kind of churn the
 * React compiler's immutability rules (rightly) forbid inside hooks. The React
 * component owns nothing but the canvas element and this object's lifetime.
 *
 * Encoding, per the data-viz rules:
 * - **Hue = node kind** (concept / rationale / document) — three categorical
 *   slots validated for all-pairs CVD and normal-vision separation on this
 *   surface. Community is deliberately NOT a hue: eight hues cannot clear those
 *   floors, and a force layout already separates communities spatially. They
 *   are named on-canvas at each cluster centroid instead.
 * - **Size = degree**, so graphify's "god nodes" read as the largest marks.
 * - **Dashed edge = INFERRED**, so confidence is never carried by color alone.
 */
import type { GraphNode, VaultGraph } from "@/lib/vault/graph";

export const SURFACE = "#0a0e17";

/** Validated categorical slots (dark, surface #0a0e17): blue / orange / aqua. */
const KIND_COLORS: Record<string, string> = {
  concept: "#3987e5",
  note: "#3987e5",
  rationale: "#d95926",
  document: "#199e70",
  paper: "#199e70",
  code: "#199e70",
  image: "#199e70",
  tag: "#199e70",
};
const KIND_FALLBACK = "#8b95a8";

export const KIND_LEGEND: Array<{ kind: string; label: string; color: string }> = [
  { kind: "concept", label: "Concept", color: KIND_COLORS.concept },
  { kind: "rationale", label: "Rationale (why)", color: KIND_COLORS.rationale },
  { kind: "document", label: "Document", color: KIND_COLORS.document },
];

export function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? KIND_FALLBACK;
}

export interface ViewState {
  selectedId: string | null;
  query: string;
  focusedCommunity: number | null;
}

interface Body {
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Held in place while dragged. */
  fixed: boolean;
}

interface Link {
  a: Body;
  b: Body;
  inferred: boolean;
}

// Simulation constants.
const REPULSION = 2600;
const SPRING = 0.012;
const REST = 78;
const CENTER = 0.0016;
const COMMUNITY = 0.008;
const DAMPING = 0.86;
const ALPHA_DECAY = 0.985;
const ALPHA_FLOOR = 0.002;

/** Stable pseudo-random in [0,1) from a string — same layout on every reload. */
function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function radiusFor(degree: number): number {
  return 4 + Math.sqrt(degree) * 2.4;
}

export class GraphView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onSelect: (node: GraphNode | null) => void;

  private bodies: Body[] = [];
  private links: Link[] = [];
  private neighbors = new Map<string, Set<string>>();

  private view = { scale: 1, tx: 0, ty: 0 };
  private alpha = 1;
  private fitted = false;
  private frame: number | null = null;

  private hover: Body | null = null;
  private drag: { body: Body | null; panning: boolean; x: number; y: number } = {
    body: null,
    panning: false,
    x: 0,
    y: 0,
  };

  private state: ViewState = { selectedId: null, query: "", focusedCommunity: null };

  constructor(
    canvas: HTMLCanvasElement,
    graph: VaultGraph,
    onSelect: (node: GraphNode | null) => void,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.onSelect = onSelect;

    this.build(graph);
    this.attach();
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  setState(next: ViewState) {
    this.state = next;
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.detach();
  }

  private build(graph: VaultGraph) {
    this.bodies = graph.nodes.map((node) => {
      // Seed each community on its own ring so clusters resolve quickly.
      const angle = seeded(node.id, 1) * Math.PI * 2;
      const ring = 120 + (node.community % 8) * 90;
      return {
        node,
        x: Math.cos(angle) * ring + (seeded(node.id, 2) - 0.5) * 60,
        y: Math.sin(angle) * ring + (seeded(node.id, 3) - 0.5) * 60,
        vx: 0,
        vy: 0,
        r: radiusFor(node.degree),
        fixed: false,
      };
    });

    const byId = new Map(this.bodies.map((b) => [b.node.id, b]));
    this.links = [];
    this.neighbors = new Map();
    for (const edge of graph.edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b) continue;
      this.links.push({ a, b, inferred: edge.confidence !== "EXTRACTED" });
      if (!this.neighbors.has(edge.source)) this.neighbors.set(edge.source, new Set());
      if (!this.neighbors.has(edge.target)) this.neighbors.set(edge.target, new Set());
      this.neighbors.get(edge.source)!.add(edge.target);
      this.neighbors.get(edge.target)!.add(edge.source);
    }
  }

  private loop() {
    this.tick();
    if (!this.fitted && this.alpha < 0.35) {
      this.fit();
      this.fitted = true;
    }
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  }

  // ── simulation ────────────────────────────────────────────────────────────

  private tick() {
    const { bodies, links, alpha } = this;
    if (!bodies.length || alpha < ALPHA_FLOOR) return;

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Coincident nodes get a deterministic nudge instead of NaN forces.
          dx = seeded(a.node.id, 7) - 0.5;
          dy = seeded(b.node.id, 11) - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = (REPULSION * alpha) / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const { a, b } of links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - REST) * SPRING * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    const centroids = this.centroids();
    for (const b of bodies) {
      const c = centroids.get(b.node.community)!;
      b.vx += (c.x - b.x) * COMMUNITY * alpha;
      b.vy += (c.y - b.y) * COMMUNITY * alpha;
      b.vx += -b.x * CENTER * alpha;
      b.vy += -b.y * CENTER * alpha;
    }

    for (const b of bodies) {
      if (b.fixed) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      b.vx *= DAMPING;
      b.vy *= DAMPING;
      b.x += Math.max(-30, Math.min(b.vx, 30));
      b.y += Math.max(-30, Math.min(b.vy, 30));
    }

    this.alpha = alpha * ALPHA_DECAY;
  }

  /** Mean position and name of every community, keyed by community id. */
  private centroids() {
    const sums = new Map<number, { x: number; y: number; n: number; name: string }>();
    for (const b of this.bodies) {
      const c = sums.get(b.node.community);
      if (c) {
        c.x += b.x;
        c.y += b.y;
        c.n++;
      } else {
        sums.set(b.node.community, {
          x: b.x,
          y: b.y,
          n: 1,
          name: b.node.communityName,
        });
      }
    }
    const out = new Map<number, { x: number; y: number; n: number; name: string }>();
    for (const [id, c] of sums) {
      out.set(id, { x: c.x / c.n, y: c.y / c.n, n: c.n, name: c.name });
    }
    return out;
  }

  /** Frame the whole graph in the viewport. */
  fit() {
    const { canvas, bodies } = this;
    if (!bodies.length) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of bodies) {
      minX = Math.min(minX, b.x - b.r);
      maxX = Math.max(maxX, b.x + b.r);
      minY = Math.min(minY, b.y - b.r);
      maxY = Math.max(maxY, b.y + b.r);
    }
    const pad = 56;
    const scale = Math.max(
      0.15,
      Math.min(
        (w - pad * 2) / Math.max(maxX - minX, 1),
        (h - pad * 2) / Math.max(maxY - minY, 1),
        2.5,
      ),
    );
    this.view = {
      scale,
      tx: w / 2 - ((minX + maxX) / 2) * scale,
      ty: h / 2 - ((minY + maxY) / 2) * scale,
    };
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private draw() {
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, w, h);

    const { scale, tx, ty } = this.view;
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const { selectedId, query, focusedCommunity } = this.state;
    const needle = query.trim().toLowerCase();
    const active = this.hover?.node.id ?? selectedId;
    const activeSet = active
      ? new Set<string>([active, ...(this.neighbors.get(active) ?? [])])
      : null;

    const dimmed = (node: GraphNode) => {
      if (focusedCommunity !== null && node.community !== focusedCommunity) return true;
      if (activeSet && !activeSet.has(node.id)) return true;
      if (needle && !node.label.toLowerCase().includes(needle)) return true;
      return false;
    };

    // Edges.
    ctx.lineWidth = 1 / scale;
    for (const link of this.links) {
      const faded = dimmed(link.a.node) || dimmed(link.b.node);
      const highlighted =
        !!activeSet && activeSet.has(link.a.node.id) && activeSet.has(link.b.node.id);
      ctx.strokeStyle = highlighted
        ? "rgba(91,140,255,0.55)"
        : faded
          ? "rgba(139,149,168,0.06)"
          : "rgba(139,149,168,0.22)";
      ctx.setLineDash(link.inferred ? [4 / scale, 3 / scale] : []);
      ctx.beginPath();
      ctx.moveTo(link.a.x, link.a.y);
      ctx.lineTo(link.b.x, link.b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Community names at cluster centroids — identity without an eighth hue.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(11, 13 / scale)}px ui-sans-serif, system-ui, sans-serif`;
    for (const [id, c] of this.centroids()) {
      if (c.n < 2) continue;
      ctx.fillStyle =
        focusedCommunity !== null && focusedCommunity !== id
          ? "rgba(139,149,168,0.18)"
          : "rgba(232,236,244,0.42)";
      ctx.fillText(c.name.toUpperCase(), c.x, c.y - 6);
    }

    // Nodes.
    for (const b of this.bodies) {
      const faded = dimmed(b.node);
      ctx.globalAlpha = faded ? 0.18 : 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = kindColor(b.node.kind);
      ctx.fill();
      // 2px surface ring keeps overlapping marks separable.
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = SURFACE;
      ctx.stroke();
      if (b.node.id === active || b.node.id === selectedId) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = "#e8ecf4";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 3 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Selective direct labels: hubs, search matches, and the active node.
    ctx.textBaseline = "top";
    ctx.font = `${Math.max(10, 11 / scale)}px ui-sans-serif, system-ui, sans-serif`;
    const labelFloor = scale > 1.4 ? 1 : scale > 0.8 ? 4 : 7;
    for (const b of this.bodies) {
      const matched = !!needle && b.node.label.toLowerCase().includes(needle);
      const show =
        b.node.id === active || matched || (!dimmed(b.node) && b.node.degree >= labelFloor);
      if (!show) continue;
      const y = b.y + b.r + 3 / scale;
      ctx.globalAlpha = b.node.id === active || matched ? 1 : 0.72;
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "rgba(10,14,23,0.9)";
      ctx.strokeText(b.node.label, b.x, y);
      ctx.fillStyle = "#e8ecf4";
      ctx.fillText(b.node.label, b.x, y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── interaction ───────────────────────────────────────────────────────────

  private attach() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("dblclick", this.onDoubleClick);
  }

  private detach() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("dblclick", this.onDoubleClick);
  }

  private toGraphCoords(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const { scale, tx, ty } = this.view;
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    };
  }

  private bodyAt(clientX: number, clientY: number): Body | null {
    const { x, y } = this.toGraphCoords(clientX, clientY);
    const { scale } = this.view;
    let hit: Body | null = null;
    // Iterate in draw order and keep the last (topmost) match.
    for (const b of this.bodies) {
      const dx = b.x - x;
      const dy = b.y - y;
      // Hit target is larger than the mark, per the interaction rules.
      const r = b.r + 6 / scale;
      if (dx * dx + dy * dy <= r * r) hit = b;
    }
    return hit;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const body = this.bodyAt(e.clientX, e.clientY);
    this.drag = { body, panning: !body, x: e.clientX, y: e.clientY };
    if (body) {
      body.fixed = true;
      this.onSelect(body.node);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (drag.body) {
      const { x, y } = this.toGraphCoords(e.clientX, e.clientY);
      drag.body.x = x;
      drag.body.y = y;
      this.alpha = Math.max(this.alpha, 0.12);
      return;
    }
    if (drag.panning) {
      this.view.tx += e.clientX - drag.x;
      this.view.ty += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    this.hover = this.bodyAt(e.clientX, e.clientY);
    this.canvas.style.cursor = this.hover ? "pointer" : "grab";
  };

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.drag;
    if (drag.body) drag.body.fixed = false;
    // A background press that never moved is a deselect.
    if (
      drag.panning &&
      Math.abs(e.clientX - drag.x) < 3 &&
      Math.abs(e.clientY - drag.y) < 3
    ) {
      this.onSelect(null);
    }
    this.drag = { body: null, panning: false, x: 0, y: 0 };
  };

  private onPointerLeave = () => {
    this.hover = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const next = Math.max(
      0.15,
      Math.min(this.view.scale * Math.exp(-e.deltaY * 0.0016), 4),
    );
    const applied = next / this.view.scale;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    this.view.tx = px - (px - this.view.tx) * applied;
    this.view.ty = py - (py - this.view.ty) * applied;
    this.view.scale = next;
  };

  private onDoubleClick = () => {
    this.fit();
  };
}
