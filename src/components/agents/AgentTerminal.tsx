"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ExternalAgentId } from "@/lib/agents/externalAgents";
import "@xterm/xterm/css/xterm.css";

type Props = {
  agent: ExternalAgentId;
  label: string;
};

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

export function AgentTerminal({ agent, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const useDesktopPtyRef = useRef(false);
  const [status, setStatus] = useState<
    "starting" | "running" | "exited" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [displayCmd, setDisplayCmd] = useState<string>("");

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

        const startData = await desktopPty.start({ agent, cols, rows });
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
        setDisplayCmd(startData.session.display);
        setStatus("running");
        document.title = `${startData.session.label} — Cortex`;
      } else {
        // Browser / non-desktop: HTTP + SSE API
        useDesktopPtyRef.current = false;
        const startRes = await fetch("/api/agents/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent, cols, rows }),
        });
        const startData = (await startRes.json()) as {
          ok?: boolean;
          detail?: string;
          error?: string;
          session?: {
            id: string;
            display: string;
            label: string;
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
        setDisplayCmd(startData.session.display);
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
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per agent
  }, [agent, writeInput, resize]);

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
            <div className="truncate text-sm font-medium">{label}</div>
            <div className="truncate font-mono text-[11px] text-muted">
              {displayCmd || "Starting…"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
