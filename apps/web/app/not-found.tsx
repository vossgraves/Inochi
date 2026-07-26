import Link from "next/link";
import { BrandMark } from "../components/brand-mark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-16 text-center">
      <div>
        <BrandMark state="paused" className="mx-auto size-16" />
        <span className="mt-8 block font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase tnum">
          404
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Nothing at this path</h1>
        <p className="mx-auto mt-4 max-w-[48ch] leading-relaxed text-muted-foreground">
          The page may have moved. Your progression data is untouched.
        </p>
        <Button asChild variant="primary" size="lg" className="mt-8">
          <Link href="/">Return to Inochi</Link>
        </Button>
      </div>
    </main>
  );
}
