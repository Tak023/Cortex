/**
 * Call local RivalSearchMCP as a one-shot Python bridge (no long-lived MCP stdio).
 * Primary live data path for Jarvis.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  resolveRivalSearchDir,
  resolveUvCommand,
  rivalSearchInstalled,
} from "@/lib/mcp/catalog";
import type { LiveContext, LiveSearchHit } from "./realtime";

export type RivalBridgeResult = {
  ok: boolean;
  provider?: string;
  providerLabel?: string;
  hits: LiveSearchHit[];
  notes?: string[];
  query?: string;
};

let lastError: string | null = null;

export function getRivalSearchLastError(): string | null {
  return lastError;
}

function hitsToBlock(
  query: string,
  provider: string,
  hits: LiveSearchHit[],
): string {
  if (!hits.length) {
    return (
      `Live web search for "${query}" via ${provider} returned no results. ` +
      `Say you could not verify live data rather than inventing current events.`
    );
  }
  const lines = hits.slice(0, 8).map((h, i) => {
    const url = h.url ? ` (${h.url})` : "";
    return `${i + 1}. ${h.title}${url}\n   ${h.snippet}`;
  });
  return (
    `Live web results for "${query}" (source: ${provider}). ` +
    `Use these as ground truth for current facts; cite titles briefly when relevant.\n` +
    lines.join("\n")
  );
}

/** Prefer package-local bridge, else repo scripts copy. */
function resolveBridgeScript(rivalDir: string): string | null {
  const candidates = [
    path.join(rivalDir, "cortex_bridge.py"),
    path.join(process.cwd(), "scripts", "cortex_bridge_rival.py"),
    path.join(process.cwd(), "..", "scripts", "cortex_bridge_rival.py"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Run RivalSearchMCP cortex_bridge.py via uv.
 * mode: auto | news | web
 */
export async function searchRivalSearch(
  query: string,
  opts?: { mode?: "auto" | "news" | "web"; timeoutMs?: number },
): Promise<LiveContext | null> {
  lastError = null;
  if (!rivalSearchInstalled()) {
    lastError = "not_installed";
    return null;
  }

  const dir = resolveRivalSearchDir();
  const bridge = resolveBridgeScript(dir);
  if (!bridge) {
    lastError = "bridge_missing";
    return null;
  }

  const uv = resolveUvCommand();
  const mode = opts?.mode || "auto";
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  // Pass absolute path so scripts/ copy works outside the package tree
  const bridgeArg = bridge;

  return new Promise((resolve) => {
    const child = spawn(
      uv,
      ["run", "--directory", dir, "python", bridgeArg, query, mode],
      {
        cwd: dir,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (ctx: LiveContext | null) => {
      if (settled) return;
      settled = true;
      resolve(ctx);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      lastError = "timeout";
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      lastError = err.message;
      finish(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // Parse last JSON object from stdout (ignore log noise)
      const text = stdout.trim();
      const jsonLine =
        text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("{"))
          .pop() || text;

      try {
        const data = JSON.parse(jsonLine) as RivalBridgeResult;
        const hits = (data.hits || [])
          .map((h) => ({
            title: String(h.title || "Result").trim(),
            url: h.url ? String(h.url) : undefined,
            snippet: String(h.snippet || h.title || "").trim().slice(0, 400),
          }))
          .filter((h) => h.title);

        if (!hits.length) {
          lastError =
            data.notes?.join("; ") ||
            (code === 0 ? "empty" : `exit_${code}`);
          if (stderr.trim()) {
            lastError += ` · ${stderr.trim().slice(0, 160)}`;
          }
          finish(null);
          return;
        }

        lastError = null;
        const provider = `rival-search/${data.provider || "bridge"}`;
        const notes = data.notes?.length ? data.notes : undefined;
        finish({
          searched: true,
          query,
          provider,
          hits,
          notes,
          block: hitsToBlock(query, provider, hits),
        });
      } catch (e) {
        lastError =
          e instanceof Error
            ? `parse_error: ${e.message}`
            : "parse_error";
        if (stderr.trim()) lastError += ` · ${stderr.trim().slice(0, 120)}`;
        finish(null);
      }
    });
  });
}

export function rivalSearchBridgeReady(): boolean {
  try {
    if (!rivalSearchInstalled()) return false;
    return Boolean(resolveBridgeScript(resolveRivalSearchDir()));
  } catch {
    return false;
  }
}
