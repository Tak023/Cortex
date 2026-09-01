"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookMarked,
  Check,
  CreditCard,
  FolderOpen,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { ExternalAgentId } from "@/lib/agents/externalAgents";
import type { AgentLaunchPlan } from "@/lib/agents/governance";
import "@xterm/xterm/css/xterm.css";

type Props = {
  agent: ExternalAgentId;
  label: string;
  /** Per-session workspace override (?cwd= on the terminal route). */
  cwd?: string;
};

const CHIP =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-none";

function AuthChip({ plan }: { plan: AgentLaunchPlan }) {
  const { billing, label, detail } = plan.auth;
  const tone =
    billing === "metered"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : billing === "subscription"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        : "border-border bg-white/5 text-muted";
  return (
    <span className={`${CHIP} ${tone}`} title={detail}>
      <CreditCard className="h-3 w-3" />
      {label}
    </span>
  );
}

function ApprovalChip({ plan }: { plan: AgentLaunchPlan }) {
  const { applied, requested, detail } = plan.approval;
  const drifted = requested !== "inherit" && applied === "inherit";
  const tone = drifted
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : applied === "auto"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : applied === "inherit"
        ? "border-border bg-white/5 text-muted"
        : "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return (
    <span className={`${CHIP} ${tone}`} title={detail}>
      <ShieldCheck className="h-3 w-3" />
      {applied === "inherit" ? "approval: CLI default" : `approval: ${applied}`}
    </span>
  );
}

function ScopeChip({ plan }: { plan: AgentLaunchPlan }) {
  const tone =
    plan.cwdScope === "home"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-border bg-white/5 text-muted";
  const short = plan.cwd.replace(/^\/Users\/[^/]+/, "~");
  return (
    <span className={`${CHIP} ${tone}`} title={`${plan.cwd} — ${plan.cwdDetail}`}>
      <FolderOpen className="h-3 w-3" />
      {short}
    </span>
  );
}

function decodeB64(b64: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(b64, "base64").toString("utf8");
    }
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return b64;
  }
}

