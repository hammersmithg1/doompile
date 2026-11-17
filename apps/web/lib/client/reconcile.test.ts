import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, textToDocument } from "@doompile/core";
import { stage, receive } from "../../../../packages/sync/client";
import { prepare, sameState } from "../../../../packages/sync/model";

test("a stale editor and another tab merge without changing note identity", () => {
  const base = prepare(createNote({ plainText: "Shared", revision: 1 }));
  const remote = prepare({ ...base, body: textToDocument("Shared Mac"), plainText: "Shared Mac" });
  const local = { ...base, body: textToDocument("Phone Shared"), plainText: "Phone Shared" };
  const result = stage({ note: remote, baseRevision: 2, dirty: false }, local);
  assert.equal(result.note.id, base.id);
  assert.equal(result.note.plainText, "Phone Shared Mac");
  assert.equal(result.changes.length, 1);
  assert.equal(receive(result.note, remote).plainText, result.note.plainText);
});
test("a newer local snapshot is never overwritten by an earlier reply", () => {
  const first = stage(undefined, createNote({ plainText: "Shared" }));
  const newer = stage({ note: first.note, baseRevision: 0, dirty: true }, { ...first.note, body: textToDocument("Shared newer"), plainText: "Shared newer" });
  const merged = receive(newer.note, { ...first.note, revision: 1 });
  assert.equal(merged.plainText, "Shared newer");
  assert.equal(merged.revision, 1);
  assert.equal(merged.id, first.note.id);
});
test("metadata already applied in memory is included in the durable journal", () => {
  const base = prepare(createNote({ plainText: "Shared" }));
  const pinned = prepare({ ...base, pinned: true });
  const result = stage({ note: base, baseRevision: 0, dirty: false }, pinned);
  assert.equal(result.changes.length, 1);
  assert.equal(result.note.pinned, true);
  const again = stage({ note: result.note, baseRevision: 0, dirty: true }, pinned);
  assert.equal(again.changes.length, 0);
});
test("a new replica can be saved after editing a private draft", () => {
  const privateDraft = prepare(createNote({ plainText: "Draft" }));
  const result = stage(undefined, privateDraft);
  assert.equal(result.changes.length, 1);
  assert.ok(result.changes[0].update.length);
  assert.equal(result.note.id, privateDraft.id);
});

test("an older caller without replica context edits a caption without independently seeding duplicate blocks", () => {
  const original = createNote({ plainText: "Before" });
  const first = stage(undefined, original);
  const edited = stage({ note: first.note, baseRevision: 0, dirty: true, legacyBaseline: first.legacyBaseline }, { ...original, plainText: "New caption" });
  assert.equal(edited.note.plainText, "New caption");
  assert.equal(edited.note.body.content?.length, 1);
  assert.equal(edited.note.id, original.id);
  assert.equal(edited.changes.length, 1);
});
