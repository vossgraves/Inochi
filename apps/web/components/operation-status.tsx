import type { ReactNode } from "react";
import { AlertTriangle, Check, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type OperationState =
  | "idle"
  | "active"
  | "paused"
  | "pending"
  | "success"
  | "warning"
  | "error";

/*
  State is carried by a small icon plus the semantic colour, not by an animated
  brand mark. Only `pending` moves, because only `pending` is genuinely ongoing.
*/
const presentation: Record<OperationState, { icon: typeof Check; className: string }> = {
  idle: { icon: CircleDashed, className: "text-muted-foreground" },
  active: { icon: Check, className: "text-success" },
  paused: { icon: PauseCircle, className: "text-muted-foreground" },
  pending: { icon: Loader2, className: "text-muted-foreground" },
  success: { icon: Check, className: "text-success" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  error: { icon: XCircle, className: "text-destructive" },
};

export function OperationStatus({
  state,
  children,
  compact = false,
}: {
  state: OperationState;
  children: ReactNode;
  compact?: boolean;
}) {
  const { icon: Icon, className } = presentation[state];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex min-w-0 items-center gap-2.5 text-sm leading-snug",
        compact ? "font-mono text-xs" : "border border-border px-3 py-2.5",
        className,
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", state === "pending" && "motion-safe:animate-spin")}
        aria-hidden="true"
      />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
