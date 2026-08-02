import { cn } from "@/lib/utils";

/** Matches Cortex art background (sampled from Resources/Cortex.jpg) */
export const CORTEX_BG_TOP = "#1b1a3c";
export const CORTEX_BG_BOTTOM = "#525094";

/** Cache-bust when brand asset is regenerated */
const BRAND_SRC = "/branding/cortex.jpg?v=3";

type BrandLogoProps = {
  /** Square mark size in px (compact icon mode) */
  size?: number;
  /** Full branding panel — fills parent width */
  variant?: "mark" | "panel";
  className?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  priority?: boolean;
};

/**
 * Cortex brand mark from Resources/Cortex.jpg (served via /branding/cortex.jpg).
 * Full-bleed display — no black corner gaps; frame uses the art's own navy/purple.
 */
export function BrandLogo({
  size = 56,
  variant = "mark",
  className,
  showWordmark = false,
  wordmarkClassName,
  priority = false,
}: BrandLogoProps) {
  if (variant === "panel") {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl",
          "ring-1 ring-sky-400/25",
          "shadow-[0_8px_40px_-10px_rgba(56,189,248,0.35)]",
          className,
        )}
        style={{
          // Same navy→purple as art so any anti-aliased edge matches (no black fringing)
          background: `linear-gradient(180deg, ${CORTEX_BG_TOP} 0%, ${CORTEX_BG_BOTTOM} 100%)`,
        }}
      >
        <div className="relative w-full aspect-square">
          {/* eslint-disable-next-line @next/next/no-img-element -- original asset, full-bleed */}
          <img
            src={BRAND_SRC}
            alt="Cortex — Agentic OS"
            width={1024}
            height={1024}
            className="absolute inset-0 h-full w-full object-cover object-center"
            decoding="async"
            {...(priority ? { fetchPriority: "high" as const } : {})}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="relative shrink-0 overflow-hidden rounded-xl ring-1 ring-sky-400/20 shadow-lg shadow-sky-500/20"
        style={{
          width: size,
          height: size,
          background: CORTEX_BG_TOP,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND_SRC}
          alt="Cortex"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          decoding="async"
        />
      </div>
      {showWordmark && (
        <div className={cn("min-w-0", wordmarkClassName)}>
          <div className="text-sm font-semibold tracking-tight leading-tight">
            Cortex
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted leading-tight">
            Agentic OS
          </div>
        </div>
      )}
    </div>
  );
}
