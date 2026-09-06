import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  onClick,
  title,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  /** Native tooltip — used to explain what a metric actually measures. */
  title?: string;
  /** Anchor target so other pages can deep-link to a settings section. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-xl border border-border bg-panel/80 backdrop-blur-sm",
        className,
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
