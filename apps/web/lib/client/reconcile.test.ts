import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledge, conflictCopy, localEdit } from "./reconcile";
import { createNote } from "@doompile/core";
test("queued autosaves use this writer's latest acknowledged revision", () => {
  const opened = createNote({ plainText: "Opened", revision: 1 });
  let current = {
    note: opened,
    baseRevision: 1,
    dirty: false,
    writer: "this-tab",
  };
  for (let revision = 2; revision < 12; revision++) {
    const queued = { ...opened, plainText: `Edit ${revision}` };
    const edit = localEdit(current, queued, "this-tab");
    assert.equal(edit.baseRevision, revision - 1);
    assert.equal(edit.note.revision, revision - 1);
    assert.equal(edit.note.id, opened.id);
    current = {
      ...acknowledge(edit, edit.note, { ...edit.note, revision }),
      writer: "this-tab",
    };
    assert.equal(current.dirty, false);
  }
});
test("a stale edit after another tab or remote merge retains its original base", () => {
  const opened = createNote({ plainText: "Opened", revision: 1 });
  const remote = { ...opened, plainText: "Another edit", revision: 3 };
  for (const writer of ["another-tab", undefined]) {
    const edit = localEdit(
      { note: remote, baseRevision: 3, dirty: false, writer },
      { ...opened, plainText: "Local edit" },
      "this-tab",
    );
    assert.equal(
      edit.baseRevision,
      1,
      "A real concurrent edit must still be preserved as a conflict",
    );
  }
});
test("acknowledging an old save preserves newer local typing", () => {
  const sent = createNote({ plainText: "first" });
  const current = {
    note: {
      ...sent,
      plainText: "second",
      updatedAt: "2026-10-29T19:00:00.000Z",
    },
    baseRevision: 0,
    dirty: true,
  };
  const result = acknowledge(current, sent, { ...sent, revision: 1 });
  assert.equal(result.note.plainText, "second");
  assert.equal(result.baseRevision, 1);
  assert.equal(result.dirty, true);
});
test("acknowledgement without intervening edits clears the outbox", () => {
  const note = createNote({ plainText: "saved" });
  const saved = { ...note, revision: 1 };
  assert.deepEqual(
    acknowledge({ note, baseRevision: 0, dirty: true }, note, saved),
    { note: saved, baseRevision: 1, dirty: false },
  );
});
test("conflict copies retain source, attachments and text", () => {
  const note = createNote({
    plainText: "a thought",
    source: { url: "https://example.com", quote: "fragment" },
  });
  const result = conflictCopy(note, "new-id", "2026-10-29T19:00:00.000Z");
  assert.deepEqual(result.note.source, note.source);
  assert.equal(result.note.plainText, note.plainText);
  assert.equal(result.baseRevision, 0);
  assert.equal(result.dirty, true);
  assert.equal(result.note.id, "new-id");
});
