import * as React from "react";
import { cn } from "@/lib/utils";

/*
  Numbers are mono and tabular so columns of thresholds and XP values line up.
  Placeholder colour is --muted-foreground, which clears AA in both themes; do
  not lighten it.
*/
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow] duration-160 ease-ink",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        type === "number" && "font-mono tnum",
        type === "color" && "h-10 cursor-pointer p-1",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
