import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote } from "@doompile/core";
import {
  finishRecordingDocument,
  findFinishedRecording,
  reconcileFinishedRecordings,
} from "./recording-document";
const attachment = {
  id: "d8e1a8cd-60a1-4a1c-b3fa-e76f79646ee7",
  url: "/api/attachments/d8e1a8cd-60a1-4a1c-b3fa-e76f79646ee7",
  name: "Voice.webm",
  mimeType: "audio/webm",
  size: 400,
};
test("completion replaces a recording inside the same list item", () => {
  const body = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph" },
              { type: "recording", attrs: { id: "rec" } },
            ],
          },
        ],
      },
    ],
  };
  const result = finishRecordingDocument(body, "rec", attachment);
  assert.equal(
    result.content?.[0].content?.[0].content?.[1].type,
    "attachment",
  );
  assert.equal(result.content?.length, 1);
  assert.deepEqual(finishRecordingDocument(result, "rec", attachment), result);
});
test("repeated recovery without a placeholder appends only one recording", () => {
  const original = createNote({ plainText: "Keep this text" }).body;
  const completed = finishRecordingDocument(original, "rec", attachment);
  assert.deepEqual(
    finishRecordingDocument(completed, "rec", attachment),
    completed,
  );
});
test("completion arriving after a newer text draft preserves its text and is recoverable without a duplicate upload", () => {
  const saved = createNote({
    body: {
      type: "doc",
      content: [{ type: "recording", attrs: { id: "rec" } }],
    },
    attachments: [attachment],
  });
  saved.body = finishRecordingDocument(saved.body, "rec", attachment);
  const draft = createNote({
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Newer typing" }],
        },
        { type: "recording", attrs: { id: "rec" } },
      ],
    },
  });
  const merged = reconcileFinishedRecordings(draft, saved);
  assert.equal(merged.body.content?.[0].content?.[0].text, "Newer typing");
  assert.equal(merged.body.content?.[1].type, "attachment");
  assert.deepEqual(findFinishedRecording(merged, "rec"), attachment);
  assert.deepEqual(reconcileFinishedRecordings(merged, saved), merged);
});
