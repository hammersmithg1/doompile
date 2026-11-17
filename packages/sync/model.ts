import * as Y from "yjs";
import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import type { Attachment, DocumentNode, Note, NoteReplica } from "../core/src/index";
import { createEditorExtensions } from "../editor/src/schema";
import { prepareForEditor, restoreDocument } from "../editor/src/compatibility";
import { digest } from "lib0/hash/sha256";
import { encodeUtf8 } from "lib0/string";

const schema = getSchema(createEditorExtensions());
export const REPLICA_FORMAT = "yjs-1" as const;
export const BODY_FIELD = "body";
export const REMOTE_ORIGIN = "doompile-remote";
const scalarFields = ["kind", "pinned", "urgent", "deletedAt"] as const;
const sourceFields = ["url", "title", "quote", "timestampSeconds", "articleText", "selector"] as const;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const bodyHash = (value: DocumentNode) => encode(digest(encodeUtf8(canonical(value))));
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Browser/Node have these builtins; the native headless host supplies the same
// binary-to-base64 functions without depending on Buffer or a DOM.
export function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function decode(value: string): Uint8Array {
  const padding = value.indexOf("=");
  if (value.length > 16 * 1024 * 1024 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || padding >= 0 && (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding))))
    throw new Error("Invalid replica encoding");
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export function open(replica?: NoteReplica): Y.Doc {
  if (replica && replica.format !== REPLICA_FORMAT) throw new Error("Unsupported replica format");
  const doc = new Y.Doc();
  if (replica?.data) Y.applyUpdate(doc, decode(replica.data), REMOTE_ORIGIN);
  return doc;
}
export function state(doc: Y.Doc, provisional = false): NoteReplica {
  return { format: REPLICA_FORMAT, data: encode(Y.encodeStateAsUpdate(doc)), ...(provisional ? { provisional: true } : {}) };
}
export function sameState(left: NoteReplica, right: NoteReplica): boolean {
  const summary = (replica: NoteReplica) => {
    const decoded = Y.decodeUpdate(decode(replica.data));
    const structs = new Map<number, [number, number][]>();
    for (const item of decoded.structs) {
      if (item instanceof Y.Skip) continue;
      const ranges = structs.get(item.id.client) ?? [];
      const last = ranges.at(-1);
      if (last && last[1] === item.id.clock) last[1] += item.length;
      else ranges.push([item.id.clock, item.id.clock + item.length]);
      structs.set(item.id.client, ranges);
    }
    return {
      structs: [...structs].sort(([a], [b]) => a - b),
      deleted: [...decoded.ds.clients].map(([id, ranges]) => [id, ranges.map(item => [item.clock, item.len])]).sort((a, b) => Number(a[0]) - Number(b[0])),
    };
  };
  // Include unresolved updates too: a snapshot's integrated state vector alone
  // does not account for a packet whose causal predecessor arrives later.
  return equal(summary(left), summary(right));
}
export function stateVector(replica: NoteReplica): string {
  const doc = open(replica);
  try { return encode(Y.encodeStateVector(doc)); }
  finally { doc.destroy(); }
}
export function authoredSnapshot(replica: NoteReplica): string {
  const doc = open(replica);
  try { return encode(Y.encodeSnapshot(Y.snapshot(doc))); }
  finally { doc.destroy(); }
}
export function delta(replica: NoteReplica, baseline?: NoteReplica): string {
  const doc = open(replica), previous = open(baseline);
  try { return encode(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(previous))); }
  finally { doc.destroy(); previous.destroy(); }
}
export function deltaForVector(doc: Y.Doc, vector?: string): string {
  return encode(Y.encodeStateAsUpdate(doc, vector ? decode(vector) : undefined));
}

