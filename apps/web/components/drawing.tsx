"use client";
import { useRef, useState } from "react";
import { Undo2, X, Check } from "../../../packages/design/ui-icons";
export default function Drawing({
  onSave,
  onClose,
}: {
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) * c.width) / rect.width,
      ((e.clientY - rect.top) * c.height) / rect.height,
    ];
  }
  return (
    <div className="modal-backdrop drawing-backdrop">
      <div
        className="drawing-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Рисунок"
      >
        <div className="modal-top">
          <strong>Дай мысли форму</strong>
          <button
            className="icon-button"
            aria-label="Закрыть рисунок"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <canvas
          ref={canvas}
          width={1000}
          height={640}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const ctx = canvas.current!.getContext("2d")!;
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.strokeStyle = "#1a1a1a";
            ctx.beginPath();
            const [x, y] = point(e);
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = point(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <div className="drawing-footer">
          <button
            className="quiet-button"
            onClick={() =>
              canvas.current!.getContext("2d")!.clearRect(0, 0, 1000, 640)
            }
          >
            <Undo2 size={16} />
            Очистить
          </button>
          <span role="alert">{error}</span>
          <button
            className="lime-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              canvas.current!.toBlob(async (blob) => {
                try {
                  if (blob) await onSave(blob);
                  onClose();
                } catch {
                  setError("Не удалось загрузить рисунок");
                  setBusy(false);
                }
              }, "image/png");
            }}
          >
            <Check size={16} />
            {busy ? "Сохраняем…" : "Добавить рисунок"}
          </button>
        </div>
      </div>
    </div>
  );
}
