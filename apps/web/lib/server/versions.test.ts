import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNote, textToDocument, type Note } from "@doompile/core";
import * as Y from "yjs";
import { gzipSync } from "node:zlib";
import { delta, open, project, setBody, encode } from "../../../../packages/sync/model";
import { prepare, stateVector, sameState, authoredSnapshot } from "../../../../packages/sync/model";
import { VersionStore, type NoteChange } from "./versions";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "doompile-versions-"));
  const path = join(directory, "doompile.sqlite");
  const open = () => {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
    return { db, versions: new VersionStore(db) };
  };
  const connection = open();
  return { ...connection, open, directory, close: () => { connection.db.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const edit = (note: Note, value: string) => prepare({ ...note, body: textToDocument(value), plainText: value });
const change = (note: Note, before?: Note): NoteChange => ({ id: randomUUID(), update: delta(note.replica!, before?.replica), snapshot: authoredSnapshot(note.replica!), baseRevision: before?.revision ?? 0, authoredAt: note.updatedAt, origin: "web" });

test("legacy migration creates an initial version without changing note ID, revision or capture retries", () => {
  const f = fixture();
  try {
    const note = createNote({ plainText: "Existing note", revision: 430 });
    f.db.prepare("INSERT INTO notes VALUES (?,?,?)").run(note.id, JSON.stringify(note), note.updatedAt);
    const migrated = f.versions.get(note.id)!;
    assert.equal(migrated.id, note.id); assert.equal(migrated.revision, 430);
    assert.deepEqual(JSON.parse((f.db.prepare("SELECT payload FROM notes WHERE id=?").get(note.id) as { payload: string }).payload), note);
    assert.equal(f.versions.versions(note.id).length, 1);
    assert.equal(f.versions.version(note.id, 430)!.plainText, note.plainText);
    assert.ok(sameState(migrated.replica!, f.versions.get(note.id)!.replica!));
  } finally { f.close(); }
});

test("two device branches merge into one row and retain both authored versions", () => {
  const f = fixture();
  try {
    const base = prepare(createNote({ plainText: "Shared" }));
    const initial = f.versions.sync(base.id, [change(base)]).note;
    const phone = edit(initial, "Phone Shared"), mac = edit(initial, "Shared Mac");
    f.versions.sync(base.id, [change(phone, initial)]);
    const final = f.versions.sync(base.id, [change(mac, initial)], stateVector(mac.replica!));
    assert.equal(final.note.plainText, "Phone Shared Mac");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n, 1);
    assert.equal(f.versions.versions(base.id).length, 3);
    assert.equal(f.versions.version(base.id, 1)!.plainText, "Shared");
    assert.equal(f.versions.version(base.id, 2)!.plainText, "Phone Shared");
    assert.equal(f.versions.version(base.id, 3)!.plainText, "Phone Shared Mac");
    assert.equal(f.versions.authoredVersion(base.id, 3)!.plainText, "Shared Mac");
  } finally { f.close(); }
});

test("a concurrent paragraph deletion cannot destroy the other device's authored text in history", () => {
  const f = fixture();
  try {
    const base = prepare(createNote({ plainText: "Original paragraph\nKeep this" }));
    const initial = f.versions.sync(base.id, [change(base)]).note;
    const deleted = edit(initial, "Keep this");
    const authored = edit(initial, "Original paragraph UNIQUE_OFFLINE_TEXT\nKeep this");
    f.versions.sync(base.id, [change(deleted, initial)]);
    f.versions.sync(base.id, [change(authored, initial)]);
    assert.equal(f.versions.authoredVersion(base.id, 3)!.plainText, authored.plainText);
    const restored = f.versions.restore(base.id, 3, "macos", "authored");
    assert.equal(restored.note.plainText, authored.plainText);
    assert.equal(restored.note.id, base.id);
    assert.equal(restored.note.revision, 4);
  } finally { f.close(); }
});

test("lost replies retry the exact receipt without another history version or repeated text", () => {
  const f = fixture();
  try {
    const note = prepare(createNote({ plainText: "One commit" })), mutation = change(note);
    const first = f.versions.sync(note.id, [mutation]);
    const again = f.versions.sync(note.id, [mutation]);
    assert.equal(first.note.revision, again.note.revision);
    assert.equal(again.note.plainText, "One commit");
    assert.deepEqual(again.acknowledged, [mutation.id]);
    assert.equal(f.versions.versions(note.id).length, 1);
    assert.throws(() => f.versions.sync(note.id, [{ ...mutation, authoredAt: "2020-01-01T00:00:00.000Z" }]), /cannot be reused/);
  } finally { f.close(); }
});

test("an invalid operation rolls back the whole batch, receipts and cursor", () => {
  const f = fixture();
  try {
    const note = prepare(createNote({ plainText: "Whole batch" }));
    const valid = change(note), invalid = { ...valid, id: randomUUID(), update: "broken" };
    assert.throws(() => f.versions.sync(note.id, [valid, invalid]), /Invalid document update/);
    assert.equal(f.versions.cursor(), 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM note_sync_receipts").get()!.n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM note_versions").get()!.n, 0);
  } finally { f.close(); }
});

