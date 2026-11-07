"use client";
import { useLayoutEffect, useState } from "react";

/** Safari resizes the visual viewport, rather than the layout, for the keyboard. */
export function useMobileViewport() {
  const [mobile, setMobile] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      if (!media.matches) return;
      // Pinch zoom must remain usable; do not relayout the app while zoomed.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const keyboard =
        Math.max(root.clientHeight, window.innerHeight) - height > 150;
      root.style.setProperty("--mobile-height", `${height}px`);
      // Safari can retain an old pan offset after dismissing the keyboard.
      root.style.setProperty(
        "--mobile-top",
        `${keyboard ? Math.max(0, viewport?.offsetTop ?? 0) : 0}px`,
      );
      root.dataset.keyboard = String(keyboard);
    };
    const changed = () => {
      setMobile(media.matches);
      if (media.matches) {
        root.dataset.mobileApp = "true";
        window.scrollTo(0, 0);
        update();
      } else {
        delete root.dataset.mobileApp;
        delete root.dataset.keyboard;
        root.style.removeProperty("--mobile-height");
        root.style.removeProperty("--mobile-top");
      }
    };
    changed();
    media.addEventListener("change", changed);
    // Apply geometry in the viewport event itself. Deferring it by a frame
    // lets Safari paint its focus pan before the composer catches up.
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", changed);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--mobile-height");
      root.style.removeProperty("--mobile-top");
      delete root.dataset.keyboard;
      delete root.dataset.mobileApp;
    };
  }, []);
  return mobile;
}
