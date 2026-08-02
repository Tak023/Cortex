"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Lightbulb,
  LayoutDashboard,
  FolderKanban,
  Activity,
  Settings,
  Monitor,
  Sparkles,
  Plug,
} from "lucide-react";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    cortexDesktop?: { isDesktop: boolean; platform: string };
  }
}

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

const NAV = [
  { href: "/", label: "Command", icon: LayoutDashboard },
  { href: "/jarvis", label: "Jarvis", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/orchestration", label: "Orchestration", icon: Activity },
  { href: "/mcp", label: "MCP Servers", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

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

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(href + "/");
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
      </nav>
    </aside>
  );
}