test("offline intermediate saves remain replayable after restart and a later restore appends history", () => {
  const f = fixture();
  try {
    const first = prepare(createNote({ plainText: "Offline first" }));
    const second = edit(first, "Offline second");
    const third = edit(second, "Final");
    f.versions.sync(first.id, [change(first), change(second, first), change(third, second)]);
    const reopened = f.open();
    try {
      assert.equal(reopened.versions.version(first.id, 2)!.plainText, "Offline second");
      const restored = reopened.versions.restore(first.id, 1, "macos");
      assert.equal(restored.note.id, first.id);
      assert.equal(restored.note.plainText, "Offline first");
      assert.equal(restored.note.revision, 4);
      assert.equal(reopened.versions.version(first.id, 3)!.plainText, "Final");
      assert.equal(reopened.versions.versions(first.id)[0].kind, "restore");
      assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n, 1);
    } finally { reopened.db.close(); }
  } finally { f.close(); }
});

test("collection cursor pages changes and does not refetch unchanged notes", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) {
      const note = prepare(createNote({ plainText: "Note " + i }));
      f.versions.sync(note.id, [change(note)]);
    }
    const first = f.versions.changes(0, 2), second = f.versions.changes(first.cursor, 2), third = f.versions.changes(second.cursor, 2);
    assert.equal(new Set([...first.notes, ...second.notes, ...third.notes].map(note => note.id)).size, 5);
    assert.equal(first.more, true); assert.equal(second.more, true); assert.equal(third.more, false);
    assert.equal(f.versions.changes(third.cursor).notes.length, 0);
    assert.equal(f.versions.changes(third.cursor + 100).reset, true);
  } finally { f.close(); }
});

test("historical media is resolved to an immutable uploaded object and remains available", () => {
  const f = fixture();
  try {
    const id = randomUUID(), remote = { id, name: "image.png", mimeType: "image/png", size: 123, url: "/api/attachments/" + id };
    f.db.prepare("INSERT INTO attachments VALUES (?,?)").run(id, JSON.stringify(remote));
    const note = prepare(createNote({ plainText: "Photo", attachments: [{ ...remote, url: "local:" + id }],
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { id, src: "local:" + id } }] }] } }));
    const saved = f.versions.sync(note.id, [change(note)]).note;
    assert.equal(saved.attachments[0].url, remote.url);
    assert.ok(JSON.stringify(saved.body).includes(remote.url));
    assert.equal(f.versions.version(note.id, 1)!.attachments[0].url, remote.url);
  } finally { f.close(); }
});

