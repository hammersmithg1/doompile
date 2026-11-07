"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, FileText } from "../../../packages/design/ui-icons";
import LinkedText from "./linked-text";
/** Count rendered lines, including wrapping, so resizing a pane preserves the 20-line rule. */
export default function NoteExcerpt({
  text,
  comment = false,
}: {
  text: string;
  comment?: boolean;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(text.split("\n").length > 20);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const display = node.style.display,
        clamp = node.style.webkitLineClamp;
      node.style.display = "block";
      node.style.webkitLineClamp = "unset";
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
      const lines = Math.round(
        node.getBoundingClientRect().height / lineHeight,
      );
      node.style.display = display;
      node.style.webkitLineClamp = clamp;
      setLong(lines > 20);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div
      className={`note-preview ${long ? "note-preview--long" : ""} ${comment ? "note-preview--comment" : ""}`}
    >
      {long && (
        <span className="note-preview-label">
          <FileText size={12} />
          Заметка
        </span>
      )}
      <p ref={ref} className="note-preview-text">
        <LinkedText text={text} />
      </p>
      {long && (
        <span className="note-preview-more">
          Читать дальше <ArrowUpRight size={13} />
        </span>
      )}
    </div>
  );
}
