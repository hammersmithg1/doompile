"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Pin, Flame, Trash2 } from "../../../packages/design/ui-icons";
import { listenForHorizontalSwipe, swipeMotion } from "./mobile-swipe";

const actionWidth = 156;
const overshoot = 18;

export default function MobileNoteRow({
  children,
  id,
  openId,
  onOpen,
  pinned,
  urgent,
  onPin,
  onUrgent,
  onDelete,
  mobile,
  bareDesktop,
  disabled,
}: {
  mobile: boolean;
  bareDesktop?: boolean;
  disabled?: boolean;
  children: ReactNode;
  id: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
  pinned: boolean;
  urgent: boolean;
  onPin: () => void;
  onUrgent: () => void;
  onDelete: () => void;
}) {
  const revealed = openId === id;
  const row = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const current = useRef({ revealed, id, onOpen });
  current.current = { revealed, id, onOpen };
  const settle = useRef<(reveal: boolean) => void>(() => {});
  useLayoutEffect(() => {
    if (!mobile || disabled || !row.current || !content.current) return;
    const root = row.current;
    let origin = 0;
    const motion = swipeMotion(
      current.current.revealed ? -actionWidth : 0,
      (position) => Math.max(-actionWidth - overshoot, Math.min(0, position)),
      (position) => {
        root.style.setProperty("--row-position", `${position}px`);
        root.style.setProperty(
          "--row-progress",
          `${Math.min(1, -position / actionWidth)}`,
        );
      },
      27,
    );
    const animate = (next: boolean, velocity = 0) =>
      motion.settle(next ? -actionWidth : 0, velocity);
    settle.current = animate;
    const swipe = listenForHorizontalSwipe(content.current, {
      canStart: (_touch, target) =>
        !(
          target instanceof Element && target.closest("a, button, audio, video")
        ),
      canMove: (dx) => dx < 0 || current.current.revealed,
      begin: () => {
        motion.stop();
        origin = motion.position;
      },
      move: (dx) => {
        const position = origin + dx;
        const excess = Math.max(0, -actionWidth - position);
        motion.set(
          Math.max(-actionWidth, position) -
            overshoot * (1 - Math.exp(-excess / 50)),
        );
      },
      end: (dx, velocity) => {
        const { revealed, id, onOpen } = current.current;
        const next =
          Math.abs(dx) < 18
            ? revealed
            : motion.position + velocity * 75 < -actionWidth * 0.46;
        animate(next, velocity);
        if (next && !revealed) navigator.vibrate?.(8);
        if (next !== revealed) onOpen(next ? id : null);
      },
      cancel: () => animate(current.current.revealed),
    });
    return () => {
      swipe.destroy();
      motion.stop();
      settle.current = () => {};
    };
  }, [mobile, disabled]);
  useLayoutEffect(() => settle.current(revealed), [revealed, mobile]);
  if (!mobile) return bareDesktop ? <>{children}</> : <div>{children}</div>;
  return (
    <div ref={row} className="mobile-note-row" data-revealed={revealed}>
      <div
        className="mobile-row-actions"
        inert={!revealed}
        aria-hidden={!revealed}
      >
        <button
          aria-label={pinned ? "Открепить заметку" : "Закрепить заметку"}
          onClick={() => {
            navigator.vibrate?.(10);
            onOpen(null);
            onPin();
          }}
        >
          <Pin size={20} fill={pinned ? "currentColor" : "none"} />
        </button>
        <button
          aria-label={
            urgent ? "Убрать заметку из важного" : "Отметить заметку важной"
          }
          onClick={() => {
            navigator.vibrate?.(10);
            onOpen(null);
            onUrgent();
          }}
        >
          <Flame size={20} />
        </button>
        <button
          aria-label="Удалить заметку свайпом"
          onClick={() => {
            onOpen(null);
            onDelete();
          }}
        >
          <Trash2 size={19} />
        </button>
      </div>
      <div
        ref={content}
        className="mobile-row-content"
        onClickCapture={(e) => {
          if (revealed) {
            e.stopPropagation();
            e.preventDefault();
            onOpen(null);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
