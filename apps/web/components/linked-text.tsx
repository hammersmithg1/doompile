"use client";
import { Fragment } from "react";
export function splitLinks(text: string) {
  const result: { text: string; href?: string }[] = [];
  const expression = /(?:https?:\/\/|www\.)[^\s<>"']+/giu;
  let end = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index!;
    if (start > end) result.push({ text: text.slice(end, start) });
    let value = match[0].replace(/[.,!?;:]+$/u, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ])
      while (
        value.endsWith(close) &&
        value.split(close).length > value.split(open).length
      )
        value = value.slice(0, -1);
    try {
      const url = new URL(
        value.startsWith("www.") ? "https://" + value : value,
      );
      result.push({ text: value, href: url.href });
    } catch {
      result.push({ text: value });
    }
    end = start + value.length;
  }
  if (end < text.length) result.push({ text: text.slice(end) });
  return result;
}
export default function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a
            className="snippet-link"
            key={i}
            href={part.href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
