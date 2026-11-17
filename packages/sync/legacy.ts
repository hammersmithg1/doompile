import type { DocumentNode, Note } from "../core/src/index";
import { body, documentPlainText, equal, merge, open, prepare, project, setBody } from "./model";
import { prepareDocument } from "../editor/src/blocks";

export function prepareLegacy(note: Note): Note {
  const withMetadata = (node: DocumentNode): DocumentNode => {
    const url = node.attrs?.src || node.attrs?.url;
    const file = note.attachments.find(item => item.url === url);
    const attrs = file && (node.type === "image" || node.type === "attachment") && (node.attrs?.id !== file.id || node.attrs?.size !== file.size)
      ? { ...node.attrs, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size } : node.attrs;
    return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(withMetadata) } : {}) };
  };
  const document = withMetadata(prepareDocument(note.body, note.title, note.source) as DocumentNode);
  const urls = new Set<string>();
  const visit = (node: DocumentNode) => { for (const key of ["src", "url"]) if (typeof node.attrs?.[key] === "string") urls.add(node.attrs[key] as string); node.content?.forEach(visit); };
  visit(document);
  const missing = note.attachments.filter(file => !urls.has(file.url));
  return { ...note, body: { ...document, attrs: { ...document.attrs, attachmentRecoveryVersion: 1 }, content: [...(document.content ?? []), ...missing.map(file => ({ type: "paragraph", content: [{ type: file.mimeType.startsWith("image/") ? "image" : "attachment", attrs: file.mimeType.startsWith("image/") ? { ...file, src: file.url, alt: file.name } : { ...file } }] }))] } };
}

/** One-time bridge for pre-replica caches. Never union independently seeded Y docs. */
export function migrateSnapshot(local: Note, remote: Note, baseline?: Note): Note {
  if (!remote.replica) throw new Error("Canonical note state is required");
  local = prepareLegacy(local);
  if (baseline) baseline = prepareLegacy(baseline);
  const doc = open(remote.replica);
  try {
    if (baseline) {
      const base = prepare({ ...baseline, replica: undefined });
      const left = prepare({ ...remote, replica: base.replica });
      const right = prepare({ ...local, replica: base.replica });
      const combined = merge(left, right);
      return prepare({ ...combined, replica: remote.replica, revision: remote.revision, updatedAt: local.updatedAt });
    }
    // A cache older than the first recorded server version has no recoverable
    // ancestor. Preserve unique blocks and both raw snapshots in history.
    const current = body(doc), content = [...(current.content ?? [])];
    for (const block of local.body.content ?? []) if (!content.some(existing => equal(existing, block))) content.push(block);
    const mergedBody: DocumentNode = { ...current, content };
    setBody(doc, mergedBody);
    const combined = project(doc, remote);
    return prepare({ ...combined, updatedAt: local.updatedAt, plainText: documentPlainText(mergedBody),
      tags: [...new Set([...remote.tags, ...local.tags])],
      attachments: [...remote.attachments, ...local.attachments.filter(file => !remote.attachments.some(other => other.id === file.id))],
      pinned: local.pinned || remote.pinned, urgent: local.urgent || remote.urgent,
    });
  } finally { doc.destroy(); }
}
