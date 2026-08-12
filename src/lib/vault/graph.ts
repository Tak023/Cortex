/**
 * Knowledge graph over the second brain (Obsidian vault).
 *
 * Two layers, in priority order:
 *
 * 1. **graphify** — `<vault>/graphify-out/graph.json`, built by the graphify
 *    pipeline. Semantic: concepts and rationale extracted from note *content*,
 *    with Louvain communities, confidence-scored edges, and hyperedges. Rich,
 *    but a point-in-time snapshot — it is only as fresh as the last build.
 *
 * 2. **wikilinks** — derived live from the vault's Markdown on every request.
 *    Structural only (`[[links]]`, `#tags`, folders), but always current and
 *    needs no Python, no LLM, and no build step. Used when graphify has not
 *    been run yet, or when the caller explicitly asks for the live view.
 *
 * Both layers normalize to the same {@link VaultGraph} shape so the UI renders
 * them identically and only has to label which source it is looking at.
 */
import fs from "fs";
import path from "path";
import { getVaultDir, isVaultEnabled } from "./vault";

export type GraphSource = "graphify" | "wikilinks";

export interface GraphNode {
  id: string;
  label: string;
  /** graphify file_type, or "note" | "tag" for the wikilink layer. */
  kind: string;
  /** Vault-relative path of the note this node came from. */
  file: string | null;
  community: number;
  communityName: string;
  /** Edge count — drives node size and the "god node" ranking. */
  degree: number;
  /** graphify's `rationale` attribute: why a decision/principle exists. */
  rationale?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  /** EXTRACTED | INFERRED | AMBIGUOUS (wikilink layer is always EXTRACTED). */
  confidence: string;
  confidenceScore: number;
}

export interface GraphHyperedge {
  id: string;
  label: string;
  nodes: string[];
  relation: string;
}

export interface VaultGraph {
  source: GraphSource;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hyperedges: GraphHyperedge[];
  communities: Array<{ id: number; name: string; size: number }>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
    noteCount: number;
    /** ISO timestamp of the graphify build; null for the live layer. */
    builtAt: string | null;
    /** Share of edges that are EXTRACTED rather than INFERRED. */
    extractedRatio: number;
  };
  /** Set when graphify output is missing or unreadable, so the UI can say why. */
  notice?: string;
}

const GRAPHIFY_DIR = "graphify-out";
const GRAPH_FILE = "graph.json";
/** graph.json is generated, but it is still user-controlled input — cap the read. */
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 6;
const MAX_NOTES = 2000;

export function graphifyGraphPath(): string {
  return path.join(getVaultDir(), GRAPHIFY_DIR, GRAPH_FILE);
}

export function hasGraphifyGraph(): boolean {
  try {
    return fs.statSync(graphifyGraphPath()).isFile();
  } catch {
    return false;
  }
}

// ── graphify layer ──────────────────────────────────────────────────────────

/** NetworkX node_link_data as written by graphify's `to_json`. */
interface GraphifyJson {
  nodes?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  hyperedges?: Array<Record<string, unknown>>;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function readGraphifyGraph(): VaultGraph | null {
  const file = graphifyGraphPath();
  let raw: string;
  let builtAt: string | null = null;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_GRAPH_BYTES) return null;
    builtAt = stat.mtime.toISOString();
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  let data: GraphifyJson;
  try {
    data = JSON.parse(raw) as GraphifyJson;
  } catch {
    return null;
  }
  if (!Array.isArray(data.nodes) || !data.nodes.length) return null;

  const nodes = new Map<string, GraphNode>();
  for (const entry of data.nodes) {
    const id = str(entry.id);
    if (!id) continue;
    const community = typeof entry.community === "number" ? entry.community : -1;
    const node: GraphNode = {
      id,
      label: str(entry.label, id),
      kind: str(entry.file_type, "concept"),
      file: str(entry.source_file) || str(entry.source_location) || null,
      community,
      communityName: str(entry.community_name, `Community ${community}`),
      degree: 0,
    };
    const rationale = str(entry.rationale);
    if (rationale) node.rationale = rationale;
    nodes.set(id, node);
  }

  const edges: GraphEdge[] = [];
  for (const entry of data.links ?? []) {
    const source = str(entry.source);
    const target = str(entry.target);
    // Drop dangling endpoints — graphify tolerates them, a renderer cannot.
    if (!nodes.has(source) || !nodes.has(target)) continue;
    edges.push({
      source,
      target,
      relation: str(entry.relation, "related_to"),
      confidence: str(entry.confidence, "EXTRACTED"),
      confidenceScore:
        typeof entry.confidence_score === "number" ? entry.confidence_score : 1,
    });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  }

  const hyperedges: GraphHyperedge[] = [];
  for (const entry of data.hyperedges ?? []) {
    const members = Array.isArray(entry.nodes)
      ? entry.nodes.map((n) => str(n)).filter((n) => nodes.has(n))
      : [];
    if (members.length < 2) continue;
    hyperedges.push({
      id: str(entry.id, `hyperedge-${hyperedges.length}`),
      label: str(entry.label, "Group"),
      nodes: members,
      relation: str(entry.relation, "participate_in"),
    });
  }

  return finalize({
    source: "graphify",
    nodes: [...nodes.values()],
    edges,
    hyperedges,
    builtAt,
  });
}

// ── wikilink layer (live, no build step) ────────────────────────────────────