export function AgentTerminal({ agent, label, cwd }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  /**
   * Mirrors sessionIdRef for rendering. The ref is what the async callbacks
   * read (they must see the latest id without re-subscribing), but a ref
   * write does not re-render — reading it during render left the "Save to
   * Second Brain" button's disabled state dependent on some *other* state
   * change happening to fire afterwards.
   */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const useDesktopPtyRef = useRef(false);
  const [status, setStatus] = useState<
    "starting" | "running" | "exited" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [displayCmd, setDisplayCmd] = useState<string>("");
  const [plan, setPlan] = useState<AgentLaunchPlan | null>(null);
  const [savingToVault, setSavingToVault] = useState(false);
  const [vaultSavedPath, setVaultSavedPath] = useState<string | null>(null);

  const handleSaveToVault = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || savingToVault) return;
    setSavingToVault(true);
    try {
      const res = await fetch(`/api/agents/terminal/${id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Interactive Session (${label})`,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; path?: string };
      if (data.ok && data.path) {
        setVaultSavedPath(data.path);
        setTimeout(() => setVaultSavedPath(null), 4000);
      }
    } catch {
      /* ignore */
    } finally {
      setSavingToVault(false);
    }
  }, [label, savingToVault]);

  const writeInput = useCallback(async (data: string) => {
    const id = sessionIdRef.current;
    if (!id) return;
    if (useDesktopPtyRef.current && window.cortexDesktop?.pty) {
      await window.cortexDesktop.pty.write(id, data);
      return;
    }
    try {
      await fetch(`/api/agents/terminal/${id}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        keepalive: true,
      });
    } catch {
      /* ignore transient */
    }
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const id = sessionIdRef.current;
    if (!id) return;
    if (useDesktopPtyRef.current && window.cortexDesktop?.pty) {
      await window.cortexDesktop.pty.resize(id, cols, rows);
      return;
    }
    try {
      await fetch(`/api/agents/terminal/${id}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let es: EventSource | null = null;
    let ro: ResizeObserver | null = null;
    let unsubPty: (() => void) | null = null;

    (async () => {
      const host = hostRef.current;
      if (!host) return;

      // Load in parallel. Serially awaiting four modules delayed first paint of
      // the terminal for no reason — none of them depend on each other.
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        theme: {
          background: "#07090f",
          foreground: "#e8ecf4",
          cursor: "#5b8cff",
          cursorAccent: "#07090f",
          selectionBackground: "rgba(91, 140, 255, 0.35)",
          black: "#0d111a",
          red: "#fb7185",
          green: "#34d399",
          yellow: "#fbbf24",
          blue: "#5b8cff",
          magenta: "#a78bfa",
          cyan: "#2dd4bf",
          white: "#e8ecf4",
          brightBlack: "#8b95a8",
          brightRed: "#fb7185",
          brightGreen: "#34d399",
          brightYellow: "#fbbf24",
          brightBlue: "#5b8cff",
          brightMagenta: "#a78bfa",
          brightCyan: "#2dd4bf",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(host);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      term.onData((data) => {
        void writeInput(data);
      });

      const cols = term.cols;
      const rows = term.rows;
      const desktopPty = window.cortexDesktop?.pty;

      // Prefer Electron main-process PTY (works in packaged app)
      if (desktopPty) {
        useDesktopPtyRef.current = true;

        // Governance lives on the server so both transports agree on auth
        // mode, workspace scope and approval flags.
        let govPlan: AgentLaunchPlan | null = null;
        let govArgs: string[] = [];
        try {
          const q = new URLSearchParams({ agent });
          if (cwd) q.set("cwd", cwd);
          const planRes = await fetch(`/api/agents/terminal?${q.toString()}`);
          const resolved = (await planRes.json()) as {
            governance?: AgentLaunchPlan;
            args?: string[];
          };
          govPlan = resolved.governance ?? null;
          govArgs = govPlan?.extraArgs ?? [];
        } catch {
          /* fall back to the CLI's own defaults */
        }
        if (disposed) return;
        if (govPlan) setPlan(govPlan);

        unsubPty = desktopPty.onEvent((payload) => {
          if (payload.id !== sessionIdRef.current) return;
          if (payload.type === "data" && payload.data != null) {
            term.write(payload.data);
          } else if (payload.type === "exit") {
            term.writeln(
              `\r\n\x1b[90m[process exited with code ${payload.exitCode ?? 0}]\x1b[0m`,
            );
            setStatus("exited");
          } else if (payload.type === "error" && payload.data) {
            term.writeln(`\r\n\x1b[31m${payload.data}\x1b[0m`);
            setStatus("error");
            setError(payload.data);
          }
        });

        const startData = await desktopPty.start({
          agent,
          cols,
          rows,
          cwd: govPlan?.cwd,
          extraArgs: govArgs,
          unsetEnv: govPlan?.unsetEnv ?? [],
        });
        if (disposed) return;

        if (!startData.ok || !startData.session) {
          const msg =
            startData.detail || "Failed to start agent terminal (desktop PTY)";
          setError(msg);
          setStatus("error");
          term.writeln(`\r\n\x1b[31m${msg}\x1b[0m`);
          return;
        }

        sessionIdRef.current = startData.session.id;
        setSessionId(startData.session.id);
        setDisplayCmd(startData.session.display);
        setStatus("running");
        document.title = `${startData.session.label} — Cortex`;
      } else {
        // Browser / non-desktop: HTTP + SSE API
        useDesktopPtyRef.current = false;
        const startRes = await fetch("/api/agents/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent, cols, rows, cwd }),
        });
        const startData = (await startRes.json()) as {
          ok?: boolean;
          detail?: string;
          error?: string;
          session?: {
            id: string;
            display: string;
            label: string;
            governance?: AgentLaunchPlan;
          };
        };

        if (disposed) return;

        if (!startRes.ok || !startData.ok || !startData.session) {
          const msg =
            startData.detail ||
            startData.error ||
            "Failed to start agent terminal";
          setError(msg);
          setStatus("error");
          term.writeln(`\r\n\x1b[31m${msg}\x1b[0m`);
          return;
        }

        sessionIdRef.current = startData.session.id;
        setSessionId(startData.session.id);
        setDisplayCmd(startData.session.display);
        setPlan(startData.session.governance ?? null);
        setStatus("running");
        document.title = `${startData.session.label} — Cortex`;

        es = new EventSource(
          `/api/agents/terminal/${startData.session.id}/stream`,
        );
        es.addEventListener("data", (ev) => {
          try {
            const b64 = JSON.parse((ev as MessageEvent).data) as string;
            term.write(decodeB64(b64));
          } catch {
            /* ignore */
          }
        });
        es.addEventListener("exit", (ev) => {
          try {
            const code = JSON.parse((ev as MessageEvent).data) as number;
            term.writeln(
              `\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`,
            );
          } catch {
            term.writeln(`\r\n\x1b[90m[process exited]\x1b[0m`);
          }
          setStatus("exited");
          es?.close();
        });
      }

      const doFit = () => {
        try {
          fit.fit();
          void resize(term.cols, term.rows);
        } catch {
          /* ignore */
        }
      };
      ro = new ResizeObserver(() => doFit());
      ro.observe(host);
      window.addEventListener("resize", doFit);
      requestAnimationFrame(doFit);

      const onUnload = () => {
        const id = sessionIdRef.current;
        if (!id) return;
        if (useDesktopPtyRef.current && window.cortexDesktop?.pty) {
          void window.cortexDesktop.pty.kill(id);
        } else {
          void fetch(`/api/agents/terminal/${id}`, {
            method: "DELETE",
            keepalive: true,
          });
        }
      };
      window.addEventListener("beforeunload", onUnload);
    })();

    return () => {
      disposed = true;
      es?.close();
      ro?.disconnect();
      unsubPty?.();
      const id = sessionIdRef.current;
      if (id) {
        if (useDesktopPtyRef.current && window.cortexDesktop?.pty) {
          void window.cortexDesktop.pty.kill(id);
        } else {
          void fetch(`/api/agents/terminal/${id}`, {
            method: "DELETE",
            keepalive: true,
          });
        }
      }
      sessionIdRef.current = null;
      setSessionId(null);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // One PTY per (agent, workspace) — changing either restarts the session.
  }, [agent, cwd, writeInput, resize]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07090f] text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-foreground"
            title="Back to Command Center"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{label}</span>
              {plan ? (
                <span className="flex flex-wrap items-center gap-1">
                  <AuthChip plan={plan} />
                  <ApprovalChip plan={plan} />
                  <ScopeChip plan={plan} />
                </span>
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted">
              {displayCmd || "Starting…"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleSaveToVault}
            disabled={savingToVault || !sessionId}
            title="Save session output to Obsidian second brain (daily note)"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel-elevated/70 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-40"
          >
            {savingToVault ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted" />
                <span>Saving…</span>
              </>
            ) : vaultSavedPath ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-300 font-medium">Saved to Daily Note</span>
              </>
            ) : (
              <>
                <BookMarked className="h-3 w-3 text-sky-400" />
                <span>Save to Second Brain</span>
              </>
            )}
          </button>
          <span
            className={
              status === "running"
                ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300"
                : status === "error"
                  ? "rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300"
                  : status === "exited"
                    ? "rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-muted"
                    : "rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300"
            }
          >
            {status}
          </span>
        </div>
      </header>
      {error ? (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
      {plan?.notes.length ? (
        <div className="border-b border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          {plan.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
