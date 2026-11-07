import { Slice } from "@tiptap/pm/model";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import {
  UnsupportedBlock,
  UnsupportedInline,
  prepareForEditor,
  preserveAttributes,
  restoreDocument,
} from "../src/compatibility";
const extensions = [StarterKit, UnsupportedBlock, UnsupportedInline];
const schema = getSchema([
  ...extensions,
  preserveAttributes(getSchema(extensions)),
]);
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
function load(body: JSONContent) {
  return schema.nodeFromJSON(prepareForEditor(body, schema));
}

test("a future block survives editing known surrounding text without clearing the document", () => {
  const future = {
    type: "futureWidget",
    attrs: { id: "opaque", value: { answer: 42 } },
    content: [paragraph("Future data")],
  };
  const doc = load({
    type: "doc",
    attrs: { futureVersion: 7 },
    content: [paragraph("Before"), future, paragraph("After")],
  });
  doc.check();
  assert.equal(doc.child(1).type.name, "unsupportedBlock");
  const changed = EditorState.create({ doc }).tr.insertText("!", 2).doc;
  const wire = restoreDocument(changed.toJSON());
  assert.equal(wire.content![0].content![0].text, "B!efore");
  assert.deepEqual(wire.content![1], future);
  assert.equal(wire.content![2].content![0].text, "After");
  assert.equal(wire.attrs!.futureVersion, 7);
  assert.deepEqual(restoreDocument(load(wire).toJSON()).content![1], future);
});
test("unknown inline nodes and marks remain opaque without losing adjacent text", () => {
  const inline = { type: "futureMention", attrs: { value: "Keep me" } };
  const marked = {
    type: "text",
    text: "Future formatting",
    marks: [{ type: "futureMark", attrs: { color: "blue" } }],
  };
  const doc = load({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before" },
          inline,
          marked,
          { type: "text", text: "After" },
        ],
      },
    ],
  });
  doc.check();
  const content = restoreDocument(doc.toJSON()).content![0].content!;
  assert.deepEqual(content[1], inline);
  assert.deepEqual(content[2], marked);
  assert.equal(content[3].text, "After");
});
test("malformed known block is isolated and extra attributes of supported blocks survive", () => {
  const malformed = {
    type: "bulletList",
    content: [paragraph("Not a list item")],
  };
  const doc = load({
    type: "doc",
    content: [
      { ...paragraph("Known"), attrs: { futureColor: "blue" } },
      malformed,
      paragraph("After"),
    ],
  });
  doc.check();
  const wire = restoreDocument(doc.toJSON());
  assert.equal(wire.content![0].attrs!.futureColor, "blue");
  assert.deepEqual(wire.content![1], malformed);
  assert.equal(wire.content![2].content![0].text, "After");
  assert.doesNotMatch(
    JSON.stringify(wire),
    /doompilePreserved|unsupportedBlock|unsupportedInline/,
  );
});

test("plain inline clipboard slices do not become document error blocks", () => {
  const prepared = prepareForEditor(
    {
      type: "doc",
      content: [{ type: "text", text: "Copied", marks: [{ type: "bold" }] }],
    },
    schema,
    true,
  );
  const slice = Slice.fromJSON(schema, {
    content: prepared.content,
    openStart: 0,
    openEnd: 0,
  });
  assert.equal(slice.content.firstChild!.type.name, "text");
  assert.equal(slice.content.firstChild!.text, "Copied");
});
