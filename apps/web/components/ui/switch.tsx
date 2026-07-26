"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/*
  Checked state is the one vermilion. The old build rotated the toggle colour
  per settings section; every switch in the product is the same colour now.
*/
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border-strong bg-secondary transition-colors duration-160 ease-ink",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 translate-x-1 rounded-full bg-muted-foreground transition-[transform,background-color] duration-200 ease-ink",
          "data-[state=checked]:translate-x-6 data-[state=checked]:bg-primary-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
