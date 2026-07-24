import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

export function BrandedEmptyState({ eyebrow = "Signal quiet", title, children, action }: { eyebrow?: string; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state branded-empty" data-reveal>
    <div className="empty-life"><BrandMark state="paused" /></div>
    <span className="eyebrow mono">{eyebrow}</span>
    <strong>{title}</strong>
    <p>{children}</p>
    {action && <div className="empty-action">{action}</div>}
  </div>;
}
