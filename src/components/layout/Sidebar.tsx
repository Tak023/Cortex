"use client";

import { Suspense, useEffect, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  Lightbulb,
  LayoutDashboard,
  FolderKanban,
  Activity,
  Settings,
  Monitor,
  Network,
  Sparkles,
  Plug,
  Loader2,
  SquareTerminal,
  Search,
} from "lucide-react";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { cn } from "@/lib/utils";
import {
  EXTERNAL_AGENTS,
  type ExternalAgentId,
} from "@/lib/agents/externalAgents";

function DesktopBadge() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(Boolean(window.cortexDesktop?.isDesktop));
  }, []);
  if (!desktop) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
      <Monitor className="h-3 w-3" />
      Desktop app
    </span>
  );
}

/** Inlined by next.config.ts at build time from package.json. */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

/** Pinned to the bottom of the rail so the running version is always visible. */
function VersionFooter() {
  return (
    <div className="border-t border-border-subtle px-3 py-2 text-center">
      <span
        className="text-[10px] tracking-wide text-muted"
        title={`Cortex ${APP_VERSION}`}
      >
        {`Cortex v${APP_VERSION}`}
      </span>
    </div>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

/** Sidebar groups — Mission Control + external AI Agents. */
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Mission Control",
    items: [
      { href: "/", label: "Command", icon: LayoutDashboard },
      { href: "/jarvis", label: "Jarvis", icon: Sparkles },
      { href: "/graphify", label: "Graphify", icon: Network },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/orchestration", label: "Orchestration", icon: Activity },
      { href: "/mcp", label: "MCP Servers", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    title: "Video Generator",
    items: [
      { href: "/video-generator/research", label: "Research", icon: Search },
    ],
  },
];

/** True when viewing an AI Agent terminal (not the Mission Control Agents page). */
function isAgentTerminalPath(pathname: string) {
  return (
    pathname === "/agents/terminal" || pathname.startsWith("/agents/terminal/")
  );
}

function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // Mission Control "Agents" is only the registry page — not AI Agent terminals.
  if (href === "/agents") {
    if (isAgentTerminalPath(pathname)) return false;
    return pathname === "/agents" || pathname.startsWith("/agents/");
  }
  return pathname === href || pathname.startsWith(href + "/");
}

function AiAgentButton({
  id,
  label,
  iconSrc,
  description,
  active,
}: {
  id: ExternalAgentId;
  label: string;
  iconSrc: string;
  description: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const href = `/agents/terminal?agent=${encodeURIComponent(id)}`;

  // Warm the route (and with it the xterm chunk) before the click, so opening a
  // terminal is not waiting on a cold code-split load.
  const prefetch = () => {
    try {
      router.prefetch(href);
    } catch {
      /* prefetch is best-effort */
    }
  };

  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      // Always open inside the main Cortex window (same shell).
      // PTY is hosted by Electron main process — not macOS Terminal.app.
      router.push(href);
      setHint("Opening…");
      window.setTimeout(() => setHint(null), 1200);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => void launch()}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        disabled={busy}
        title={description}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
          "disabled:cursor-wait disabled:opacity-60",
          active
            ? "border border-blue-500/20 bg-accent-soft text-accent"
            : "border border-transparent text-muted hover:bg-white/5 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1",
            active ? "ring-sky-400/40" : "ring-white/10",
          )}
        >
          <Image
            src={iconSrc}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 object-cover"
            unoptimized
          />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
        ) : active ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse-dot" />
        ) : (
          <SquareTerminal className="h-3 w-3 shrink-0 opacity-40" />
        )}
      </button>
      {hint ? (
        <p
          className={cn(
            "px-3 pb-1 text-[10px] leading-snug",
            hint.toLowerCase().includes("not found") ||
              hint.toLowerCase().includes("fail") ||
              hint.toLowerCase().includes("could not")
              ? "text-amber-300/90"
              : "text-muted",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeAgentId = isAgentTerminalPath(pathname)
    ? (searchParams.get("agent") || "").trim()
    : "";

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel/60 backdrop-blur-md">
      <div className="border-b border-border-subtle p-3">
        <Link href="/" className="block transition-opacity hover:opacity-95">
          <BrandLogo variant="panel" priority className="w-full" />
        </Link>
        <div className="mt-2.5 flex flex-col items-center gap-1 px-1 text-[11px] text-muted">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse-dot" />
            Local-first · Hybrid ready
          </div>
          <DesktopBadge />
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1.5 pt-1.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">
                {section.title}
              </h2>
            </div>
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = isNavActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent-soft text-accent border border-blue-500/20"
                      : "text-muted hover:bg-white/5 hover:text-foreground border border-transparent",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}

        {/* External AI coding agents — open in-app terminals */}
        <div className="flex flex-col gap-0.5">
          <div className="px-3 pb-1.5 pt-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">
              AI Agents
            </h2>
          </div>
          {EXTERNAL_AGENTS.map((agent) => (
            <AiAgentButton
              key={agent.id}
              id={agent.id}
              label={agent.label}
              iconSrc={agent.iconSrc}
              description={agent.description}
              active={activeAgentId === agent.id}
            />
          ))}
        </div>
      </nav>

      <VersionFooter />
    </aside>
  );
}

export function Sidebar() {
  return (
    <Suspense
      fallback={
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel/60" />
      }
    >
      <SidebarNav />
    </Suspense>
  );
}
