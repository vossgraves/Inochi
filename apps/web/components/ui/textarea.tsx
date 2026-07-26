import * as React from "react";
import { cn } from "@/lib/utils";

/*
  Most textareas in the dashboard hold ID lists and reward tuples, one per line,
  so the default face is mono.
*/
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground transition-[border-color,box-shadow] duration-160 ease-ink",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
