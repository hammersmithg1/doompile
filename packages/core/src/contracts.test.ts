import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, normalizeNote, noteSchema, NOTE_LIMITS } from "./index";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../test-fixtures/note-contract.json", import.meta.url),
    "utf8",
  ),
);
for (const fixture of fixtures)
  test(`wire contract: ${fixture.name}`, () => {
    const note = createNote({ title: fixture.title || "" });
    // Apply wire values after normalization: invalid peers must be rejected by API.
    note.title = fixture.titleLength
      ? "x".repeat(fixture.titleLength)
      : fixture.title;
    note.tags = fixture.tagLength
      ? ["x".repeat(fixture.tagLength)]
      : fixture.tags;
    note.attachments = Array.from({ length: fixture.attachmentCount }, () => ({
      id: crypto.randomUUID(),
      name: "file",
      mimeType: "application/octet-stream",
      url: `/api/attachments/${crypto.randomUUID()}`,
      size: 1,
    }));
    assert.equal(noteSchema.safeParse(note).success, fixture.valid);
  });
test("metadata normalization preserves long authored text and unknown blocks", () => {
  const text = "a".repeat(NOTE_LIMITS.title + 1);
  const note = createNote({
    title: text,
    plainText: text,
    tags: [" idea ", "idea"],
    body: {
      type: "doc",
      content: [{ type: "futureWidget", attrs: { value: 42 } }],
    },
  });
  assert.equal(note.title.length, NOTE_LIMITS.title);
  assert.equal(note.plainText, text);
  assert.deepEqual(note.tags, ["idea"]);
  assert.equal(note.body.content![0].type, "futureWidget");
  assert.deepEqual(normalizeNote(note), note);
});

test("generated and normalized titles never cut a Unicode surrogate pair", () => {
  const text = "a".repeat(NOTE_LIMITS.generatedTitle - 1) + "😀";
  const generated = createNote({ plainText: text });
  assert.equal(generated.title.isWellFormed(), true);
  assert.equal(generated.plainText, text);
  const normalized = createNote({
    title: "a".repeat(NOTE_LIMITS.title - 1) + "😀",
  });
  assert.equal(normalized.title.isWellFormed(), true);
  assert.equal(normalized.title.length, NOTE_LIMITS.title - 1);
});
