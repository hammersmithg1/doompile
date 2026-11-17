import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import { noteSchema, type Note, type NoteReplica, type DocumentNode, type Attachment } from "@doompile/core";
import { applySnapshot, decode, deltaForVector, documentTitle, open, prepare, project, state } from "../../../../packages/sync/model";

import type { ChangeOrigin, NoteChange, VersionInfo } from "../../../../packages/sync/changes";
import { authoredSnapshot, delta } from "../../../../packages/sync/model";
import { migrateSnapshot, prepareLegacy } from "../../../../packages/sync/legacy";
export type { ChangeOrigin, NoteChange, VersionInfo } from "../../../../packages/sync/changes";
export class SyncWriteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const unpack = (bytes: Uint8Array) => gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
const plain = (note: Note): Note => { const { replica: _, ...value } = note; return value; };

/** The projection, causal state, history, receipts and collection cursor commit together. */
export class VersionStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS note_replicas (note_id TEXT PRIMARY KEY,state BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS note_history_blobs (hash TEXT PRIMARY KEY,payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS note_versions (
        note_id TEXT NOT NULL,revision INTEGER NOT NULL,parent_revision INTEGER,
        created_at TEXT NOT NULL,authored_at TEXT NOT NULL,origin TEXT NOT NULL,kind TEXT NOT NULL,
        delta_hash TEXT NOT NULL,checkpoint_hash TEXT,input_hash TEXT,snapshot_hash TEXT,base_revision INTEGER,legacy_hash TEXT,
        PRIMARY KEY(note_id,revision)
      );
      CREATE TABLE IF NOT EXISTS note_sync_receipts (
        note_id TEXT NOT NULL,change_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
        revision INTEGER NOT NULL,PRIMARY KEY(note_id,change_id)
      );
      CREATE TABLE IF NOT EXISTS note_changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT,note_id TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS note_changes_by_note ON note_changes(note_id,cursor);
      CREATE TABLE IF NOT EXISTS note_legacy_writes (note_id TEXT PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS note_legacy_insert AFTER INSERT ON notes
        WHEN NOT EXISTS(SELECT 1 FROM note_replicas WHERE note_id=NEW.id)
        BEGIN INSERT INTO note_legacy_writes SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM note_legacy_writes WHERE note_id=NEW.id); END;
      CREATE TRIGGER IF NOT EXISTS note_legacy_update AFTER UPDATE ON notes
        WHEN json_extract(NEW.payload,'$.revision') != COALESCE((SELECT MAX(revision) FROM note_versions WHERE note_id=NEW.id),-1)
        BEGIN INSERT INTO note_legacy_writes SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM note_legacy_writes WHERE note_id=NEW.id); END;
      INSERT OR IGNORE INTO note_legacy_writes
        SELECT n.id FROM notes n LEFT JOIN note_replicas r ON r.note_id=n.id
        WHERE r.note_id IS NULL OR json_extract(n.payload,'$.revision') != (SELECT MAX(revision) FROM note_versions WHERE note_id=n.id);
    `);
    if (!(db.prepare("PRAGMA table_info(note_versions)").all() as { name: string }[]).some(row => row.name === "legacy_hash")) db.exec("ALTER TABLE note_versions ADD COLUMN legacy_hash TEXT");
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = run(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private latest(id: string): Note | null {
    const row = this.db.prepare("SELECT payload FROM notes WHERE id=?").get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  private replica(id: string): NoteReplica | undefined {
    const row = this.db.prepare("SELECT state FROM note_replicas WHERE note_id=?").get(id) as { state: Uint8Array } | undefined;
    return row ? { format: "yjs-1", data: unpack(row.state).toString("base64") } : undefined;
  }
  private blob(bytes: Uint8Array): string {
    const key = hash(bytes);
    this.db.prepare("INSERT OR IGNORE INTO note_history_blobs(hash,payload) VALUES (?,?)").run(key, gzipSync(bytes));
    return key;
  }
  private readBlob(key: string): Uint8Array {
    const row = this.db.prepare("SELECT payload FROM note_history_blobs WHERE hash=?").get(key) as { payload: Uint8Array } | undefined;
    if (!row) throw new SyncWriteError("Version data is unavailable", 500);
    const data = unpack(row.payload);
    if (hash(data) !== key) throw new SyncWriteError("Version integrity check failed", 500);
    return data;
  }
  private putProjection(note: Note) {
    this.db.prepare("INSERT INTO notes(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
      .run(note.id, JSON.stringify(plain(note)), note.updatedAt);
  }
  private putState(id: string, doc: Y.Doc) {
    this.db.prepare("INSERT INTO note_replicas(note_id,state) VALUES (?,?) ON CONFLICT(note_id) DO UPDATE SET state=excluded.state")
      .run(id, gzipSync(Y.encodeStateAsUpdate(doc)));
    this.db.prepare("DELETE FROM note_legacy_writes WHERE note_id=?").run(id);
  }
  private append(note: Note, doc: Y.Doc, change: Uint8Array, parent: number | null, kind: string, authoredAt: string, origin: string, submitted?: NoteChange) {
    const checkpoint = parent === null || kind === "initial" || note.revision % 64 === 0;
    this.db.prepare("INSERT INTO note_versions(note_id,revision,parent_revision,created_at,authored_at,origin,kind,delta_hash,checkpoint_hash,input_hash,snapshot_hash,base_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(note.id, note.revision, parent, note.updatedAt, authoredAt, origin, kind, this.blob(change), checkpoint ? this.blob(Y.encodeStateAsUpdate(doc)) : null,
        submitted ? this.blob(decode(submitted.update)) : null, submitted ? this.blob(decode(submitted.snapshot)) : null, submitted?.baseRevision ?? null);
    this.db.prepare("INSERT INTO note_changes(note_id,revision) VALUES (?,?)").run(note.id, note.revision);
    this.putProjection(note);
  }
  private seed(note: Note) {
    const existing = this.replica(note.id);
    if (existing) {
      const tip = this.db.prepare("SELECT revision,created_at FROM note_versions WHERE note_id=? ORDER BY revision DESC LIMIT 1").get(note.id) as { revision: number; created_at: string };
      if (tip.revision === note.revision) { this.db.prepare("DELETE FROM note_legacy_writes WHERE note_id=?").run(note.id); return; }
      // An older application image can still write the public projection after
      // rollback. Reconcile that snapshot before exposing a stale causal tip.
      const before = open(existing);
      let doc: Y.Doc | undefined;
      try {
        const current = project(before, { revision: tip.revision, updatedAt: tip.created_at });
        const merged = migrateSnapshot(note, current, note.revision === tip.revision + 1 ? current : undefined);
        doc = open(merged.replica); this.canonicalMedia(doc);
        const next = noteSchema.parse(project(doc, { revision: Math.max(tip.revision, note.revision) + 1, updatedAt: new Date().toISOString() }));
        this.append(next, doc, decode(delta(next.replica!, existing)), tip.revision, "migration", note.updatedAt, "migration");
        this.db.prepare("UPDATE note_versions SET legacy_hash=? WHERE note_id=? AND revision=?").run(this.blob(Buffer.from(JSON.stringify(plain(note)))), note.id, next.revision);
        this.putState(note.id, doc);
      } finally { before.destroy(); doc?.destroy(); }
      return;
    }
    const initial = prepare(prepareLegacy(note)), doc = open(initial.replica);
    try {
      // Preserve existing revision numbers and identifiers at the migration boundary.
      this.append(initial, doc, Y.encodeStateAsUpdate(doc), null, "initial", note.updatedAt, "migration");
      this.db.prepare("UPDATE note_versions SET legacy_hash=? WHERE note_id=? AND revision=?").run(this.blob(Buffer.from(JSON.stringify(plain(note)))), note.id, note.revision);
      // Keep the pre-upgrade public projection byte-for-byte compatible until a
      // real replica edit is accepted; old capture retries compare that payload.
      this.putProjection(note);
      this.putState(note.id, doc);
    } finally { doc.destroy(); }
  }
  private ensureAll() {
    const rows = this.db.prepare("SELECT n.payload FROM notes n JOIN note_legacy_writes w ON w.note_id=n.id").all() as { payload: string }[];
    for (const row of rows) this.seed(JSON.parse(row.payload));
  }
  get(id: string): Note | null {
    return this.transaction(() => {
      const current = this.latest(id);
      if (!current) return null;
      this.seed(current);
      const doc = open(this.replica(id));
      try { return project(doc, this.latest(id)!); } finally { doc.destroy(); }
    });
  }
  private canonicalMedia(doc: Y.Doc) {
    const note = project(doc), replacements = new Map<string, string>();
    let changed = false;
    note.attachments = note.attachments.map(file => {
      if (!file.url.startsWith("local:")) return file;
      const row = this.db.prepare("SELECT payload FROM attachments WHERE id=?").get(file.id) as { payload: string } | undefined;
      if (!row) throw new SyncWriteError("An attachment must finish uploading before its note");
      const remote = JSON.parse(row.payload) as Attachment;
      replacements.set(file.url, remote.url); changed = true;
      return { ...file, url: remote.url, mimeType: remote.mimeType, size: remote.size };
    });
    const findLocal = (node: DocumentNode) => {
      for (const key of ["src", "url"]) {
        const value = node.attrs?.[key];
        if (typeof value !== "string" || !value.startsWith("local:") || replacements.has(value)) continue;
        const id = value.slice(6);
        const row = this.db.prepare("SELECT payload FROM attachments WHERE id=?").get(id) as { payload: string } | undefined;
        if (!row) throw new SyncWriteError("An attachment must finish uploading before its note");
        replacements.set(value, (JSON.parse(row.payload) as Attachment).url); changed = true;
      }
      node.content?.forEach(findLocal);
    };
    findLocal(note.body);
    if (!changed) return;
    const visit = (node: DocumentNode): DocumentNode => {
      const attrs = node.attrs ? { ...node.attrs } : undefined;
      if (attrs) for (const key of ["src", "url"]) {
        const replacement = replacements.get(String(attrs[key] ?? ""));
        if (replacement) attrs[key] = replacement;
      }
      return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) };
    };
    note.body = visit(note.body);
    applySnapshot(doc, note);
  }
  sync(id: string, changes: NoteChange[], clientVector?: string) {
    return this.transaction(() => {
      let current = this.latest(id);
      if (current) { this.seed(current); current = this.latest(id); }
      const doc = open(this.replica(id));
      const acknowledged: string[] = [];
      try {
        for (const change of changes) {
          const digest = hash(JSON.stringify([change.update, change.snapshot, change.baseRevision, change.authoredAt, change.origin]));
          const receipt = this.db.prepare("SELECT payload_hash,revision FROM note_sync_receipts WHERE note_id=? AND change_id=?").get(id, change.id) as { payload_hash: string; revision: number } | undefined;
          if (receipt) {
            if (receipt.payload_hash !== digest) throw new SyncWriteError("A saved change identifier cannot be reused with different data");
            acknowledged.push(change.id); continue;
          }
          const before = Y.encodeStateVector(doc);
          try { Y.decodeSnapshot(decode(change.snapshot)); Y.applyUpdate(doc, decode(change.update), "client"); }
          catch { throw new SyncWriteError("Invalid document update"); }
          if (!doc.getMap("note").get("id")) throw new SyncWriteError("The update requires its earlier document context", 409);
          if (doc.getMap("note").get("id") !== id) throw new SyncWriteError("The update belongs to another note");
          this.canonicalMedia(doc);
          const updatedAt = new Date().toISOString();
          const next = project(doc, { revision: (current?.revision ?? 0) + 1, updatedAt });
          if (next.id !== id) throw new SyncWriteError("The update belongs to another note");
          if (current && current.createdAt !== next.createdAt) throw new SyncWriteError("The note creation time is immutable");
          const valid = noteSchema.safeParse(next);
          if (!valid.success) throw new SyncWriteError("The updated note exceeds the document limits or has invalid fields");
          // A new received operation is journalled even if it is waiting on a causal
          // predecessor. Otherwise an out-of-order packet could disappear on restart.
          this.append(valid.data, doc, Y.encodeStateAsUpdate(doc, before), current?.revision ?? null,
            change.origin === "recovery" ? "recovery" : "edit", change.authoredAt, change.origin, change);
          this.db.prepare("INSERT INTO note_sync_receipts(note_id,change_id,payload_hash,revision) VALUES (?,?,?,?)")
            .run(id, change.id, digest, valid.data.revision);
          current = plain(valid.data); acknowledged.push(change.id);
        }
        if (!current) throw new SyncWriteError("Note not found", 404);
        this.putState(id, doc);
        return { note: project(doc, current), acknowledged, update: deltaForVector(doc, clientVector), cursor: this.cursor() };
      } finally { doc.destroy(); }
    });
  }
  migrate(id: string, snapshots: { id: string; note: Note; baseline?: Note; baseRevision: number; origin: ChangeOrigin }[]) {
    return this.transaction(() => {
      let current = this.latest(id);
      if (current) { this.seed(current); current = this.latest(id); }
      const acknowledged: string[] = [];
      for (const snapshot of snapshots) {
        if (snapshot.note.id !== id) throw new SyncWriteError("The snapshot belongs to another note");
        const digest = hash(JSON.stringify(snapshot));
        const receipt = this.db.prepare("SELECT payload_hash FROM note_sync_receipts WHERE note_id=? AND change_id=?").get(id, snapshot.id) as { payload_hash: string } | undefined;
        if (receipt) {
          if (receipt.payload_hash !== digest) throw new SyncWriteError("A saved change identifier cannot be reused with different data");
          acknowledged.push(snapshot.id); continue;
        }
        const remote = current ? { ...current, replica: this.replica(id)! } : undefined;
        if (snapshot.baseline && snapshot.baseline.id !== id) throw new SyncWriteError("The baseline belongs to another note");
        const base = snapshot.baseline ?? (remote && this.version(id, snapshot.baseRevision));
        const migrated = remote ? migrateSnapshot(snapshot.note, remote, base ?? undefined) : prepare({ ...snapshot.note, replica: undefined });
        const doc = open(migrated.replica);
        try {
          this.canonicalMedia(doc);
          const next = noteSchema.parse(project(doc, { revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() }));
          const submitted: NoteChange = { id: snapshot.id, update: delta(migrated.replica!, remote?.replica), snapshot: authoredSnapshot(migrated.replica!), baseRevision: remote?.revision ?? 0, authoredAt: snapshot.note.updatedAt, origin: snapshot.origin };
          this.append(next, doc, decode(delta(next.replica!, remote?.replica)), current?.revision ?? null, "migration", submitted.authoredAt, snapshot.origin, submitted);
          this.db.prepare("UPDATE note_versions SET legacy_hash=? WHERE note_id=? AND revision=?").run(this.blob(Buffer.from(JSON.stringify(plain(snapshot.note)))), id, next.revision);
          this.db.prepare("INSERT INTO note_sync_receipts VALUES (?,?,?,?)").run(id, snapshot.id, digest, next.revision);
          this.putState(id, doc); current = plain(next); acknowledged.push(snapshot.id);
        } finally { doc.destroy(); }
      }
      if (!current) throw new SyncWriteError("Note not found", 404);
      return { note: { ...current, replica: this.replica(id)! }, acknowledged };
    });
  }
  cursor(): number {
    return Number((this.db.prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM note_changes").get() as { cursor: number }).cursor);
  }
  changes(after = 0, limit = 100) {
    return this.transaction(() => {
      this.ensureAll();
      const reset = after > this.cursor();
      const since = reset ? 0 : after;
      const rows = this.db.prepare("SELECT note_id,MAX(cursor) AS cursor FROM note_changes WHERE cursor>? GROUP BY note_id ORDER BY cursor LIMIT ?")
        .all(since, Math.min(200, Math.max(1, limit))) as { note_id: string; cursor: number }[];
      const notes = rows.map(row => { const doc = open(this.replica(row.note_id)); try { return project(doc, this.latest(row.note_id)!); } finally { doc.destroy(); } });
      const cursor = rows.at(-1)?.cursor ?? since;
      const more = !!this.db.prepare("SELECT 1 FROM note_changes WHERE cursor>? LIMIT 1").get(cursor);
      return { notes, cursor, more, ...(reset ? { reset: true } : {}) };
    });
  }
  versions(id: string, before = Number.MAX_SAFE_INTEGER, limit = 30): VersionInfo[] {
    // Seed even a never-opened legacy note before exposing its history.
    if (!this.get(id)) return [];
    const rows = this.db.prepare("SELECT revision,parent_revision,created_at,authored_at,origin,kind FROM note_versions WHERE note_id=? AND revision<? ORDER BY revision DESC LIMIT ?")
      .all(id, before, Math.min(100, Math.max(1, limit))) as unknown as { revision: number; parent_revision: number | null; created_at: string; authored_at: string; origin: string; kind: string }[];
    return rows.map(row => ({ revision: row.revision, parentRevision: row.parent_revision, createdAt: row.created_at, authoredAt: row.authored_at, origin: row.origin, kind: row.kind }));
  }
  version(id: string, revision: number): Note | null {
    const target = this.db.prepare("SELECT created_at FROM note_versions WHERE note_id=? AND revision=?").get(id, revision) as { created_at: string } | undefined;
    if (!target) return null;
    const checkpoint = this.db.prepare("SELECT revision,checkpoint_hash FROM note_versions WHERE note_id=? AND revision<=? AND checkpoint_hash IS NOT NULL ORDER BY revision DESC LIMIT 1")
      .get(id, revision) as { revision: number; checkpoint_hash: string } | undefined;
    if (!checkpoint) throw new SyncWriteError("Version checkpoint is unavailable", 500);
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, this.readBlob(checkpoint.checkpoint_hash));
      const rows = this.db.prepare("SELECT delta_hash FROM note_versions WHERE note_id=? AND revision>? AND revision<=? ORDER BY revision")
        .all(id, checkpoint.revision, revision) as { delta_hash: string }[];
      for (const row of rows) Y.applyUpdate(doc, this.readBlob(row.delta_hash));
      return plain(project(doc, { revision, updatedAt: target.created_at }));
    } finally { doc.destroy(); }
  }
  authoredVersion(id: string, revision: number): Note | null {
    const legacy = this.db.prepare("SELECT legacy_hash FROM note_versions WHERE note_id=? AND revision=?").get(id, revision) as { legacy_hash: string | null } | undefined;
    if (legacy?.legacy_hash) return JSON.parse(Buffer.from(this.readBlob(legacy.legacy_hash)).toString("utf8")) as Note;
    const target = this.db.prepare("SELECT snapshot_hash,base_revision,created_at FROM note_versions WHERE note_id=? AND revision=?")
      .get(id, revision) as { snapshot_hash: string | null; base_revision: number | null; created_at: string } | undefined;
    if (!target) return null;
    if (!target.snapshot_hash) return this.version(id, revision);
    const snapshot = Y.decodeSnapshot(this.readBlob(target.snapshot_hash));
    // Only use a checkpoint the submitting device had actually observed.
    // A later checkpoint may already have garbage-collected a paragraph that
    // another offline device was still editing.
    const candidates = this.db.prepare("SELECT revision,checkpoint_hash FROM note_versions WHERE note_id=? AND revision<=? AND checkpoint_hash IS NOT NULL ORDER BY revision DESC")
      .all(id, target.base_revision ?? 0) as { revision: number; checkpoint_hash: string }[];
    const archive = new Y.Doc({ gc: false });
    let after = -1;
    try {
      for (const candidate of candidates) {
        const data = this.readBlob(candidate.checkpoint_hash);
        if (Y.snapshotContainsUpdate(snapshot, data)) {
          Y.applyUpdate(archive, data); after = candidate.revision; break;
        }
      }
      const rows = this.db.prepare("SELECT input_hash,delta_hash FROM note_versions WHERE note_id=? AND revision>? ORDER BY revision")
        .all(id, after) as { input_hash: string | null; delta_hash: string }[];
      const applied = new Set<string>();
      for (const row of rows) for (const key of [row.input_hash, row.delta_hash]) {
        if (!key || applied.has(key)) continue;
        applied.add(key);
        const data = this.readBlob(key);
        if (Y.snapshotContainsUpdate(snapshot, data)) Y.applyUpdate(archive, data);
      }
      let authored: Y.Doc;
      try { authored = Y.createDocFromSnapshot(archive, snapshot); }
      catch { throw new SyncWriteError("This version is still waiting for earlier changes", 409); }
      try {
        this.canonicalMedia(authored);
        return plain(project(authored, { revision, updatedAt: target.created_at }));
      } finally { authored.destroy(); }
    } finally { archive.destroy(); }
  }
  restore(id: string, revision: number, origin: ChangeOrigin, view: "merged" | "authored" = "merged") {
    return this.transaction(() => {
      let current = this.latest(id);
      if (!current) throw new SyncWriteError("Note not found", 404);
      this.seed(current);
      current = this.latest(id)!;
      const target = view === "authored" ? this.authoredVersion(id, revision) : this.version(id, revision);
      if (!target) throw new SyncWriteError("Version not found", 404);
      const doc = open(this.replica(id));
      try {
        const before = Y.encodeStateVector(doc);
        doc.transact(() => {
          doc.getMap("note").set("autoTitle", target.title === documentTitle(target.body));
          doc.getMap("note").set("title", target.title);
          applySnapshot(doc, target);
        }, "restore");
        const updatedAt = new Date().toISOString();
        const restored = noteSchema.parse(project(doc, { revision: current.revision + 1, updatedAt }));
        this.append(restored, doc, Y.encodeStateAsUpdate(doc, before), current.revision, "restore", updatedAt, origin);
        this.putState(id, doc);
        return { note: restored, restoredFrom: revision, cursor: this.cursor() };
      } finally { doc.destroy(); }
    });
  }
}