test("a thousand text saves use deltas and survive a database backup with complete history", t => {
  const f = fixture();
  try {
    let entropy = 0x13579bdf;
    const text = Array.from({ length: 20000 }, () => { entropy ^= entropy << 13; entropy ^= entropy >>> 17; entropy ^= entropy << 5; return String.fromCharCode(33 + ((entropy >>> 0) % 90)); }).join("");
    const seed = prepare(createNote({ plainText: text }));
    const initial = f.versions.sync(seed.id, [change(seed)]).note;
    const doc = open(initial.replica);
    let authored = initial;
    let pending: NoteChange[] = [], compressedSnapshots = 0;
    const save = (update: Uint8Array) => {
      authored = project(doc, { revision: 1, updatedAt: initial.updatedAt });
      pending.push({ id: randomUUID(), update: encode(update), snapshot: encode(Y.encodeSnapshot(Y.snapshot(doc))), baseRevision: 1, authoredAt: initial.updatedAt, origin: "ios" });
    };
    doc.on("update", save);
    for (let index = 0; index < 1000; index++) {
      const value = text + ".".repeat(index + 1);
      setBody(doc, textToDocument(value));
      compressedSnapshots += gzipSync(Buffer.from(JSON.stringify({ ...authored, replica: undefined }))).length;
      if (pending.length >= 64) { f.versions.sync(seed.id, pending); pending = []; }
    }
    if (pending.length) f.versions.sync(seed.id, pending);
    doc.destroy();
    const bytes = Number(f.db.prepare("SELECT SUM(length(payload)) AS bytes FROM note_history_blobs").get()!.bytes);
    assert.ok(bytes < compressedSnapshots / 4, `archive ${bytes} vs full compressed snapshots ${compressedSnapshots}`);
    assert.equal(f.versions.get(seed.id)!.plainText, text + ".".repeat(1000));
    const backup = join(f.directory, "backup.sqlite");
    f.db.prepare("VACUUM INTO ?").run(backup);
    const databaseBytes = statSync(backup).size;
    assert.ok(databaseBytes < compressedSnapshots / 4);
    t.diagnostic(JSON.stringify({ versions: 1001, compressedBlobBytes: bytes, databaseBytes, fullCompressedSnapshots: compressedSnapshots }));
    const restoredDB = new DatabaseSync(backup), restored = new VersionStore(restoredDB);
    try {
      assert.equal(restored.versions(seed.id, Number.MAX_SAFE_INTEGER, 100).length, 100);
      assert.equal(restored.version(seed.id, 501)!.plainText, text + ".".repeat(500));
      assert.equal(restored.authoredVersion(seed.id, 501)!.plainText, text + ".".repeat(500));
      assert.ok(sameState(restored.get(seed.id)!.replica!, f.versions.get(seed.id)!.replica!));
    } finally { restoredDB.close(); }
  } finally { f.close(); }
});

test("three offline writers converge with reordered duplicate delivery of text, formatting, tasks and tags", () => {
  const paragraph = (text: string, bold = false) => ({ type: "paragraph", content: [{ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) }] });
  const base = prepare(createNote({ plainText: "Core\nTask\nCell", body: { type: "doc", content: [
    paragraph("Core"), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("Task")] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Cell")] }] }] },
  ] } }));
  const initialChange = change(base);
  const clone = () => structuredClone(base);
  const a = clone(); a.body.content![0] = paragraph("Phone Core"); a.plainText = "Phone Core\nTask\nCell"; a.tags = ["Phone"];
  const b = clone(); b.body.content![0] = paragraph("Core Mac"); b.plainText = "Core Mac\nTask\nCell"; b.pinned = true;
  const c = clone(); c.body.content![0] = paragraph("Core", true); c.body.content![1].content![0].attrs!.checked = true; c.tags = ["Web"];
  const branches = [a, b, c].map(note => prepare(note));
  const updates = branches.map(note => change(note, base));
  let finalReplica: Note["replica"];
  for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0]]) {
    const f = fixture();
    try {
      f.versions.sync(base.id, [initialChange]);
      for (const index of [...order, ...order.toReversed()]) f.versions.sync(base.id, [updates[index]]);
      const final = f.versions.get(base.id)!;
      assert.equal(final.plainText, "Phone Core Mac\nTask\nCell");
      assert.equal(final.pinned, true); assert.deepEqual(new Set(final.tags), new Set(["Phone", "Web"]));
      assert.equal(final.body.content![1].content![0].attrs!.checked, true);
      assert.ok(JSON.stringify(final.body).includes('"bold"'));
      assert.equal(f.versions.versions(base.id).length, 4);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n, 1);
      if (finalReplica) assert.ok(sameState(finalReplica, final.replica!)); else finalReplica = final.replica;
      for (let index = 0; index < 3; index++) {
        const receipt = f.db.prepare("SELECT revision FROM note_sync_receipts WHERE note_id=? AND change_id=?").get(base.id, updates[index].id)!;
        assert.equal(f.versions.authoredVersion(base.id, Number(receipt.revision))!.plainText, branches[index].plainText);
      }
    } finally { f.close(); }
  }
});
