"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex items-center gap-6 border-b border-border", className)}
      {...props}
    />
  );
}

/*
  The active tab is marked by a vermilion underline rather than a filled pill,
  which keeps the hairline language consistent with the rest of the product.
*/
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative -mb-px border-b-2 border-transparent py-3 font-mono text-xs tracking-wider whitespace-nowrap text-muted-foreground uppercase transition-colors duration-160 ease-ink",
        "hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