function listNotes(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length >= MAX_NOTES) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    // Skip dotfiles (.obsidian, .git) and graphify's own output directory.
    if (e.name.startsWith(".") || e.name === GRAPHIFY_DIR) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listNotes(abs, depth + 1, out);
    else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(abs);
      if (out.length >= MAX_NOTES) return out;
    }
  }
  return out;
}

const WIKILINK_RE = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const TAG_RE = /(?:^|\s)#([a-zA-Z][\w/-]{1,40})/g;
/** Fenced code and inline code hold examples, not real links. */
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/** Top-level folder → community, so the live graph still clusters sensibly. */
function folderCommunity(rel: string): string {
  const segments = rel.split(path.sep);
  return segments.length > 1 ? segments[0] : "(root)";
}

function buildWikilinkGraph(): VaultGraph {
  const dir = getVaultDir();
  const files = listNotes(dir);

  const nodes = new Map<string, GraphNode>();
  const communityIds = new Map<string, number>();
  const communityId = (name: string) => {
    let id = communityIds.get(name);
    if (id === undefined) {
      id = communityIds.size;
      communityIds.set(name, id);
    }
    return id;
  };

  // Note titles are the link targets; index them before resolving links.
  const byTitle = new Map<string, string>();
  const contents = new Map<string, string>();

  // A vault has many same-named notes (a CLAUDE.md per folder). Where the
  // basename is ambiguous, label the node with its path instead.
  const titleCounts = new Map<string, number>();
  for (const abs of files) {
    const title = path.basename(abs, ".md").toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  for (const abs of files) {
    const rel = path.relative(dir, abs);
    const title = path.basename(rel, ".md");
    const folder = folderCommunity(rel);
    const id = `note:${rel}`;
    const ambiguous = (titleCounts.get(title.toLowerCase()) ?? 0) > 1;
    nodes.set(id, {
      id,
      label: ambiguous ? rel.replace(/\.md$/, "") : title,
      kind: "note",
      file: rel,
      community: communityId(folder),
      communityName: folder,
      degree: 0,
    });
    // First writer wins, so a root-level note beats a same-named nested one.
    if (!byTitle.has(title.toLowerCase())) byTitle.set(title.toLowerCase(), id);
    try {
      contents.set(id, fs.readFileSync(abs, "utf-8"));
    } catch {
      contents.set(id, "");
    }
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, relation: string) => {
    if (source === target) return;
    const key = `${source} ${target} ${relation}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, relation, confidence: "EXTRACTED", confidenceScore: 1 });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };

  const tagCommunity = communityId("tags");
  for (const [id, rawContent] of contents) {
    const content = rawContent.replace(CODE_RE, " ");

    for (const match of content.matchAll(WIKILINK_RE)) {
      const target = byTitle.get(match[1].trim().toLowerCase());
      if (target) addEdge(id, target, "links_to");
    }

    for (const match of content.matchAll(TAG_RE)) {
      const tag = match[1];
      const tagId = `tag:${tag.toLowerCase()}`;
      if (!nodes.has(tagId)) {
        nodes.set(tagId, {
          id: tagId,
          label: `#${tag}`,
          kind: "tag",
          file: null,
          community: tagCommunity,
          communityName: "tags",
          degree: 0,
        });
      }
      addEdge(id, tagId, "tagged");
    }
  }

  return finalize({
    source: "wikilinks",
    nodes: [...nodes.values()],
    edges,
    hyperedges: [],
    builtAt: null,
  });
}

// ── shared ──────────────────────────────────────────────────────────────────

function finalize(input: {
  source: GraphSource;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hyperedges: GraphHyperedge[];
  builtAt: string | null;
}): VaultGraph {
  const { source, nodes, edges, hyperedges, builtAt } = input;

  const byCommunity = new Map<number, { name: string; size: number }>();
  for (const n of nodes) {
    const entry = byCommunity.get(n.community);
    if (entry) entry.size++;
    else byCommunity.set(n.community, { name: n.communityName, size: 1 });
  }
  const communities = [...byCommunity.entries()]
    .map(([id, { name, size }]) => ({ id, name, size }))
    .sort((a, b) => b.size - a.size || a.id - b.id);

  const extracted = edges.filter((e) => e.confidence === "EXTRACTED").length;
  const noteFiles = new Set(nodes.map((n) => n.file).filter(Boolean));

  return {
    source,
    nodes: nodes.sort((a, b) => b.degree - a.degree),
    edges,
    hyperedges,
    communities,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      communityCount: communities.length,
      noteCount: noteFiles.size,
      builtAt,
      extractedRatio: edges.length ? extracted / edges.length : 1,
    },
  };
}

/**
 * The vault graph, preferring graphify's semantic layer.
 *
 * Returns null only when the vault itself is disabled or missing — a vault with
 * no graphify build still yields the live wikilink graph.
 */
export function vaultGraph(opts?: { source?: GraphSource }): VaultGraph | null {
  if (!isVaultEnabled()) return null;

  if (opts?.source === "wikilinks") return buildWikilinkGraph();

  const graphify = readGraphifyGraph();
  if (graphify) return graphify;

  const live = buildWikilinkGraph();
  live.notice = hasGraphifyGraph()
    ? "graphify-out/graph.json could not be read — showing the live wikilink graph instead."
    : "No graphify graph yet — showing the live wikilink graph. Build the semantic layer by running /graphify in the vault directory.";
  return live;
}
