"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Play,
  Rocket,
  Terminal,
} from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type LaunchInfo = {
  workspacePath: string;
  appPath: string | null;
  appExists: boolean;
  launchUrl: string | null;
  launchCommand: string | null;
  steps: Array<{ n: number; title: string; detail: string }>;
  kind: string;
  serverRunning: boolean;
};

type ActionResult = {
  project?: Project;
  message?: string;
  openedUrl?: string | null;
  started?: boolean;
  launch?: LaunchInfo;
  error?: string;
};

export function LaunchPanel({
  project,
  onAction,
}: {
  project: Project;
  onAction: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<ActionResult | unknown>;
}) {
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [busy, setBusy] = useState<"launch" | "build" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshInfo = async () => {
    try {
      const res = (await onAction("launch_info")) as ActionResult;
      if (res.launch) setLaunch(res.launch);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.status, project.appPath, project.workspacePath]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 6000);
  };

  const handleLaunch = async () => {
    setBusy("launch");
    setError(null);
    setToast(null);
    try {
      const res = (await onAction("launch_app")) as ActionResult;
      if (res.launch) setLaunch(res.launch);
      if (res.error) {
        setError(res.error);
      } else if (res.message?.includes("Unable to connect") || res.started === false) {
        // Surface full remediation text (not a green success toast)
        setError(res.message || "Launch failed");
      } else {
        showToast(res.message || "App is running");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(null);
      void refreshInfo();
    }
  };

  const handleBuild = async () => {
    setBusy("build");
    setError(null);
    try {
      const res = (await onAction("rebuild_app")) as ActionResult;
      if (res.launch) setLaunch(res.launch);
      showToast(res.message || "App scaffolded — click Launch app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBusy(null);
      void refreshInfo();
    }
  };

  const info = launch;
  const url = info?.launchUrl || project.launchUrl || "http://127.0.0.1:3456";
  const cmd =
    info?.launchCommand ||
    project.launchCommand ||
    `cd "${info?.appPath || project.appPath || "…/app"}" && npm run dev`;
  const appPath = info?.appPath || project.appPath;
  const appExists = info?.appExists ?? Boolean(appPath);

  return (
    <Card className="border-sky-500/35 bg-gradient-to-br from-sky-500/10 via-panel/80 to-violet-500/10">
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/30">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight">
                How to launch your app
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {project.status === "completed"
                  ? "Pipeline finished — use the steps below (one click if you prefer)."
                  : "When the app is scaffolded, launch it from here."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="md"
              disabled={busy !== null}
              onClick={handleLaunch}
              title="Scaffold if needed, start server, open browser"
            >
              {busy === "launch" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {appExists ? "Launch app" : "Build & launch"}
            </Button>
            <Button
              size="md"
              variant="secondary"
              disabled={busy !== null}
              onClick={handleBuild}
            >
              {busy === "build" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Rebuild source
            </Button>
          </div>
        </div>

        {/* Numbered steps */}
        <ol className="grid gap-2 sm:grid-cols-3">
          {(
            info?.steps ?? [
              {
                n: 1,
                title: "Build",
                detail: "Scaffold source with Build & launch",
              },
              {
                n: 2,
                title: "Start",
                detail: "Launch app starts the local server",
              },
              {
                n: 3,
                title: "Open",
                detail: url,
              },
            ]
          ).map((step) => (
            <li
              key={step.n}
              className="rounded-xl border border-border bg-panel/70 px-3 py-3"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-sky-300">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-[11px]">
                  {step.n}
                </span>
                {step.title}
              </div>
              <p className="mt-1.5 break-all text-[11px] leading-relaxed text-muted">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>

        {/* Concrete paths */}
        <div className="rounded-xl border border-border-subtle bg-panel-elevated/60 px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted">
              Browser
            </span>
            <div className="flex flex-wrap gap-1.5">
              {url && (
                <a href={url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open {url.replace("http://", "")}
                  </Button>
                </a>
              )}
            </div>
          </div>
          <p className="font-mono text-xs text-accent break-all">{url}</p>

          <div className="border-t border-border-subtle pt-2 mt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
                <Terminal className="h-3.5 w-3.5" /> Terminal
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(cmd);
                  showToast("Command copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy command
              </Button>
            </div>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/40 px-2.5 py-2 font-mono text-[11px] text-foreground/90">
              {cmd}
            </pre>
          </div>

          {(appPath || info?.workspacePath || project.workspacePath) && (
            <div className="border-t border-border-subtle pt-2 mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onAction("reveal_workspace")}
              >
                <FolderOpen className="h-3.5 w-3.5" /> Open folder
              </Button>
              {appPath && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(appPath);
                    showToast("App path copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy app path
                </Button>
              )}
              <span className="text-[11px] text-muted break-all">
                {appPath || info?.workspacePath || project.workspacePath}
              </span>
            </div>
          )}
        </div>

        {info?.serverRunning && (
          <p className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Local server is running
            {url ? (
              <>
                {" "}
                —{" "}
                <a className="underline" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </>
            ) : null}
          </p>
        )}

        {toast && (
          <p
            className={cn(
              "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200",
            )}
          >
            {toast}
          </p>
        )}
        {error && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </pre>
        )}
        {toast && toast.includes("Unable to connect") && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {toast}
          </pre>
        )}
      </CardBody>
    </Card>
  );
}
