import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Attachment, Note } from "@doompile/core";
import type { QuickUpload } from "./quick-uploads";
import type { LocalRecord } from "./reconcile";
import { combine, type NoteChange } from "../../../../packages/sync/changes";
import { stage, type LegacyChange } from "../../../../packages/sync/client";
import { delta, authoredSnapshot, sameState } from "../../../../packages/sync/model";

export type StoredRecord = LocalRecord & {
  pending: number; writer?: string; error?: string; uploads?: Attachment[];
  changes?: NoteChange[]; legacy?: LegacyChange[]; server?: Note; legacyBaseline?: Note;
};
interface NotesDB extends DBSchema {
  state: { key: string; value: any };
  records: { key: string; value: StoredRecord; indexes: { pending: number } };
  uploadBytes: { key: string; value: ArrayBuffer };
}
const pending = (record: StoredRecord): StoredRecord => ({ ...record, pending: record.dirty && !record.uploads?.length ? 1 : 0 });

/** A materialized note and its immutable outbox always commit in the same transaction. */
export class LocalNotes {
  private constructor(private db: IDBPDatabase<NotesDB>, private writer: string) {}
  static async open(writer: string, name = "doompile-v1", onBlocked: () => void = () => {}) {
    const db = await openDB<NotesDB>(name, 4, {
      upgrade(db, oldVersion, _version, tx) {
        if (oldVersion < 1) db.createObjectStore("state");
        if (oldVersion < 2) {
          const records = db.createObjectStore("records"); records.createIndex("pending", "pending");
          void tx.objectStore("state").get("notes").then(async legacy => {
            for (const [id, record] of Object.entries(legacy || {})) {
              const row = record as LocalRecord;
              await tx.objectStore("records").put({ ...row, pending: row.dirty ? 1 : 0 }, id);
            }
            await tx.objectStore("state").delete("notes");
          }).catch(() => tx.abort());
        }
        if (oldVersion < 3) db.createObjectStore("uploadBytes");
      },
      blocked: onBlocked, blocking() { db.close(); },
    });
    return new LocalNotes(db, writer);
  }
  async all() { return this.db.getAll("records"); }
  async pending() {
    const tx = this.db.transaction("records", "readwrite");
    const rows = await tx.store.index("pending").getAll(1);
    for (const row of rows) if (!row.note.replica && !row.legacy?.length) {
      row.legacy = [{ id: crypto.randomUUID(), note: row.note, baseRevision: row.baseRevision, origin: "web" }];
      await tx.store.put(row, row.note.id);
    }
    await tx.done; return rows;
  }
  async read(ids: string[]) { return Promise.all(ids.map(id => this.db.get("records", id))); }
  private stage(current: StoredRecord | undefined, input: Note, raw: NoteChange[] = []): StoredRecord {
    const legacy = [...(current?.legacy ?? [])];
    if (current?.dirty && !current.note.replica && !legacy.length) legacy.push({ id: crypto.randomUUID(), note: current.note, baseRevision: current.baseRevision, origin: "web" });
    const staged = stage(current, input, raw);
    const changes = [...(current?.changes ?? [])];
    const known = new Set(changes.map(change => change.id));
    for (const change of staged.changes) if (!known.has(change.id)) { known.add(change.id); changes.push(change); }
    legacy.push(...staged.legacy);
    return pending({ ...current, note: staged.note, changes, legacy, dirty: !!(changes.length || legacy.length), baseRevision: current?.server?.revision ?? input.revision, writer: this.writer, error: undefined, pending: 0 });
  }
  async save(note: Note, uploads: QuickUpload[] = [], changes: NoteChange[] = []): Promise<string[]> {
    const bytes = await Promise.all(uploads.map(file => file.data.arrayBuffer()));
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const records = tx.objectStore("records"), current = await records.get(note.id);
    if (uploads.length && current) {
      await tx.done;
      if (uploads.every(file => current.note.attachments.some(item => item.id === file.attachment.id))) return [];
      throw new Error("Не удалось добавить вложения в уже сохранённую заметку.");
    }
    const next = this.stage(current, note, changes);
    if (uploads.length) { next.uploads = uploads.map(file => file.attachment); next.pending = 0; }
    for (let index = 0; index < uploads.length; index++) await tx.objectStore("uploadBytes").put(bytes[index], uploads[index].attachment.id);
    await records.put(next, note.id); await tx.done; return [note.id];
  }
  async uploadData(attachment: Attachment) {
    const bytes = await this.db.get("uploadBytes", attachment.id);
    return bytes && new Blob([bytes], { type: attachment.mimeType });
  }
  async finishUpload(noteID: string, attachment: Attachment) {
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const records = tx.objectStore("records"), current = await records.get(noteID);
    if (!current?.uploads?.some(file => file.id === attachment.id)) { await tx.done; return []; }
    const old = current.note.attachments.find(file => file.id === attachment.id)!;
    const replace = (value: unknown): unknown => typeof value === "string" ? value === old.url ? attachment.url : value : Array.isArray(value) ? value.map(replace) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : value;
    const next = this.stage(current, { ...current.note, attachments: current.note.attachments.map(file => file.id === attachment.id ? attachment : file), body: replace(current.note.body) as Note["body"] });
    next.uploads = current.uploads.filter(file => file.id !== attachment.id);
    await records.put(pending(next), noteID); await tx.objectStore("uploadBytes").delete(attachment.id); await tx.done;
    return [noteID];
  }
  async discardUploads(noteID: string) {
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const current = await tx.objectStore("records").get(noteID);
    if (!current?.uploads?.length) { await tx.done; return; }
    const bytes = await Promise.all(current.uploads.map(file => tx.objectStore("uploadBytes").get(file.id)));
    if (bytes.some(buffer => !buffer)) { await tx.done; throw new Error("Не удалось прочитать вложения для отмены удаления."); }
    await tx.objectStore("records").delete(noteID);
    for (const file of current.uploads) await tx.objectStore("uploadBytes").delete(file.id);
    await tx.done;
    return { note: current.note, uploads: current.uploads.map((attachment, index) => ({ attachment, data: new Blob([bytes[index]!], { type: attachment.mimeType }) })) };
  }
  async accept(sent: StoredRecord, server: Note, acknowledged: string[]): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite"), current = await tx.store.get(sent.note.id);
    if (current) {
      const ids = new Set(acknowledged);
      const changes = (current.changes ?? []).filter(change => !ids.has(change.id));
      const legacy = (current.legacy ?? []).filter(change => !ids.has(change.id));
      let note = legacy.length ? current.note : combine(current.note.replica ? current.note : undefined, server);
      if (!legacy.length && !changes.length && !sameState(note.replica!, server.replica!)) {
        changes.push({ id: crypto.randomUUID(), update: delta(note.replica!, server.replica), snapshot: authoredSnapshot(note.replica!), baseRevision: server.revision, authoredAt: note.updatedAt, origin: "recovery" });
      }
      await tx.store.put(pending({ ...current, note, server, changes, legacy, legacyBaseline: sent.legacy?.at(-1)?.note ?? current.legacyBaseline, dirty: !!(changes.length || legacy.length), baseRevision: server.revision, error: undefined }), note.id);
    }
    await tx.done; return [sent.note.id];
  }
  async error(id: string, message: string): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite"), row = await tx.store.get(id);
    if (row?.dirty) await tx.store.put({ ...row, error: message }, id);
    await tx.done; return [id];
  }
  async cursor() { return (await this.db.get("state", "collectionCursor")) as number || 0; }
  async merge(notes: Note[], cursor?: number): Promise<string[]> {
    const tx = this.db.transaction(["records", "state"], "readwrite"), records = tx.objectStore("records"), changed: string[] = [];
    for (const remote of notes) {
      const current = await records.get(remote.id);
      if (current?.server && current.server.revision > remote.revision) continue;
      if (current?.legacy?.length || current?.dirty && !current.note.replica) {
        await records.put({ ...current, server: remote }, remote.id); continue;
      }
      const note = combine(current?.note, remote), changes = [...(current?.changes ?? [])];
      if (!changes.length && !sameState(note.replica!, remote.replica!)) changes.push({ id: crypto.randomUUID(), update: delta(note.replica!, remote.replica), snapshot: authoredSnapshot(note.replica!), baseRevision: remote.revision, authoredAt: note.updatedAt, origin: "recovery" });
      const next = pending({ ...current, note, server: remote, changes, dirty: !!changes.length, baseRevision: remote.revision, error: undefined, pending: 0 });
      if (JSON.stringify(current) !== JSON.stringify(next)) { await records.put(next, remote.id); changed.push(remote.id); }
    }
    if (cursor !== undefined) await tx.objectStore("state").put(cursor, "collectionCursor");
    await tx.done; return changed;
  }
  async clear() {
    const tx = this.db.transaction(["records", "uploadBytes", "state"], "readwrite");
    await Promise.all([tx.objectStore("records").clear(), tx.objectStore("uploadBytes").clear(), tx.objectStore("state").delete("collectionCursor")]); await tx.done;
  }
  async lease(acquire: boolean) {
    const tx = this.db.transaction("state", "readwrite"), lease = await tx.store.get("syncLease");
    let accepted = false;
    if (!lease || lease.owner === this.writer || lease.until < Date.now()) {
      if (acquire) await tx.store.put({ owner: this.writer, until: Date.now() + 45_000 }, "syncLease"); else await tx.store.delete("syncLease");
      accepted = true;
    }
    await tx.done; return accepted;
  }
}
