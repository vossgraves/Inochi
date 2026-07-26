import * as React from "react";
import { cn } from "@/lib/utils";

/*
  Cards here are hairline containers, not elevated surfaces. No shadow, no
  gradient fill, no per-section accent rotation. Where a card is not earning its
  keep, group with a `.rule` hairline instead.
*/
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-md border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 border-b border-border px-5 py-4", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("max-w-prose text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 border-t border-border px-5 py-4", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