function setValue(map: Y.Map<unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) {
    if (map.has(key)) map.delete(key);
  } else if (!equal(map.get(key), value)) map.set(key, jsonCopy(value));
}
function childMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) return existing;
  const created = new Y.Map<unknown>(); parent.set(key, created); return created;
}
function reconcileOrder(order: Y.Array<string>, wanted: string[]) {
  const before = order.toArray();
  let leading = 0, trailing = 0;
  while (leading < Math.min(before.length, wanted.length) && before[leading] === wanted[leading]) leading++;
  while (trailing < Math.min(before.length, wanted.length) - leading && before[before.length - trailing - 1] === wanted[wanted.length - trailing - 1]) trailing++;
  const removed = before.length - leading - trailing;
  if (removed) order.delete(leading, removed);
  const added = wanted.slice(leading, wanted.length - trailing);
  if (added.length) order.insert(leading, added);
}
export function body(doc: Y.Doc): DocumentNode {
  const raw = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD)) as JSONContent;
  const attrs = doc.getMap("documentAttrs").toJSON();
  return restoreDocument({ ...raw, ...(Object.keys(attrs).length ? { attrs } : {}) }) as DocumentNode;
}
export function setBody(doc: Y.Doc, value: DocumentNode) {
  if (equal(body(doc), value)) return;
  const prepared = prepareForEditor(value as JSONContent, schema);
  const attrs = doc.getMap("documentAttrs");
  for (const key of [...attrs.keys()]) if (!(key in (prepared.attrs ?? {}))) attrs.delete(key);
  for (const [key, item] of Object.entries(prepared.attrs ?? {})) setValue(attrs, key, item);
  prosemirrorJSONToYXmlFragment(schema, prepared, doc.getXmlFragment(BODY_FIELD));
}
export function documentPlainText(node: DocumentNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "noteReference") return String(node.attrs?.title || "Заметка");
  const ignored = new Set(["sourceSnippet", "attachment", "image", "recording"]);
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    const mediaOnly = child.type === "paragraph" && !!child.content?.length && child.content.every(item => ignored.has(item.type));
    if (!mediaOnly && !ignored.has(child.type)) parts.push(documentPlainText(child));
  }
  return parts.join(["paragraph", "heading", "codeBlock"].includes(node.type) ? "" : node.type === "tableRow" ? "\t" : "\n");
}
export function documentTitle(value: DocumentNode, fallback = ""): string {
  const text = (node: DocumentNode): string => node.type === "sourceSnippet" ? "" : node.type === "noteReference" ? String(node.attrs?.title || "") : node.text ?? node.content?.map(text).join("") ?? "";
  const result = (value.content?.map(text).find(item => item.trim()) ?? fallback).slice(0, 160);
  return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
}

