import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { createNote, textToDocument, type Note } from "../core/src/index";
import { applySnapshot, canonical, decode, delta, documentPlainText, merge, open, prepare, project, sameState, state } from "./model";

const edit = (note: Note, text: string) => prepare({ ...note, body: textToDocument(text), plainText: text });
const visible = (note: Note) => { const { replica: _, ...rest } = note; return rest; };

test("two offline edits of one paragraph converge without a second note", () => {
  const base = prepare(createNote({ plainText: "One shared sentence." }));
  const phone = edit(base, "Phone: One shared sentence.");
  const mac = edit(base, "One shared sentence. Mac.");
  const a = merge(phone, mac), b = merge(mac, phone);
  assert.equal(a.id, base.id);
  assert.equal(a.plainText, "Phone: One shared sentence. Mac.");
  assert.deepEqual(visible(a), visible(b));
  assert.ok(sameState(a.replica!, b.replica!));
  assert.ok(sameState(a.replica!, merge(a, mac).replica!));
});

test("metadata fields, tag additions and edits of the same attachment merge independently", () => {
  const file = { id: crypto.randomUUID(), name: "Before.png", mimeType: "image/png", size: 10, url: "/api/attachments/" + crypto.randomUUID() };
  const base = prepare(createNote({ plainText: "Metadata", tags: ["Work"], attachments: [file] }));
  const phone = prepare({ ...base, pinned: true, tags: [...base.tags, "Phone"], attachments: [{ ...file, name: "Renamed.png" }] });
  const mac = prepare({ ...base, urgent: true, tags: [...base.tags, "Mac"], attachments: [{ ...file, size: 20 }] });
  const a = merge(phone, mac), b = merge(mac, phone);
  assert.equal(a.pinned, true); assert.equal(a.urgent, true);
  assert.deepEqual(new Set(a.tags), new Set(["Work", "Phone", "Mac"]));
  assert.equal(a.attachments[0].name, "Renamed.png");
  assert.equal(a.attachments[0].size, 20);
  assert.deepEqual(visible(a), visible(b));
});

test("repeated and out-of-order deliveries survive persisting the receiver midway", () => {
  const base = prepare(createNote({ plainText: "Base" }));
  const first = edit(base, "Base first");
  const second = edit(first, "Base first second");
  const one = delta(first.replica!, base.replica), two = delta(second.replica!, first.replica);
  const receiver = open(base.replica);
  Y.applyUpdate(receiver, decode(two));
  assert.equal(sameState(state(receiver), base.replica!), false);
  const restarted = open(state(receiver)); receiver.destroy();
  try {
    Y.applyUpdate(restarted, decode(one)); Y.applyUpdate(restarted, decode(two));
    Y.applyUpdate(restarted, decode(one));
    assert.equal(project(restarted, base).plainText, second.plainText);
    assert.ok(sameState(state(restarted), second.replica!));
  } finally { restarted.destroy(); }
});

test("a small edit of a long note yields a small history delta", () => {
  const base = prepare(createNote({ plainText: "A long existing paragraph. ".repeat(2000) }));
  const next = edit(base, base.plainText + "New ending.");
  const change = delta(next.replica!, base.replica);
  assert.ok(change.length < 1000, `Unexpected full snapshot: ${change.length} bytes`);
  assert.ok(change.length < next.replica!.data.length / 20);
});

test("offline autosave deltas retain an earlier version even after its text is deleted", () => {
  const base = prepare(createNote({ plainText: "Start" }));
  const first = edit(base, "Start important offline text");
  const second = edit(first, "Start final text");
  const reader = open(base.replica);
  try {
    Y.applyUpdate(reader, decode(delta(first.replica!, base.replica)));
    assert.equal(project(reader, base).plainText, first.plainText);
    Y.applyUpdate(reader, decode(delta(second.replica!, first.replica)));
    assert.equal(project(reader, base).plainText, second.plainText);
  } finally { reader.destroy(); }
});

test("unknown rich blocks and attributes remain present through CRDT edits", () => {
  const body = { type: "doc", attrs: { editorVersion: 1 }, content: [
    { type: "paragraph", attrs: { futureIndent: 7 }, content: [{ type: "text", text: "Before" }] },
    { type: "futureDiagram", attrs: { customBlob: { important: [1, 2, 3] } }, content: [{ type: "text", text: "Future data" }] },
  ] };
  const base = prepare(createNote({ plainText: "Before", body }));
  const next = prepare({ ...base, body: { ...body, content: [{ ...body.content[0], content: [{ type: "text", text: "After" }] }, body.content[1]] } });
  assert.ok(canonical(next.body).includes('"customBlob":{"important":[1,2,3]}'));
  assert.ok(canonical(next.body).includes('"futureIndent":7'));
  assert.ok(canonical(next.body).includes('"type":"futureDiagram"'));
});

test("restore is a new edit in the same replica, retaining later concurrent work", () => {
  const base = prepare(createNote({ plainText: "First" }));
  const later = edit(base, "First second");
  const doc = open(later.replica);
  try {
    applySnapshot(doc, { ...later, body: base.body, plainText: base.plainText });
    const restored = project(doc, later);
    assert.equal(restored.id, base.id); assert.equal(restored.plainText, "First");
    const concurrent = edit(later, "First second phone");
    const a = merge(restored, concurrent), b = merge(concurrent, restored);
    assert.deepEqual(visible(a), visible(b));
    assert.ok(sameState(a.replica!, b.replica!));
  } finally { doc.destroy(); }
});

test("repeated local preparation does not author identical changes", () => {
  const initial = prepare(createNote({ plainText: "Сохрани Unicode 👩🏽‍💻 é" }));
  assert.equal(documentPlainText(initial.body), "Сохрани Unicode 👩🏽‍💻 é");
  const again = prepare(initial);
  assert.ok(sameState(initial.replica!, again.replica!));
  assert.equal(again.replica!.data, initial.replica!.data);
});
