import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Badges are mono, uppercase and hairline. The `state` variants back the
  giveaway lifecycle and read from the --state-* tokens, so live/scheduled/
  drawn/ended stay consistent once the feature is wired.
*/
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[0.65rem] tracking-wider whitespace-nowrap uppercase [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline: "border-border text-muted-foreground",
        solid: "border-primary bg-primary text-primary-foreground",
        live: "border-state-live/40 text-state-live",
        scheduled: "border-state-scheduled/40 text-state-scheduled",
        drawn: "border-state-drawn/40 text-state-drawn",
        ended: "border-state-ended text-muted-foreground",
        success: "border-success/40 text-success",
        warning: "border-warning/40 text-warning",
        destructive: "border-destructive/40 text-destructive",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
