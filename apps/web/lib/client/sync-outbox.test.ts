import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, type Note } from "@doompile/core";
import { syncOutbox, type OutboxRepository } from "./sync-outbox";
import type { LocalRecord } from "./reconcile";

test("a rejected first note does not block later saves or remote changes", async () => {
  const bad = createNote({ plainText: "Bad legacy note" });
  const good = createNote({ plainText: "Good" });
  const records = new Map(
    [bad, good].map((note) => [
      note.id,
      { note, baseRevision: 0, dirty: true },
    ]),
  );
  const errors: string[] = [],
    requests: string[] = [];
  let pulled = false;
  const repository: OutboxRepository = {
    pending: async () => [...records.values()],
    accept: async (sent) => {
      records.delete(sent.id);
      return [sent.id];
    },
    conflict: async () => assert.fail("Unexpected conflict"),
    error: async (id) => {
      errors.push(id);
      return [id];
    },
    merge: async () => {
      pulled = true;
      return [];
    },
  };
  const result = await syncOutbox(
    repository,
    async () => {},
    async (url, init) => {
      requests.push(url);
      if (url === "/api/notes") return Response.json({ notes: [] });
      const { note } = JSON.parse(init!.body as string);
      return note.id === bad.id
        ? Response.json({ error: "Bad note" }, { status: 400 })
        : Response.json({ note: { ...note, revision: 1 } });
    },
  );
  assert.equal(result.failed, 1);
  assert.equal(pulled, true);
  assert.deepEqual(errors, [bad.id]);
  assert.equal(records.has(good.id), false);
  assert.equal(
    requests.filter((url) => url.endsWith(bad.id)).length,
    1,
    "Do not retry the poison note ten times in one sync",
  );
});
test("network failure leaves the operation retryable with the same payload", async () => {
  const note = createNote({ plainText: "Keep me" });
  const records: LocalRecord[] = [{ note, baseRevision: 0, dirty: true }];
  const sent: string[] = [];
  const repository: OutboxRepository = {
    pending: async () => records,
    accept: async () => {
      records.length = 0;
      return [note.id];
    },
    conflict: async () => [],
    error: async () => [],
    merge: async () => [],
  };
  await assert.rejects(
    syncOutbox(
      repository,
      async () => {},
      async (_url, init) => {
        sent.push(init!.body as string);
        throw new Error("Response lost");
      },
    ),
  );
  await syncOutbox(
    repository,
    async () => {},
    async (url, init) => {
      if (url === "/api/notes") return Response.json({ notes: [] });
      sent.push(init!.body as string);
      return Response.json({ note: { ...note, revision: 1 } });
    },
  );
  assert.equal(sent[0], sent[1]);
});

test("autosave sends only pending operations without downloading the collection", async () => {
  const note = createNote({ plainText: "Typing" });
  let pending: LocalRecord[] = [{ note, baseRevision: 0, dirty: true }];
  const repository: OutboxRepository = {
    pending: async () => pending,
    accept: async () => {
      pending = [];
      return [note.id];
    },
    conflict: async () => [],
    error: async () => [],
    merge: async () => assert.fail("Autosave must not download all notes"),
  };
  let requests = 0;
  await syncOutbox(
    repository,
    async () => {},
    async (url) => {
      assert.equal(url, `/api/notes/${note.id}`);
      requests++;
      return Response.json({ note: { ...note, revision: 1 } });
    },
    false,
  );
  assert.equal(requests, 1);
});
