"use client";
import { useRef, useState, type ReactNode } from "react";
import { Pin, Flame,  Trash2 } from "../../../packages/design/ui-icons";

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
}: {
  mobile: boolean;
  bareDesktop?: boolean;
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
  const start = useRef<{
    x: number;
    y: number;
    offset: number;
    axis?: string;
  } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const suppress = useRef(false);
  const offset = drag ?? (openId === id ? -156 : 0);
  if (!mobile) return bareDesktop ? <>{children}</> : <div>{children}</div>;
  return (
    <div className="mobile-note-row" data-revealed={openId === id}>
      <div
        className="mobile-row-actions"
        inert={openId !== id}
        aria-hidden={openId !== id}
      >
        <button
          aria-label={pinned ? "Открепить заметку" : "Закрепить заметку"}
          onClick={() => {
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
        className={`mobile-row-content ${drag !== null ? "is-dragging" : ""}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onTouchStart={(e) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          start.current = {
            x: t.clientX,
            y: t.clientY,
            offset: openId === id ? -156 : 0,
          };
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const t = e.touches[0],
            dx = t.clientX - s.x,
            dy = t.clientY - s.y;
          if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10)
            s.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
          if (s.axis === "x") {
            suppress.current = true;
            setDrag(Math.min(0, Math.max(-156, s.offset + dx)));
          }
        }}
        onTouchEnd={() => {
          if (start.current?.axis === "x") {
            onOpen((drag ?? 0) < -65 ? id : null);
            setTimeout(() => {
              suppress.current = false;
            }, 0);
          }
          start.current = null;
          setDrag(null);
        }}
        onTouchCancel={() => {
          start.current = null;
          setDrag(null);
          suppress.current = false;
        }}
        onClickCapture={(e) => {
          if (suppress.current || openId === id) {
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
