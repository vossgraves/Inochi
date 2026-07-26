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

  Two rules keep this from ever hiding content permanently, both learned the
  hard way:

  1. Never bail out early. An earlier version returned when it found no
     targets at mount, which skipped both the observer and the fallback below.
     Server components stream, so the dashboard's markup frequently arrives
     after this effect runs; everything that appeared later stayed at opacity 0
     and the page rendered blank. Whether that happened came down to timing,
     which made it look intermittent.
  2. Watch for nodes that arrive later, rather than assuming one query at mount
     sees the whole page.
*/
export function MotionController() {
  const pathname = usePathname();

  useEffect(() => {
    const reveal = (element: HTMLElement) => {
      element.dataset.revealed = "true";
    };
    const pending = () => [...document.querySelectorAll<HTMLElement>(".reveal:not([data-revealed])")];

    // Without IntersectionObserver there is nothing to drive the reveal, so
    // show the content rather than leaving it hidden.
    if (typeof IntersectionObserver === "undefined") {
      pending().forEach(reveal);
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

    const observePending = () => pending().forEach((element) => observer.observe(element));
    observePending();

    // Picks up markup that streams in or renders after this effect, which is
    // the common case on the dashboard.
    let frame = 0;
    const mutations = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        observePending();
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    /*
      Safety net, originally added in cd83e49 because settings sections were
      being left invisible. It now also covers anything the observer never fires
      for, and it is armed unconditionally so an empty first query cannot
      disable it.
    */
    const fallback = setTimeout(() => pending().forEach(reveal), 1200);

    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [pathname]);

  return null;
}
