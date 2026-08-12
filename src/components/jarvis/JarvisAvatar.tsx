"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type JarvisAvatarMood =
  | "idle"
  | "listening"
  | "processing"
  | "thinking"
  | "speaking"
  | "offline";

type Props = {
  mood?: JarvisAvatarMood;
  /**
   * sm/md = circular crop for chat bubbles
   * lg/xl/hero = full HUD interface (Resources/jarvis.html)
   */
  size?: "sm" | "md" | "lg" | "xl" | "hero";
  className?: string;
  showLabel?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

/** Classic ring HUD (Resources/jarvis.html → public/) */
export const JARVIS_ORB_SRC = "/jarvis.html";

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-11 w-11",
  md: "h-20 w-20",
  // Circular HUD reads better closer to square than 16:9
  lg: "w-full max-w-xl aspect-square min-h-[280px] max-h-[420px]",
  xl: "w-full max-w-2xl aspect-square min-h-[320px] max-h-[480px]",
  hero: "w-full max-w-3xl aspect-square min-h-[340px] max-h-[520px] sm:min-h-[400px]",
};

const LABEL: Record<JarvisAvatarMood, string> = {
  idle: "Ready — click the orb to talk",
  listening: "Listening to you…",
  processing: "Understanding…",
  thinking: "Forming a response…",
  speaking: "Speaking with you…",
  offline: "Offline",
};

function isOrbLayout(size: NonNullable<Props["size"]>) {
  return size === "lg" || size === "xl" || size === "hero";
}

/** Map app moods onto the HTML visualization's state machine. */
function moodToEmbedState(mood: JarvisAvatarMood): string {
  if (mood === "thinking") return "processing";
  return mood;
}

/**
 * Interactive Jarvis voice orb — centerpiece of AI communication.
 * Hero/orb sizes embed jarvis.html; chat bubbles use a compact CSS core.
 */
export function JarvisAvatar({
  mood = "idle",
  size = "hero",
  className,
  showLabel = true,
  onClick,
  disabled,
}: Props) {
  const interactive = Boolean(onClick) && !disabled;
  const orb = isOrbLayout(size);
  const Tag = interactive ? "button" : "div";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastMoodRef = useRef<JarvisAvatarMood | null>(null);

  // Drive embedded visualization mood via postMessage
  useEffect(() => {
    if (!orb) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const send = () => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: "jarvis-state",
            state: moodToEmbedState(mood),
          },
          "*",
        );
        lastMoodRef.current = mood;
      } catch {
        // ignore not-ready
      }
    };

    send();
    const onLoad = () => send();
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [mood, orb]);

  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={interactive ? onClick : undefined}
      // `disabled` is not valid on a div, and Tag is only a button when interactive
      disabled={interactive ? disabled : undefined}
      className={cn(
        "group relative flex w-full flex-col items-center gap-3 outline-none",
        interactive &&
          "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      aria-label={interactive ? `Jarvis — ${LABEL[mood]}` : undefined}
    >
      <div
        className={cn(
          "jarvis-avatar relative w-full overflow-hidden",
          orb ? "jarvis-avatar--orb" : "jarvis-avatar--circle",
          SIZE[size],
          mood === "idle" && "jarvis-avatar--idle",
          mood === "listening" && "jarvis-avatar--listening",
          mood === "processing" && "jarvis-avatar--processing",
          mood === "thinking" && "jarvis-avatar--thinking",
          mood === "speaking" && "jarvis-avatar--speaking",
          mood === "offline" && "jarvis-avatar--offline",
        )}
      >
        {orb ? (
          <iframe
            ref={iframeRef}
            title="Jarvis interface"
            src={`${JARVIS_ORB_SRC}?embed=1&state=${encodeURIComponent(moodToEmbedState(mood))}`}
            className="jarvis-avatar__iframe absolute inset-0 h-full w-full border-0"
            // Clicks go to parent button for talk toggle
            style={{ pointerEvents: "none" }}
            loading="eager"
          />
        ) : (
          /* Compact bubble avatar matching the cyan ring core */
          <div className="jarvis-avatar__face jarvis-avatar__face--mini" aria-hidden>
            <span className="jarvis-avatar__mini-core" />
            <span className="jarvis-avatar__mini-ring" />
          </div>
        )}
      </div>

      {showLabel && (
        <span
          className={cn(
            "text-xs font-medium tracking-[0.14em] uppercase transition-colors duration-500",
            mood === "speaking" && "text-sky-300",
            mood === "listening" && "text-sky-400",
            mood === "thinking" && "text-amber-300/90",
            mood === "processing" && "text-amber-200/90",
            mood === "idle" && "text-muted",
            mood === "offline" && "text-muted/70",
          )}
        >
          {LABEL[mood]}
        </span>
      )}
    </Tag>
  );
}

export function jarvisMoodFromState(opts: {
  online: boolean;
  listening: boolean;
  processing: boolean;
  thinking: boolean;
  speaking: boolean;
}): JarvisAvatarMood {
  if (!opts.online) return "offline";
  if (opts.speaking) return "speaking";
  if (opts.thinking) return "thinking";
  if (opts.processing) return "processing";
  if (opts.listening) return "listening";
  return "idle";
}
