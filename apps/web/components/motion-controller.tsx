"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/*
  One IntersectionObserver reveal, and nothing else.

  This replaced an animejs-driven controller that also ran cursor-following
  spotlights and 3D tilt on pointermove. Those were the loudest part of the old
  visual language and they are gone with it, along with the animejs dependency.

  Reduced motion is handled in CSS: .reveal resolves to visible under
  prefers-reduced-motion, so this observer only ever adds the attribute that
  drives the transition.
*/
export function MotionController() {
  const pathname = usePathname();

  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>(".reveal:not([data-revealed])")];
    if (!targets.length) return;

    const reveal = (element: HTMLElement) => {
      element.dataset.revealed = "true";
    };

    // No IntersectionObserver (or reduced motion already flattened things):
    // show everything immediately rather than leaving content at opacity 0.
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach(reveal);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          reveal(entry.target as HTMLElement);
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px -5%" },
    );

    targets.forEach((element) => observer.observe(element));

    /*
      Safety net kept from cd83e49. Dashboard settings sections were being left
      invisible when the observer never fired for them, so anything still
      unrevealed after a beat is shown regardless.
    */
    const fallback = setTimeout(() => {
      document
        .querySelectorAll<HTMLElement>(".reveal:not([data-revealed])")
        .forEach(reveal);
    }, 1200);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [pathname]);

  return null;
}
