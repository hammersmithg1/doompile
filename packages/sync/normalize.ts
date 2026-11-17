import type { DocumentNode, Note } from "../core/src/index";
import { prepareDocument } from "../editor/src/blocks";

export function prepareLegacy(note: Note): Note {
  const withMetadata = (node: DocumentNode): DocumentNode => {
    const url = node.attrs?.src || node.attrs?.url;
    const file = note.attachments.find(item => item.url === url);
    const attrs = file && (node.type === "image" || node.type === "attachment") && (node.attrs?.id !== file.id || node.attrs?.size !== file.size)
      ? { ...node.attrs, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size } : node.attrs;
    return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(withMetadata) } : {}) };
  };
  const text = (node: DocumentNode): string => node.type === "sourceSnippet" ? "" : node.text ?? node.content?.map(text).join("") ?? "";
  const first = note.body.content?.map(text).find(value => value.trim()) ?? "";
  // Generated titles are prefixes, not a separately authored heading.
  const prefix = (length: number) => { const value = first.slice(0, length); return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value; };
  const generated = note.title === prefix(120) || note.title === prefix(160);
  const document = withMetadata(prepareDocument(note.body, generated ? "" : note.title, note.source) as DocumentNode);
  const urls = new Set<string>();
  const visit = (node: DocumentNode) => { for (const key of ["src", "url"]) if (typeof node.attrs?.[key] === "string") urls.add(node.attrs[key] as string); node.content?.forEach(visit); };
  visit(document);
  const missing = note.attachments.filter(file => !urls.has(file.url));
  return { ...note, body: { ...document, attrs: { ...document.attrs, attachmentRecoveryVersion: 1 }, content: [...(document.content ?? []), ...missing.map(file => ({ type: "paragraph", content: [{ type: file.mimeType.startsWith("image/") ? "image" : "attachment", attrs: file.mimeType.startsWith("image/") ? { ...file, src: file.url, alt: file.name } : { ...file } }] }))] } };
}