/** Apply only the edits made against this exact replica, then merge elsewhere. */
export function applySnapshot(doc: Y.Doc, note: Note) {
  const meta = doc.getMap("note");
  const id = meta.get("id");
  if (id && id !== note.id) throw new Error("Replica belongs to another note");
  doc.transact(() => {
    if (!id) { meta.set("id", note.id); meta.set("createdAt", note.createdAt); }
    const derivedTitle = documentTitle(note.body);
    if (!meta.has("autoTitle")) {
      meta.set("autoTitle", note.title === derivedTitle);
      meta.set("title", note.title);
    } else if (meta.get("autoTitle") !== true) {
      if (note.title === derivedTitle) meta.set("autoTitle", true);
      else setValue(meta, "title", note.title);
    }
    for (const key of scalarFields) setValue(meta, key, note[key]);
    const tags = doc.getMap<boolean>("tags"), wantedTags = new Set(note.tags);
    for (const tag of [...tags.keys()]) if (!wantedTags.has(tag)) tags.delete(tag);
    for (const tag of wantedTags) if (!tags.has(tag)) tags.set(tag, true);
    reconcileOrder(doc.getArray<string>("tagOrder"), note.tags);
    const source = doc.getMap("source");
    for (const key of sourceFields) setValue(source, key, note.source?.[key]);
    const attachments = doc.getMap<unknown>("attachments"), wantedIDs = new Set(note.attachments.map(file => file.id));
    for (const id of [...attachments.keys()]) if (!wantedIDs.has(id)) attachments.delete(id);
    for (const file of note.attachments) {
      const record = childMap(attachments, file.id);
      for (const key of ["id", "name", "mimeType", "url", "size"] as const) setValue(record, key, file[key]);
    }
    reconcileOrder(doc.getArray<string>("attachmentOrder"), note.attachments.map(file => file.id));
    setBody(doc, note.body);
    // Older captures may have a separately authored caption/plain-text value.
    // Retain it while that body is unchanged instead of discarding it on import.
    const actualBody = body(doc), cachedText = doc.getMap("legacyText");
    if (note.plainText !== documentPlainText(actualBody)) {
      setValue(cachedText, "text", note.plainText);
      setValue(cachedText, "bodyHash", bodyHash(actualBody));
    } else {
      for (const key of [...cachedText.keys()]) cachedText.delete(key);
    }
  }, "doompile-snapshot");
}
export function project(doc: Y.Doc, previous?: Partial<Note>, provisional = false): Note {
  const meta = doc.getMap("note"), document = body(doc);
  const id = meta.get("id"), createdAt = meta.get("createdAt");
  if (typeof id !== "string" || typeof createdAt !== "string") throw new Error("Incomplete note replica");
  const records = doc.getMap<unknown>("attachments");
  const ordered = [...new Set([...doc.getArray<string>("attachmentOrder").toArray(), ...[...records.keys()].sort()])];
  const attachments = ordered.flatMap(key => {
    const item = records.get(key);
    return item instanceof Y.Map ? [item.toJSON() as Attachment] : [];
  });
  const source = doc.getMap("source").toJSON();
  const cachedText = doc.getMap("legacyText");
  const plainText = cachedText.has("bodyHash") && cachedText.get("bodyHash") === bodyHash(document) && typeof cachedText.get("text") === "string"
    ? cachedText.get("text") as string : documentPlainText(document);
  return {
    id, createdAt, updatedAt: previous?.updatedAt ?? createdAt, revision: previous?.revision ?? 0,
    title: meta.get("autoTitle") === true
      ? documentTitle(document, String(source.title || source.url || attachments[0]?.name || ""))
      : String(meta.get("title") ?? ""),
    kind: String(meta.get("kind") ?? "note") as Note["kind"],
    pinned: meta.get("pinned") === true, urgent: meta.get("urgent") === true,
    tags: [...new Set([...doc.getArray<string>("tagOrder").toArray(), ...[...doc.getMap<boolean>("tags").keys()].sort()])].filter(tag => doc.getMap<boolean>("tags").has(tag)), attachments,
    ...(typeof source.url === "string" ? { source: source as Note["source"] } : {}),
    ...(typeof meta.get("deletedAt") === "string" ? { deletedAt: meta.get("deletedAt") as string } : {}),
    body: document, plainText, replica: state(doc, provisional),
  };
}
export function prepare(note: Note): Note {
  const doc = open(note.replica);
  try { applySnapshot(doc, note); return project(doc, note, note.replica?.provisional); }
  finally { doc.destroy(); }
}
export function merge(current: Note, remote: Note): Note {
  if (current.id !== remote.id || !remote.replica) throw new Error("Cannot merge unrelated or legacy notes");
  const local = prepare(current), doc = open(local.replica);
  try {
    Y.applyUpdate(doc, decode(remote.replica.data), REMOTE_ORIGIN);
    return project(doc, {
      revision: Math.max(current.revision, remote.revision),
      updatedAt: current.updatedAt > remote.updatedAt ? current.updatedAt : remote.updatedAt,
    }, local.replica?.provisional);
  } finally { doc.destroy(); }
}
export function applyUpdate(current: Note, update: string, revision: number, updatedAt: string): Note {
  const local = prepare(current), doc = open(local.replica);
  try {
    Y.applyUpdate(doc, decode(update), REMOTE_ORIGIN);
    return project(doc, { revision: Math.max(current.revision, revision), updatedAt }, local.replica?.provisional);
  } finally { doc.destroy(); }
}
export function validateView(doc: Y.Doc) {
  // Check before applying an update to a live editor: an old schema must never
  // normalize away unknown shared content and send that deletion to its peers.
  const raw = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD));
  schema.nodeFromJSON(raw).check();
}
