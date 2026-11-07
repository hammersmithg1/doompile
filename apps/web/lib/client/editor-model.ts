import type { Attachment, Note, DocumentNode } from "@doompile/core";
import { documentText, NOTE_LIMITS, textToDocument } from "@doompile/core";
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

export function compactDraftDocument(
  note: Note,
  text: string,
  attachments: Attachment[],
): DocumentNode {
  const removed = new Set(
    note.attachments
      .filter(
        (attachment) => !attachments.some((file) => file.id === attachment.id),
      )
      .map((attachment) => attachment.url),
  );
  const removeMedia = (node: DocumentNode): DocumentNode =>
    node.content
      ? {
          ...node,
          content: node.content
            .filter(
              (child) =>
                !removed.has(String(child.attrs?.url || child.attrs?.src)),
            )
            .map(removeMedia),
        }
      : node;
  const body = removeMedia(note.body);
  if (text === note.plainText.trim()) return body;

  // The compact field edits plain text. Preserve rich blocks on either side
  // of the changed lines and keep standalone media in their original order.
  const blocks = body.content || [];
  const blockLines = blocks.map((block) => {
    const value = documentText(block);
    return !value && documentMediaURLs(block).size ? [] : value.split("\n");
  });
  const before = note.plainText.trim().split("\n");
  const after = text.split("\n");
  if (blockLines.flat().join("\n").trim() !== note.plainText.trim())
    return textToDocument(text);
  let leading = 0;
  while (
    leading < Math.min(before.length, after.length) &&
    before[leading] === after[leading]
  )
    leading++;
  let trailing = 0;
  while (
    trailing < Math.min(before.length, after.length) - leading &&
    before[before.length - 1 - trailing] === after[after.length - 1 - trailing]
  )
    trailing++;
  let line = 0;
  let inserted = false;
  const changed = after.slice(leading, after.length - trailing);
  const paragraphs = (lines: string[]) =>
    lines.length ? textToDocument(lines.join("\n")).content || [] : [];
  const content = blocks.flatMap((block, index) => {
    const lines = blockLines[index];
    if (!lines.length) return [block];
    const start = line;
    line += lines.length;
    if (line <= leading) return [block];
    if (start >= before.length - trailing) {
      if (inserted) return [block];
      inserted = true;
      return [...paragraphs(changed), block];
    }
    const replacement = [
      ...lines.slice(0, Math.max(0, leading - start)),
      ...(!inserted ? changed : []),
      ...lines.slice(Math.max(0, before.length - trailing - start)),
    ];
    inserted = true;
    return paragraphs(replacement);
  });
  if (!inserted) content.push(...paragraphs(changed));
  return { ...body, content };
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
