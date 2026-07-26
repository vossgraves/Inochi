"use client";

import { RotateCcw } from "lucide-react";
import { BrandMark } from "../../components/brand-mark";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-16 text-center">
      <div>
        <BrandMark state="error" className="mx-auto size-16" />
        <span className="mt-8 block font-mono text-[0.7rem] tracking-[0.2em] text-destructive uppercase">
          Connection interrupted
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Dashboard connection lost
        </h1>
        <p className="mx-auto mt-4 max-w-[54ch] leading-relaxed text-muted-foreground">
          Your configuration was not changed. Retry the Discord and database connection when you are
          ready.
        </p>
        <Button variant="primary" size="lg" className="mt-8" onClick={reset}>
          Retry connection
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
