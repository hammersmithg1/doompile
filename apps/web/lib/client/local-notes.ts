import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note } from "@doompile/core";
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
};
interface NotesDB extends DBSchema {
  state: { key: string; value: any }; // Legacy snapshot retained until transactional migration completes.
  records: { key: string; value: StoredRecord; indexes: { pending: number } };
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
    const db = await openDB<NotesDB>(name, 2, {
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
  async save(note: Note): Promise<string[]> {
    const tx = this.db.transaction("records", "readwrite");
    const current = await tx.store.get(note.id);
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
      await tx.store.put(stored(copy, current.writer), copy.note.id);
      changed.push(copy.note.id);
    }
    await tx.store.put(
      stored(localEdit(current, note, this.writer), this.writer),
      note.id,
    );
    await tx.done;
    return changed;
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
    await this.db.clear("records");
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
