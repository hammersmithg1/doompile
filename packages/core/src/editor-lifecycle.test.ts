import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, compareNoteCreation, shouldPersistNote } from "./index";
const cases = JSON.parse(readFileSync(new URL("../test-fixtures/editor-lifecycle.json", import.meta.url), "utf8"));
for (const value of cases) test(`shared close contract: ${value.name}`, () => {
  assert.equal(shouldPersistNote(createNote(value)), value.expected);
  assert.equal(shouldPersistNote(createNote(value), true), true, "existing notes retain deliberate empty edits");
});
test("unpinning, editing and urgency retain creation position", () => {
  const old = createNote({createdAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-31T00:00:00.000Z",pinned:true,urgent:true});
  const newer = createNote({createdAt:"2026-10-02T00:00:00.000Z",updatedAt:"2026-10-02T00:00:00.000Z"});
  assert.deepEqual([old,newer].sort(compareNoteCreation).map(n=>n.id),[newer.id,old.id]);
  assert.deepEqual([{...old,pinned:false,urgent:false,updatedAt:new Date().toISOString()},newer].sort(compareNoteCreation).map(n=>n.id),[newer.id,old.id]);
});
