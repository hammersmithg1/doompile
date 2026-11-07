import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Attachment, Note } from "@doompile/core";
import { dataDirectory } from "./identity";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, val]) => val !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
  return JSON.stringify(value);
}
function content(note: Note): string { const { revision: _revision, ...rest } = note; return canonical(rest); }

export type SaveResult = { ok: true; note: Note } | { ok: false; current: Note | null };

export class NoteStore {
  private database: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(resolve(directory, "doompile.sqlite"));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachment_objects (id TEXT PRIMARY KEY, storage_key TEXT NOT NULL);
    `);
  }
  list(): Note[] {
    return (this.database.prepare("SELECT payload FROM notes ORDER BY updated_at DESC, id ASC").all() as {payload: string}[]).map((row) => JSON.parse(row.payload));
  }
  get(id: string): Note | null {
    const row = this.database.prepare("SELECT payload FROM notes WHERE id = ?").get(id) as {payload: string} | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  save(incoming: Note, baseRevision: number): SaveResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(incoming.id);
      // A response can be lost after committing. Retrying exactly the same edit is safe.
      if (current && content(current) === content(incoming)) { this.database.exec("COMMIT"); return { ok: true, note: current }; }
      if ((current?.revision ?? 0) !== baseRevision) { this.database.exec("ROLLBACK"); return { ok: false, current }; }
      const note: Note = { ...incoming, createdAt: current?.createdAt ?? incoming.createdAt, revision: (current?.revision ?? 0) + 1 };
      this.database.prepare("INSERT INTO notes(id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").run(note.id, JSON.stringify(note), note.updatedAt);
      this.database.exec("COMMIT");
      return { ok: true, note };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  putAttachment(attachment: Attachment): void {
    this.database.prepare("INSERT INTO attachments(id, payload) VALUES (?, ?)").run(attachment.id, JSON.stringify(attachment));
  }
  getAttachment(id: string): Attachment | null {
    const row = this.database.prepare("SELECT payload FROM attachments WHERE id = ?").get(id) as {payload: string} | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  attachmentKey(id: string): string | null {
    const row = this.database.prepare("SELECT storage_key FROM attachment_objects WHERE id=?").get(id) as { storage_key: string } | undefined;
    return row?.storage_key ?? null;
  }
  commitAttachment(attachment: Attachment, key: string): Attachment {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getAttachment(attachment.id);
      if (existing) {
        if (canonical(existing) !== canonical(attachment) || this.attachmentKey(attachment.id) !== key)
          throw new Error("UPLOAD_CONFLICT");
        this.database.exec("COMMIT");
        return existing;
      }
      this.putAttachment(attachment);
      this.database.prepare("INSERT INTO attachment_objects VALUES (?,?)").run(attachment.id, key);
      this.database.exec("COMMIT");
      return attachment;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  attachments(): Attachment[] {
    return (this.database.prepare("SELECT payload FROM attachments").all() as { payload: string }[]).map(row => JSON.parse(row.payload));
  }
  close(): void { this.database.close(); }
}

const globalStores = globalThis as typeof globalThis & { doompileStores?: Map<string, NoteStore> };
export function store(userId: string): NoteStore {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(userId)) throw new Error("Invalid authenticated user ID.");
  const directory = resolve(dataDirectory(), "users", userId);
  const stores = globalStores.doompileStores ??= new Map();
  if (!stores.has(directory)) stores.set(directory, new NoteStore(directory));
  return stores.get(directory)!;
}
