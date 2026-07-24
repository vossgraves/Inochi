"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function MotionController() {
  const pathname = usePathname();
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const animations: { cancel?: () => void }[] = [];
    let cancelled = false;

    if (!reduced && window.matchMedia("(pointer: fine)").matches) {
      const spotlightCards = [...document.querySelectorAll<HTMLElement>(".spotlight-card")];
      for (const card of spotlightCards) {
        let rect = card.getBoundingClientRect();
        let frame = 0;
        let pointer: PointerEvent | null = null;
        const enter = () => { rect = card.getBoundingClientRect(); };
        const move = (event: PointerEvent) => {
          pointer = event;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!pointer) return;
            card.style.setProperty("--spot-x", `${pointer.clientX - rect.left}px`);
            card.style.setProperty("--spot-y", `${pointer.clientY - rect.top}px`);
          });
        };
        card.addEventListener("pointerenter", enter);
        card.addEventListener("pointermove", move);
        cleanups.push(() => {
          if (frame) cancelAnimationFrame(frame);
          card.removeEventListener("pointerenter", enter);
          card.removeEventListener("pointermove", move);
        });
      }
    }

    const tiltElements = [...document.querySelectorAll<HTMLElement>("[data-tilt]")];
    if (tiltElements.length && !reduced && window.matchMedia("(pointer: fine)").matches) {
      for (const tilt of tiltElements) {
        const move = (event: PointerEvent) => {
          const rect = tilt.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          tilt.style.setProperty("--tilt-x", `${(-y * 7).toFixed(2)}deg`);
          tilt.style.setProperty("--tilt-y", `${(x * 9).toFixed(2)}deg`);
          tilt.style.setProperty("--glare-x", `${((x + 0.5) * 100).toFixed(1)}%`);
          tilt.style.setProperty("--glare-y", `${((y + 0.5) * 100).toFixed(1)}%`);
        };
        const reset = () => {
          tilt.style.setProperty("--tilt-x", "0deg");
          tilt.style.setProperty("--tilt-y", "0deg");
        };
        tilt.addEventListener("pointermove", move);
        tilt.addEventListener("pointerleave", reset);
        cleanups.push(() => {
          tilt.removeEventListener("pointermove", move);
          tilt.removeEventListener("pointerleave", reset);
        });
      }
    }

    if (!reduced) {
      void import("animejs").then(({ animate, stagger }) => {
        if (cancelled) return;
        document.documentElement.classList.add("motion-enhanced");
        const hero = [...document.querySelectorAll<HTMLElement>("[data-hero]")];
        if (hero.length) animations.push(animate(hero, { opacity: [0, 1], y: [22, 0], delay: stagger(70), duration: 720, ease: "out(3)", onComplete: () => hero.forEach((element) => element.style.removeProperty("transform")) }));

        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const element = entry.target as HTMLElement;
            animations.push(animate(element, { opacity: [0, 1], y: [28, 0], duration: 680, ease: "out(3)", onComplete: () => element.style.removeProperty("transform") }));
          }
        }, { threshold: 0.01, rootMargin: "0px 0px -5%" });
        document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => observer.observe(element));
        cleanups.push(() => observer.disconnect());
      }).catch(() => document.documentElement.classList.remove("motion-enhanced"));
    }

    return () => {
      cancelled = true;
      document.documentElement.classList.remove("motion-enhanced");
      animations.forEach((animation) => animation.cancel?.());
      document.querySelectorAll<HTMLElement>("[data-hero], [data-reveal]").forEach((element) => {
        element.style.removeProperty("opacity");
        element.style.removeProperty("transform");
      });
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [pathname, reduced]);

  return null;
}
