"use client";
import { useLayoutEffect, useRef } from "react";
import { listenForHorizontalSwipe, swipeMotion } from "./mobile-swipe";

export function useMobileSidebar({
  mobile,
  open,
  canOpen,
  onChange,
  onDragStart,
}: {
  mobile: boolean;
  open: boolean;
  canOpen: boolean;
  onChange: (open: boolean) => void;
  onDragStart: () => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const current = useRef({ open, canOpen, onChange, onDragStart });
  current.current = { open, canOpen, onChange, onDragStart };
  const settle = useRef<(open: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const root = shell.current;
    const sidebar = panel.current;
    if (!mobile || !root || !sidebar) return;
    let width = sidebar.offsetWidth;
    let origin = 0;
    const motion = swipeMotion(
      current.current.open ? width : 0,
      (position) => Math.max(0, Math.min(width, position)),
      (position) => {
        root.style.setProperty("--sidebar-position", `${position}px`);
        root.style.setProperty(
          "--sidebar-progress",
          `${position / Math.max(width, 1)}`,
        );
      },
      23,
    );
    const animate = (nextOpen: boolean, velocity = 0) => {
      root.dataset.sidebarMoving = "true";
      motion.settle(nextOpen ? width : 0, velocity, () => {
        delete root.dataset.sidebarMoving;
      });
    };
    settle.current = animate;
    const swipe = listenForHorizontalSwipe(root, {
      capture: true,
      axisRatio: 1.1,
      canStart: (touch, target) => {
        if (
          target instanceof Element &&
          target.closest("input, textarea, select, [contenteditable=true]")
        )
          return false;
        return (
          current.current.open ||
          (current.current.canOpen && touch.clientX <= 28)
        );
      },
      canMove: (dx) =>
        current.current.open ? dx < 0 : dx > 0 && current.current.canOpen,
      begin: () => {
        motion.stop();
        origin = motion.position;
        root.dataset.sidebarMoving = "true";
        current.current.onDragStart();
      },
      move: (dx) => motion.set(origin + dx),
      end: (dx, velocity) => {
        const fast =
          Math.abs(dx) > 20 &&
          Math.abs(velocity) > 0.45 &&
          Math.sign(dx) === Math.sign(velocity);
        const threshold = width * (current.current.open ? 0.68 : 0.32);
        const next = fast
          ? velocity > 0
          : motion.position + velocity * 100 > threshold;
        animate(next, velocity);
        current.current.onChange(next);
      },
      cancel: () => animate(current.current.open),
    });
    const resize = () => {
      width = sidebar.offsetWidth;
      swipe.cancel();
      motion.stop();
      motion.set(current.current.open ? width : 0);
      delete root.dataset.sidebarMoving;
    };
    window.addEventListener("resize", resize);
    return () => {
      swipe.destroy();
      motion.stop();
      settle.current = () => {};
      window.removeEventListener("resize", resize);
      root.style.removeProperty("--sidebar-position");
      root.style.removeProperty("--sidebar-progress");
      delete root.dataset.sidebarMoving;
    };
  }, [mobile]);

  useLayoutEffect(() => settle.current(open), [open, mobile]);
  return { shell, panel };
}
