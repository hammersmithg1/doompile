import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Attachment, Note } from "@doompile/core";
import type { QuickUpload } from "./quick-uploads";
import {
  acknowledge,
  conflictCopy,
  localEdit,
  type LocalRecord,
} from "./reconcile";

export type StoredRecord = LocalRecord & {
  pending: number;
  writer?: string;
  error?: string;
  uploads?: Attachment[];
};
interface NotesDB extends DBSchema {
  state: { key: string; value: any }; // Legacy snapshot retained until transactional migration completes.
  records: { key: string; value: StoredRecord; indexes: { pending: number } };
  uploadBytes: { key: string; value: ArrayBuffer };
}
const stored = (record: LocalRecord, writer?: string): StoredRecord => ({
  ...record,
  writer,
  pending: record.dirty ? 1 : 0,
});

/** IndexedDB transactions, rather than an in-memory snapshot, own each mutation. */
export class LocalNotes {
  private constructor(
    private db: IDBPDatabase<NotesDB>,
    private writer: string,
  ) {}
  static async open(
    writer: string,
    name = "doompile-v1",
    onBlocked: () => void = () => {},
  ) {
    const db = await openDB<NotesDB>(name, 3, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) db.createObjectStore("state");
        if (oldVersion < 2) {
          const records = db.createObjectStore("records");
          records.createIndex("pending", "pending");
          // The old snapshot is removed only after every row is written in this same upgrade transaction.
          void tx
            .objectStore("state")
            .get("notes")
            .then(async (legacy) => {
              for (const [id, record] of Object.entries(legacy || {}))
                await tx
                  .objectStore("records")
                  .put(stored(record as LocalRecord), id);
              await tx.objectStore("state").delete("notes");
            })
            .catch(() => tx.abort());
        }
        if (oldVersion < 3) db.createObjectStore("uploadBytes");
      },
      blocked: onBlocked,
      blocking() {
        db.close();
      },
    });
    return new LocalNotes(db, writer);
  }
  async all() {
    return this.db.getAll("records");
  }
  async pending() {
    return this.db.getAllFromIndex("records", "pending", 1);
  }
  async read(ids: string[]) {
    return Promise.all(ids.map((id) => this.db.get("records", id)));
  }
  async save(note: Note, uploads: QuickUpload[] = []): Promise<string[]> {
    // Safari may reject File and Blob values in IndexedDB. Store their bytes
    // separately so refreshing the feed only reads attachment metadata.
    const bytes = await Promise.all(
      uploads.map((file) => file.data.arrayBuffer()),
    );
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const records = tx.objectStore("records");
    const current = await records.get(note.id);
    if (uploads.length && current) {
      await tx.done;
      if (
        uploads.every((file) =>
          current.note.attachments.some(
            (attachment) => attachment.id === file.attachment.id,
          ),
        )
      )
        return [];
      throw new Error(
        "Не удалось добавить вложения в уже сохранённую заметку.",
      );
    }
    if (current?.uploads?.length) {
      await tx.done;
      throw new Error("Дождись загрузки вложений, чтобы изменить заметку.");
    }
    const changed = [note.id];
    if (
      current?.dirty &&
      current.writer &&
      current.writer !== this.writer &&
      JSON.stringify(current.note) !== JSON.stringify(note)
    ) {
      const copy = conflictCopy(
        current.note,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      await records.put(stored(copy, current.writer), copy.note.id);
      changed.push(copy.note.id);
    }
    const next = stored(localEdit(current, note, this.writer), this.writer);
    const pending = uploads.map((file) => file.attachment);
    const data = tx.objectStore("uploadBytes");
    await Promise.all([
      ...pending.map((file, index) => data.put(bytes[index], file.id)),
      records.put(
        pending.length ? { ...next, pending: 0, uploads: pending } : next,
        note.id,
      ),
      tx.done,
    ]);
    return changed;
  }
  async uploadData(attachment: Attachment) {
    const bytes = await this.db.get("uploadBytes", attachment.id);
    return bytes && new Blob([bytes], { type: attachment.mimeType });
  }
  async finishUpload(noteID: string, attachment: Attachment) {
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const records = tx.objectStore("records");
    const current = await records.get(noteID);
    if (!current?.uploads?.some((file) => file.id === attachment.id)) return [];
    const uploads = current.uploads.filter((file) => file.id !== attachment.id);
    const note = {
      ...current.note,
      attachments: current.note.attachments.map((file) =>
        file.id === attachment.id ? attachment : file,
      ),
    };
    await Promise.all([
      records.put(
        { ...current, note, uploads, pending: uploads.length ? 0 : 1 },
        noteID,
      ),
      tx.objectStore("uploadBytes").delete(attachment.id),
      tx.done,
    ]);
    return [noteID];
  }
  async discardUploads(noteID: string) {
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    const records = tx.objectStore("records");
    const current = await records.get(noteID);
    if (!current?.uploads?.length) return [];
    const data = tx.objectStore("uploadBytes");
    await Promise.all([
      records.delete(noteID),
      ...current.uploads.map((file) => data.delete(file.id)),
      tx.done,
    ]);
    return [noteID];
  }
  async accept(sent: Note, server: Note): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite");
    const current = await tx.store.get(sent.id);
    if (current && current.baseRevision <= server.revision)
      await tx.store.put(
        stored(acknowledge(current, sent, server), current.writer),
        sent.id,
      );
    await tx.done;
    return [sent.id];
  }
  async conflict(sent: Note, server: Note | null): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite");
    const current = await tx.store.get(sent.id);
    const changed = [sent.id];
    if (current?.dirty) {
      const copy = conflictCopy(
        current.note,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      await tx.store.put(stored(copy, this.writer), copy.note.id);
      changed.push(copy.note.id);
      if (server)
        await tx.store.put(
          stored({ note: server, baseRevision: server.revision, dirty: false }),
          sent.id,
        );
      else await tx.store.delete(sent.id);
    }
    await tx.done;
    return changed;
  }
  async error(id: string, message: string): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite");
    const current = await tx.store.get(id);
    if (current?.dirty) await tx.store.put({ ...current, error: message }, id);
    await tx.done;
    return [id];
  }
  async merge(notes: Note[]): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite");
    const changed: string[] = [];
    for (const note of notes) {
      const current = await tx.store.get(note.id);
      if (current?.dirty || (current && current.note.revision > note.revision))
        continue;
      if (!current || JSON.stringify(current.note) !== JSON.stringify(note)) {
        await tx.store.put(
          stored({ note, baseRevision: note.revision, dirty: false }),
          note.id,
        );
        changed.push(note.id);
      }
    }
    await tx.done;
    return changed;
  }
  async clear() {
    const tx = this.db.transaction(["records", "uploadBytes"], "readwrite");
    await Promise.all([
      tx.objectStore("records").clear(),
      tx.objectStore("uploadBytes").clear(),
      tx.done,
    ]);
  }
  async lease(acquire: boolean) {
    const tx = this.db.transaction("state", "readwrite");
    const lease = await tx.store.get("syncLease");
    let accepted = false;
    if (!lease || lease.owner === this.writer || lease.until < Date.now()) {
      if (acquire)
        await tx.store.put(
          { owner: this.writer, until: Date.now() + 45_000 },
          "syncLease",
        );
      else await tx.store.delete("syncLease");
      accepted = true;
    }
    await tx.done;
    return accepted;
  }
}
