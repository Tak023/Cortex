import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function statusColor(status: string): string {
  switch (status) {
    case "online":
    case "completed":
    case "approved":
      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "idle":
    case "pending":
    case "queued":
      return "text-slate-400 bg-slate-400/10 border-slate-400/20";
    case "busy":
    case "running":
      return "text-sky-400 bg-sky-400/10 border-sky-400/20";
    case "error":
    case "failed":
    case "rejected":
      return "text-rose-400 bg-rose-400/10 border-rose-400/20";
    case "offline":
    case "paused":
      return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "awaiting_approval":
      return "text-violet-400 bg-violet-400/10 border-violet-400/20";
    default:
      return "text-slate-400 bg-slate-400/10 border-slate-400/20";
  }
}
