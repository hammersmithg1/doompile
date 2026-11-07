import { z } from "zod";
import { NOTE_LIMITS } from "./contracts";
export * from "./contracts";

export interface DocumentNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocumentNode[];
}

const safeURL = z
  .string()
  .max(NOTE_LIMITS.url)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Expected an HTTP(S) URL");
const isoDate = z.string().datetime({ offset: true });
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(NOTE_LIMITS.attachmentName),
  mimeType: z.string().min(1).max(NOTE_LIMITS.mimeType),
  url: z
    .string()
    .max(NOTE_LIMITS.url)
    .refine(
      (value) =>
        /^\/api\/attachments\/[0-9a-f-]{36}$/i.test(value) ||
        safeURL.safeParse(value).success,
      "Invalid attachment URL",
    ),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const sourceSchema = z.object({
  url: safeURL,
  title: z.string().max(NOTE_LIMITS.title).optional(),
  quote: z.string().max(NOTE_LIMITS.quote).optional(),
  timestampSeconds: z
    .number()
    .min(0)
    .max(NOTE_LIMITS.timestampSeconds)
    .optional(),
  articleText: z.string().max(NOTE_LIMITS.plainText).optional(),
  selector: z.unknown().optional(),
});
export type NoteSource = z.infer<typeof sourceSchema>;

function isDocument(value: unknown): value is DocumentNode {
  let count = 0;
  const record = (input: unknown): input is Record<string, unknown> =>
    typeof input === "object" && input !== null && !Array.isArray(input);
  const attributes = (input: unknown): boolean => {
    if (!record(input)) return false;
    for (const key of [
      "src",
      "url",
      "href",
      "alt",
      "name",
      "mimeType",
      "title",
      "id",
    ])
      if (
        input[key] !== undefined &&
        input[key] !== null &&
        typeof input[key] !== "string"
      )
        return false;
    if (input.checked !== undefined && typeof input.checked !== "boolean")
      return false;
    for (const key of ["level", "colspan", "rowspan"])
      if (
        input[key] !== undefined &&
        (!Number.isInteger(input[key]) ||
          Number(input[key]) < 1 ||
          Number(input[key]) > 1000)
      )
        return false;
    return true;
  };
  const visit = (node: unknown, depth: number): boolean => {
    if (
      ++count > NOTE_LIMITS.documentNodes ||
      depth > NOTE_LIMITS.documentDepth ||
      !record(node)
    )
      return false;
    const object = node;
    if (typeof object.type !== "string" || object.type.length > 100)
      return false;
    if (object.text !== undefined && typeof object.text !== "string")
      return false;
    if (object.attrs !== undefined && !attributes(object.attrs)) return false;
    if (
      object.marks !== undefined &&
      (!Array.isArray(object.marks) ||
        object.marks.length > 100 ||
        !object.marks.every(
          (mark) =>
            record(mark) &&
            typeof mark.type === "string" &&
            mark.type.length <= 100 &&
            (mark.attrs === undefined || attributes(mark.attrs)),
        ))
    )
      return false;
    if (
      object.content !== undefined &&
      (!Array.isArray(object.content) ||
        !object.content.every((child) => visit(child, depth + 1)))
    )
      return false;
    return true;
  };
  return visit(value, 0) && (value as DocumentNode).type === "doc";
}

export const noteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(NOTE_LIMITS.title),
  body: z.custom<DocumentNode>(isDocument, "Expected a bounded document tree"),
  plainText: z.string().max(NOTE_LIMITS.plainText),
  tags: z
    .array(z.string().trim().min(1).max(NOTE_LIMITS.tagLength))
    .max(NOTE_LIMITS.tags)
    .transform((tags) => [...new Set(tags)]),
  pinned: z.boolean(),
  urgent: z.boolean(),
  kind: z.enum(["note", "article", "video", "image", "audio", "file"]),
  source: sourceSchema.optional(),
  attachments: z.array(attachmentSchema).max(NOTE_LIMITS.attachments),
  createdAt: isoDate,
  updatedAt: isoDate,
  deletedAt: isoDate.nullish(),
  revision: z.number().int().min(0),
});
export type Note = z.infer<typeof noteSchema>;

export function textToDocument(text: string): DocumentNode {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function documentText(node: DocumentNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  const block = [
    "doc",
    "bulletList",
    "orderedList",
    "taskList",
    "blockquote",
    "table",
    "tableRow",
  ].includes(node.type);
  return children.map(documentText).join(block ? "\n" : "");
}

/** Normalize metadata without truncating authored document/text or dropping attachments. */
export function normalizeNote(note: Note): Note {
  return {
    ...note,
    title: note.title
      .slice(0, NOTE_LIMITS.title)
      .replace(/[\uD800-\uDBFF]$/, ""),
    tags: [...new Set(note.tags.map((tag) => tag.trim()).filter(Boolean))],
  };
}

export function createNote(input: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  const text = input.plainText ?? "";
  return normalizeNote({
    id: crypto.randomUUID(),
    title: text.split("\n")[0].slice(0, NOTE_LIMITS.generatedTitle),
    body: textToDocument(text),
    plainText: text,
    tags: [],
    pinned: false,
    urgent: false,
    kind: "note",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    revision: 0,
    ...input,
  });
}

export function timestampFromURL(value: string): number | undefined {
  try {
    const url = new URL(value);
    const raw =
      url.searchParams.get("t") ??
      url.searchParams.get("start") ??
      new URLSearchParams(url.hash.slice(1)).get("t");
    if (!raw) return undefined;
    if (/^\d+(?:\.\d+)?s?$/.test(raw))
      return Math.floor(Number(raw.replace(/s$/, "")));
    const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return match && match[0]
      ? Number(match[1] ?? 0) * 3600 +
          Number(match[2] ?? 0) * 60 +
          Number(match[3] ?? 0)
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatTimestamp(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600),
    m = Math.floor((value % 3600) / 60),
    s = value % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export { sourceLink, quoteContext, type SourceLink } from "./source-link";
export {
  noteIDPattern,
  notePath,
  noteURL,
  noteAppURL,
  noteIDFromURL,
} from "./note-link";

/** Timeline position never changes when a note is edited, pinned, or marked urgent. */
export function compareNoteCreation(
  a: Pick<Note, "createdAt" | "id">,
  b: Pick<Note, "createdAt" | "id">,
): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Empty drafts can close silently; a populated document must be persisted before close. */
export function shouldPersistNote(
  note: Pick<Note, "body" | "plainText" | "attachments" | "source">,
  existing = false,
): boolean {
  const meaningful = (node: DocumentNode): boolean =>
    !!node.text?.trim() ||
    ![
      "doc",
      "paragraph",
      "heading",
      "text",
      "hardBreak",
      "bulletList",
      "orderedList",
      "taskList",
      "listItem",
      "taskItem",
      "blockquote",
      "codeBlock",
    ].includes(node.type) ||
    !!node.content?.some(meaningful);
  return (
    existing ||
    !!note.plainText.trim() ||
    note.attachments.length > 0 ||
    !!note.source ||
    meaningful(note.body)
  );
}
