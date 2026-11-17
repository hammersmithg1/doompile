import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createNote } from "@doompile/core";
import { syncOutbox, type OutboxRepository } from "./sync-outbox";
import type { StoredRecord } from "./local-notes";
import { stage } from "../../../../packages/sync/client";
import { VersionStore } from "../server/versions";
function record(text: string): StoredRecord {
  const value = stage(undefined, createNote({ plainText: text }));
  return { ...value, baseRevision: 0, dirty: true, pending: 1 };
}
function fixture(rows: StoredRecord[]) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE attachments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  const versions = new VersionStore(db), records = new Map(rows.map(row => [row.note.id, row]));
  let cursor = 0, pulled = false;
  const errors: string[] = [];
  const repository: OutboxRepository = {
    pending: async () => [...records.values()],
    accept: async (sent, _server, ids) => { assert.deepEqual(ids, sent.changes?.map(change => change.id)); records.delete(sent.note.id); return [sent.note.id]; },
    error: async id => { errors.push(id); return [id]; }, cursor: async () => cursor,
    merge: async (_notes, next) => { pulled = true; cursor = next!; return []; },
  };
  const transport = async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/notes?")) return Response.json(versions.changes(Number(new URL(url, "https://test.invalid").searchParams.get("cursor"))));
    const id = url.split("/")[3], { changes } = JSON.parse(String(init?.body));
    return Response.json(versions.sync(id, changes));
  };
  return { repository, transport, errors, records, versions, db, get pulled() { return pulled; }, get cursor() { return cursor; } };
}
test("a rejected note does not block other changes or paginated collection pull", async () => {
  const bad = record("Bad"), good = record("Good"), f = fixture([bad, good]);
  try {
    const result = await syncOutbox(f.repository, async () => {}, (url, init) => url.includes(bad.note.id) ? Promise.resolve(Response.json({ error: "bad" }, { status: 400 })) : f.transport(url, init));
    assert.equal(result.failed, 1); assert.equal(f.pulled, true);
    assert.deepEqual(f.errors, [bad.note.id]); assert.equal(f.records.has(good.note.id), false);
    assert.equal(f.versions.versions(good.note.id).length, 1);
  } finally { f.db.close(); }
});
test("a lost committed reply retries identical bytes without another version", async () => {
  const row = record("Keep me"), f = fixture([row]), payloads: string[] = [];
  try {
    await assert.rejects(syncOutbox(f.repository, async () => {}, async (url, init) => {
      payloads.push(String(init?.body)); await f.transport(url, init); throw new Error("Response lost");
    }, false));
    await syncOutbox(f.repository, async () => {}, async (url, init) => { payloads.push(String(init?.body)); return f.transport(url, init); }, false);
    assert.equal(payloads[0], payloads[1]);
    assert.equal(f.versions.versions(row.note.id).length, 1);
    assert.equal(f.records.size, 0);
  } finally { f.db.close(); }
});
test("autosave delivers deltas without downloading the collection or advancing its cursor", async () => {
  const row = record("Typing"), f = fixture([row]);
  try {
    await syncOutbox(f.repository, async () => {}, async (url, init) => {
      assert.equal(url, `/api/notes/${row.note.id}/sync`); return f.transport(url, init);
    }, false);
    assert.equal(f.pulled, false); assert.equal(f.cursor, 0);
  } finally { f.db.close(); }
});
