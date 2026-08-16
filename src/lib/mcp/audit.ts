import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getDataDir } from "@/lib/store";
import type { McpAuditEntry } from "./types";

const MAX_ENTRIES = 200;

function filePath(): string {
  return path.join(getDataDir(), "mcp-audit.json");
}

function loadAll(): McpAuditEntry[] {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
      entries?: McpAuditEntry[];
    };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

function saveAll(entries: McpAuditEntry[]) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(
    filePath(),
    JSON.stringify({ entries: entries.slice(0, MAX_ENTRIES) }, null, 2),
    "utf8",
  );
}

const SECRET_KEY = /key|token|secret|password|authorization|cookie|credential/i;

export function redactPreview(value: unknown, max = 800): string {
  let cloned: unknown = value;
  try {
    cloned = JSON.parse(JSON.stringify(value));
  } catch {
    cloned = String(value ?? "");
  }
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : walk(v);
    }
    return out;
  };
  const text =
    typeof cloned === "string" ? cloned : JSON.stringify(walk(cloned));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function appendAudit(
  entry: Omit<McpAuditEntry, "id" | "at"> & { id?: string; at?: string },
): McpAuditEntry {
  const full: McpAuditEntry = {
    id: entry.id ?? `mcp-${nanoid(10)}`,
    at: entry.at ?? new Date().toISOString(),
    agentId: entry.agentId,
    serverId: entry.serverId,
    tool: entry.tool,
    argsPreview: entry.argsPreview,
    resultPreview: entry.resultPreview,
    durationMs: entry.durationMs,
    status: entry.status,
    pid: entry.pid,
    error: entry.error,
  };
  const all = loadAll();
  all.unshift(full);
  saveAll(all);
  return full;
}

export function listAudit(limit = 80): McpAuditEntry[] {
  return loadAll().slice(0, Math.min(200, Math.max(1, limit)));
}

export function clearAudit(): void {
  saveAll([]);
}
