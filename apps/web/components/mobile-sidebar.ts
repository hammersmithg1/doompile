"use client";
import { useLayoutEffect, useRef } from "react";

/** Drag in pixels, then settle with the finger's release velocity. */
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
    let width = sidebar.getBoundingClientRect().width;
    let position = current.current.open ? width : 0;
    let velocity = 0;
    let frame = 0;
    let target: number | null = null;
    let gesture: {
      x: number;
      y: number;
      position: number;
      lastX: number;
      lastTime: number;
      velocity: number;
      axis?: "x" | "y";
      identifier: number;
    } | null = null;
    const paint = () => {
      root.style.setProperty("--sidebar-offset", `${position - width}px`);
      root.style.setProperty("--sidebar-progress", `${position / width}`);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      target = null;
    };
    const animate = (nextOpen: boolean, releaseVelocity = 0) => {
      const nextTarget = nextOpen ? width : 0;
      if (frame && target === nextTarget) return;
      stop();
      target = nextTarget;
      velocity = releaseVelocity;
      if (
        position === nextTarget ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        position = nextTarget;
        paint();
        delete root.dataset.sidebarMoving;
        return;
      }
      root.dataset.sidebarMoving = "true";
      let lastTime = performance.now();
      const tick = (now: number) => {
        const dt = Math.max(0, now - lastTime) / 1000;
        lastTime = now;
        // Solve a critically damped spring analytically so dropped frames do
        // not slow the motion down or make it unstable on a busy phone.
        const displacement = position - nextTarget;
        const momentum = velocity + 20 * displacement;
        const decay = Math.exp(-20 * dt);
        position = nextTarget + (displacement + momentum * dt) * decay;
        velocity = (velocity - 20 * momentum * dt) * decay;
        position = Math.max(0, Math.min(width, position));
        if (Math.abs(nextTarget - position) < 0.3 && Math.abs(velocity) < 3) {
          position = nextTarget;
          stop();
          delete root.dataset.sidebarMoving;
        } else {
          frame = requestAnimationFrame(tick);
        }
        paint();
      };
      frame = requestAnimationFrame(tick);
    };
    settle.current = (nextOpen) => animate(nextOpen);
    paint();

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (gesture) animate(current.current.open);
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      if (
        !current.current.open &&
        (!current.current.canOpen || touch.clientX > 28)
      )
        return;
      width = sidebar.getBoundingClientRect().width;
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        position,
        lastX: touch.clientX,
        lastTime: performance.now(),
        velocity: 0,
        identifier: touch.identifier,
      };
    };
    const moveTo = (touch: Touch) => {
      const g = gesture;
      if (!g) return;
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      if (!g.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        if (g.axis === "x") {
          stop();
          root.dataset.sidebarMoving = "true";
          current.current.onDragStart();
        }
      }
      if (g.axis !== "x") return false;
      const now = performance.now();
      const elapsed = Math.max(1, now - g.lastTime);
      if (touch.clientX !== g.lastX) {
        g.velocity = Math.max(
          -2.5,
          Math.min(2.5, (touch.clientX - g.lastX) / elapsed),
        );
        g.lastX = touch.clientX;
        g.lastTime = now;
      }
      position = Math.max(0, Math.min(width, g.position + dx));
      paint();
      return true;
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {
        gesture = null;
        animate(current.current.open);
        return;
      }
      const touch = event.touches[0];
      if (touch.identifier === gesture.identifier && moveTo(touch)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const end = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      const touch = Array.from(event.changedTouches).find(
        (t) => t.identifier === g.identifier,
      );
      if (!touch) return;
      moveTo(touch);
      gesture = null;
      if (g.axis !== "x") return;
      event.preventDefault();
      event.stopPropagation();
      const speed = performance.now() - g.lastTime < 100 ? g.velocity : 0;
      const nextOpen = position + speed * 180 > width / 2;
      animate(nextOpen, speed * 1000);
      current.current.onChange(nextOpen);
    };
    const cancel = () => {
      if (!gesture) return;
      gesture = null;
      animate(current.current.open);
    };
    const resize = () => {
      width = sidebar.getBoundingClientRect().width;
      gesture = null;
      stop();
      position = current.current.open ? width : 0;
      delete root.dataset.sidebarMoving;
      paint();
    };
    // Native non-passive listeners let horizontal drags own the gesture while
    // vertical scrolling and pinch zoom remain available to the browser.
    root.addEventListener("touchstart", start, {
      capture: true,
      passive: true,
    });
    root.addEventListener("touchmove", move, { capture: true, passive: false });
    root.addEventListener("touchend", end, { capture: true, passive: false });
    root.addEventListener("touchcancel", cancel, true);
    window.addEventListener("resize", resize);
    return () => {
      stop();
      settle.current = () => {};
      root.removeEventListener("touchstart", start, true);
      root.removeEventListener("touchmove", move, true);
      root.removeEventListener("touchend", end, true);
      root.removeEventListener("touchcancel", cancel, true);
      window.removeEventListener("resize", resize);
      root.style.removeProperty("--sidebar-offset");
      root.style.removeProperty("--sidebar-progress");
      delete root.dataset.sidebarMoving;
    };
  }, [mobile]);

  useLayoutEffect(() => settle.current(open), [open, mobile]);
  return { shell, panel };
}
