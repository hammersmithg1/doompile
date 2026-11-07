import type { Note, DocumentNode } from "@doompile/core";
import { NOTE_LIMITS } from "@doompile/core";
import {
  prepareDocument,
  documentSource,
} from "../../../../packages/editor/src/blocks";
export function documentMediaURLs(body: DocumentNode) {
  const urls = new Set<string>();
  const visit = (node: DocumentNode) => {
    if (typeof node.attrs?.url === "string") urls.add(node.attrs.url);
    if (typeof node.attrs?.src === "string") urls.add(node.attrs.src);
    node.content?.forEach(visit);
  };
  visit(body);
  return urls;
}
export function editableNote(note: Note): Note {
  const body = prepareDocument(
    note.body,
    note.title,
    note.source,
  ) as DocumentNode;
  const urls = documentMediaURLs(body);
  const missing = note.attachments.filter((file) => !urls.has(file.url));
  return {
    ...note,
    body: missing.length
      ? {
          ...body,
          content: [
            ...(body.content || []),
            ...missing.map((file) =>
              file.mimeType.startsWith("image/")
                ? { type: "image", attrs: { src: file.url, alt: file.name } }
                : {
                    type: "attachment",
                    attrs: {
                      url: file.url,
                      name: file.name,
                      mimeType: file.mimeType,
                    },
                  },
            ),
            { type: "paragraph" },
          ],
        }
      : body,
  };
}
export function noteForEditorSave(editor: Note, editTags: string): Note {
  const source = editor.source || documentSource(editor.body);
  return {
    ...editor,
    source,
    title: editorTitle(
      editor.body,
      source?.title || source?.url || editor.attachments[0]?.name || "",
    ),
    tags: [
      ...new Set(
        editTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function editorContentKey(note: Note, tags = note.tags) {
  return JSON.stringify({
    body: note.body,
    plainText: note.plainText,
    attachments: note.attachments,
    source: note.source || documentSource(note.body),
    tags,
    pinned: note.pinned,
    urgent: note.urgent,
  });
}
export function editorTitle(body: DocumentNode, fallback: string): string {
  const text = (node: DocumentNode): string =>
    node.type === "sourceSnippet"
      ? ""
      : node.type === "noteReference"
        ? String(node.attrs?.title || "Заметка")
        : node.text || node.content?.map(text).join("") || "";
  return (
    body.content?.map(text).find((value) => value.trim()) || fallback
  ).slice(0, NOTE_LIMITS.generatedTitle);
}
