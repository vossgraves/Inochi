import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

export type OperationState = "idle" | "active" | "paused" | "pending" | "success" | "warning" | "error";

export function OperationStatus({ state, children, compact = false }: { state: OperationState; children: ReactNode; compact?: boolean }) {
  return <div className={`operation-status operation-${state} ${compact ? "compact" : ""}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="operation-mark"><BrandMark state={state} /></span>
    <span>{children}</span>
  </div>;
}
