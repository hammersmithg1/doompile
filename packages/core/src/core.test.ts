import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, documentText, formatTimestamp, noteSchema, textToDocument, timestampFromURL } from "./index";

test("plain text documents round-trip and preserve blank paragraphs", () => {
  const text = "A thought\n\nA second thought";
  assert.equal(documentText(textToDocument(text)), text);
});
test("many-to-many tags are unique and source quotes retain anchors", () => {
  const note = createNote({ tags: ["reading", "work", "reading"], source: { url: "https://example.com/article", quote: "Exact quote", selector: { type: "TextQuoteSelector", exact: "Exact quote", prefix: "before", suffix: "after" } } });
  const parsed = noteSchema.parse(note);
  assert.deepEqual(parsed.tags, ["reading", "work"]);
  assert.equal(parsed.source?.quote, "Exact quote");
});
test("rejects script URLs and invalid or unbounded rich text documents", () => {
  assert.equal(noteSchema.safeParse(createNote({ source: { url: "javascript:alert(1)" } })).success, false);
  assert.equal(noteSchema.safeParse({ ...createNote(), body: { type: "paragraph" } }).success, false);
  assert.equal(noteSchema.safeParse({ ...createNote(), body: { type: "doc", content: [{ type: "text", text: "bad", marks: [null] }] } }).success, false);
  assert.equal(noteSchema.safeParse({ ...createNote(), body: { type: "doc", content: [{ type: "attachment", attrs: { name: { bad: true } } }] } }).success, false);
  let content: object = { type: "text", text: "deep" };
  for (let i = 0; i < 50; i++) content = { type: "blockquote", content: [content] };
  assert.equal(noteSchema.safeParse({ ...createNote(), body: { type: "doc", content: [content] } }).success, false);
});
test("YouTube timestamp formats parse without inventing absent timestamps", () => {
  assert.equal(timestampFromURL("https://youtu.be/abc?t=125"), 125);
  assert.equal(timestampFromURL("https://www.youtube.com/watch?v=abc&t=1h2m3s"), 3723);
  assert.equal(timestampFromURL("https://youtube.com/watch?v=abc&start=60"), 60);
  assert.equal(timestampFromURL("https://youtube.com/watch?v=abc#t=45s"), 45);
  assert.equal(timestampFromURL("https://youtu.be/abc"), undefined);
  assert.equal(timestampFromURL("https://youtu.be/abc?t=nonsense"), undefined);
  assert.equal(formatTimestamp(3723), "1:02:03");
});
