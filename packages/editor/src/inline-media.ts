import type { JSONContent } from "@tiptap/core";

export const mediaTypes = new Set([
  "image",
  "attachment",
  "sourceSnippet",
  "recording",
]);

/** Older documents stored media as blocks. Keep their line breaks and all attrs. */
export function normalizeMedia(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const inlineParent = ["paragraph", "heading"].includes(node.type || "");
  return {
    ...node,
    content: node.content.map((child) => {
      const normalized = normalizeMedia(child);
      return !inlineParent && mediaTypes.has(child.type || "")
        ? { type: "paragraph", content: [normalized] }
        : normalized;
    }),
  };
}

export function pastedMedia(
  body: JSONContent,
): { id: string; url: string; name: string; mimeType: string; size: number }[] {
  const result = new Map<string, ReturnType<typeof pastedMedia>[number]>();
  const walk = (node: JSONContent) => {
    const a = node.attrs || {},
      src =
        node.type === "image" ? a.src : node.type === "attachment" ? a.url : "";
    if (typeof src === "string" && src) {
      const id =
        a.id ||
        /(?:\/api\/attachments\/|local:)([\da-f-]{36})$/i.exec(src)?.[1];
      if (id)
        result.set(id, {
          id,
          url: src,
          name: a.name || a.alt || "Вложение",
          mimeType:
            a.mimeType ||
            (node.type === "image" ? "image/png" : "application/octet-stream"),
          size: Number(a.size) || 0,
        });
    }
    node.content?.forEach(walk);
  };
  walk(body);
  return [...result.values()];
}
