import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote } from "@doompile/core";
import { groupFeed } from "./feed-groups";
test("pinned notes across several days form one collapsible group; regular notes remain grouped by local date", () => {
  const notes = [
    createNote({ pinned: true, createdAt: "2026-10-29T12:00:00Z" }),
    createNote({ pinned: true, createdAt: "2026-10-27T12:00:00Z" }),
    createNote({ createdAt: "2026-10-29T12:00:00Z" }),
    createNote({ createdAt: "2026-10-28T12:00:00Z" }),
    createNote({ createdAt: "2026-10-28T13:00:00Z" }),
  ];
  const groups = groupFeed(notes);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].id, "pinned");
  assert.equal(groups[0].notes.length, 2);
  assert.equal(groups[2].notes.length, 2);
  assert.deepEqual(
    groups.flatMap((g) => g.notes).map((n) => n.id),
    [notes[0], notes[1], notes[2], notes[3], notes[4]].map((n) => n.id),
  );
});
