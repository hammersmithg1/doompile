import { test } from "node:test";
import assert from "node:assert/strict";
import { Autosave } from "./autosave";

test("typing bursts coalesce and flushing saves the latest edit immediately", async () => {
  const writes: string[] = [];
  const save = new Autosave<string>(
    async (text) => {
      writes.push(text);
    },
    (error) => {
      throw error;
    },
    60_000,
  );
  save.schedule("a");
  save.schedule("ab");
  save.schedule("abc");
  assert.deepEqual(writes, []);
  await save.flush();
  assert.deepEqual(writes, ["abc"]);
});
test("an edit made during a save is serialized after the in-flight write", async () => {
  const writes: string[] = [];
  let resolve!: () => void;
  const first = new Promise<void>((done) => {
    resolve = done;
  });
  const save = new Autosave<string>(
    async (text) => {
      writes.push(text);
      if (text === "first") await first;
    },
    (error) => {
      throw error;
    },
    60_000,
  );
  save.schedule("first");
  const flush = save.flush();
  await Promise.resolve();
  save.schedule("second");
  save.schedule("third");
  assert.deepEqual(writes, ["first"]);
  resolve();
  await flush;
  assert.deepEqual(writes, ["first", "third"]);
});
test("a failed save remains retryable and never replaces a newer pending edit", async () => {
  const writes: string[] = [];
  let fail = true;
  const save = new Autosave<string>(
    async (text) => {
      if (fail) {
        fail = false;
        throw new Error("offline disk");
      }
      writes.push(text);
    },
    () => {},
    60_000,
  );
  save.schedule("draft");
  await assert.rejects(save.flush());
  await save.flush();
  assert.deepEqual(writes, ["draft"]);
  save.schedule("newer");
  await save.flush();
  assert.deepEqual(writes, ["draft", "newer"]);
});
test("delay saves without a manual action", async () => {
  const writes: string[] = [];
  const save = new Autosave<string>(
    async (text) => {
      writes.push(text);
    },
    (error) => {
      throw error;
    },
    5,
  );
  save.schedule("body");
  await new Promise((done) => setTimeout(done, 25));
  assert.deepEqual(writes, ["body"]);
});

test("concurrent flush callers wait until newer pending edits are also written", async () => {
  const writes: string[] = [];
  let resolve!: () => void;
  const first = new Promise<void>((done) => {
    resolve = done;
  });
  const save = new Autosave<string>(
    async (text) => {
      if (text === "old") await first;
      writes.push(text);
    },
    (error) => {
      throw error;
    },
    60_000,
  );
  save.schedule("old");
  const one = save.flush();
  await Promise.resolve();
  save.schedule("new");
  const two = save.flush();
  resolve();
  await two;
  assert.deepEqual(writes, ["old", "new"]);
  await one;
});
