import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { noteAppURL, noteIDFromURL, notePath, noteURL } from "./note-link";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../test-fixtures/note-links.json", import.meta.url),
    "utf8",
  ),
);
test("cross-platform note URL fixtures", () => {
  for (const fixture of fixtures)
    assert.equal(noteIDFromURL(fixture.url), fixture.expected, fixture.name);
});
test("copyable URLs contain only the origin and canonical note path", () => {
  const id = "A6AD6431-AD38-4533-92A0-C337487EF00B";
  assert.equal(notePath(id), "/notes/" + id.toLowerCase());
  assert.equal(
    noteURL(id, "https://notes.example.test/settings?token=private#secret"),
    "https://notes.example.test/notes/" + id.toLowerCase(),
  );
  assert.equal(noteAppURL(id), "doompile://note/" + id.toLowerCase());
  assert.throws(() => notePath("../../secret"));
  assert.throws(() => noteURL(id, "https://user:token@example.com"));
});
