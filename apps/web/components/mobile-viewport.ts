"use client";
import { useEffect, useState } from "react";

/** Safari resizes the visual viewport, rather than the layout, for the keyboard. */
export function useMobileViewport() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const changed = () => setMobile(media.matches);
    changed();
    media.addEventListener("change", changed);
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.documentElement;
        // Pinch zoom must remain usable; do not relayout the app while zoomed.
        if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
        root.style.setProperty(
          "--mobile-height",
          `${viewport?.height ?? window.innerHeight}px`,
        );
        root.style.setProperty("--mobile-top", `${viewport?.offsetTop ?? 0}px`);
        root.dataset.keyboard = String(
          window.innerHeight - (viewport?.height ?? window.innerHeight) > 150,
        );
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", changed);
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--mobile-height");
      document.documentElement.style.removeProperty("--mobile-top");
      delete document.documentElement.dataset.keyboard;
    };
  }, []);
  return mobile;
}
