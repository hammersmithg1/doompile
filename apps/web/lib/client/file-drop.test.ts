import { test } from "node:test";
import assert from "node:assert/strict";
import { installFileDrop } from "./file-drop";
function drag(type: string, files: File[] = [], types = ["Files"]) {
  return Object.assign(new Event(type, { cancelable: true }), {
    dataTransfer: { files, types, dropEffect: "none" },
  });
}
test("Window drops attach every file, prevent browser navigation and clean up listeners", () => {
  const target = new EventTarget(),
    active: boolean[] = [],
    received: File[][] = [];
  const cleanup = installFileDrop(
    target,
    (files) => received.push(files),
    (value) => active.push(value),
  );
  const files = [
    new File(["binary"], "archive.zip"),
    new File(["image"], "photo.png"),
  ];
  const enter = drag("dragenter"),
    over = drag("dragover"),
    drop = drag("drop", files);
  target.dispatchEvent(enter);
  target.dispatchEvent(over);
  target.dispatchEvent(drop);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, "copy");
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(received, [files]);
  assert.deepEqual(active, [true, false]);
  cleanup();
  target.dispatchEvent(drag("drop", files));
  assert.equal(received.length, 1);
});
test("Nested drag transitions keep the overlay visible; text drags and handled editor drops are left alone", () => {
  const target = new EventTarget(),
    active: boolean[] = [],
    received: File[][] = [];
  const cleanup = installFileDrop(
    target,
    (files) => received.push(files),
    (value) => active.push(value),
  );
  const text = drag("dragover", [], ["text/plain"]);
  target.dispatchEvent(text);
  assert.equal(text.defaultPrevented, false);
  assert.deepEqual(active, []);
  target.dispatchEvent(drag("dragenter"));
  target.dispatchEvent(drag("dragenter"));
  target.dispatchEvent(drag("dragleave"));
  assert.equal(active.at(-1), true);
  target.dispatchEvent(drag("dragleave"));
  assert.equal(active.at(-1), false);
  const handled = drag("drop", [new File(["voice"], "voice.wav")]);
  handled.preventDefault();
  target.dispatchEvent(handled);
  assert.equal(received.length, 0);
  target.dispatchEvent(drag("dragenter"));
  target.dispatchEvent(new Event("blur"));
  assert.equal(active.at(-1), false);
  cleanup();
});

test("explicit zones keep rejected drops out of the quick composer", () => {
  const target = new EventTarget(),
    files = [new File(["body"], "note.txt")],
    received: File[][] = [];
  const cleanup = installFileDrop(
    target,
    (value) => received.push(value),
    () => {},
    { accept: () => false },
  );
  const event = drag("drop", files);
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(received, []);
  cleanup();
});
