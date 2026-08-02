import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20 border border-blue-400/30",
  secondary:
    "bg-panel-elevated text-foreground hover:bg-[#1a2235] border border-border",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-white/5",
  danger:
    "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30",
  success:
    "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30",
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-3.5 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-sm",
        variants[variant],
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
