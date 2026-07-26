import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-5 py-16" role="status" aria-live="polite">
      <span className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
        Connecting to Discord
      </span>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Finding your servers</h1>
      <p className="mt-4 max-w-[60ch] leading-relaxed text-muted-foreground">
        Inochi is checking your manager permissions and loading the latest progression state.
      </p>
      {/* Still blocks matching the guild-card footprint. No shimmer sweep. */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
