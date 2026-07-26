import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

export function BrandedEmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="reveal grid place-items-center border border-dashed border-border-strong px-6 py-20 text-center">
      <BrandMark state="paused" className="size-12" />
      <strong className="mt-6 text-xl font-semibold tracking-tight">{title}</strong>
      <p className="mt-3 max-w-[52ch] leading-relaxed text-muted-foreground">{children}</p>
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}
