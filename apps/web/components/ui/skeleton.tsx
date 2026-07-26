import { cn } from "@/lib/utils";

/*
  A still hairline block, not a shimmer sweep. The motion budget for this
  identity does not include a looping gradient scan on every load.
*/
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md border border-border bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
