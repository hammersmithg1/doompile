import type { Attachment, DocumentNode } from "@doompile/core";
export function finishRecordingDocument(
  body: DocumentNode,
  id: string,
  attachment: Attachment,
): DocumentNode {
  let found = false;
  let completed = false;
  const replace = (node: DocumentNode): DocumentNode => {
    if (node.type === "attachment" && node.attrs?.recordingId === id)
      completed = true;
    if (node.type === "recording" && node.attrs?.id === id) {
      found = true;
      return { type: "attachment", attrs: { ...attachment, recordingId: id } };
    }
    return node.content
      ? { ...node, content: node.content.map(replace) }
      : node;
  };
  const updated = replace(body);
  return found || completed
    ? updated
    : {
        ...updated,
        content: [
          ...(updated.content || []),
          { type: "attachment", attrs: { ...attachment, recordingId: id } },
          { type: "paragraph" },
        ],
      };
}

/** Merge a completed recording into a newer text draft without replacing its text. */
export function reconcileFinishedRecordings(
  draft: import("@doompile/core").Note,
  saved: import("@doompile/core").Note,
) {
  const completed = new Map<string, DocumentNode>();
  const collect = (node: DocumentNode) => {
    if (
      node.type === "attachment" &&
      typeof node.attrs?.recordingId === "string"
    )
      completed.set(node.attrs.recordingId, node);
    node.content?.forEach(collect);
  };
  collect(saved.body);
  const attachments = [...draft.attachments];
  const replace = (node: DocumentNode): DocumentNode => {
    const done =
      node.type === "recording"
        ? completed.get(String(node.attrs?.id))
        : undefined;
    if (done) {
      const media = saved.attachments.find(
        (item) => item.url === done.attrs?.url,
      );
      if (media && !attachments.some((item) => item.id === media.id))
        attachments.push(media);
      return done;
    }
    return node.content
      ? { ...node, content: node.content.map(replace) }
      : node;
  };
  return { ...draft, body: replace(draft.body), attachments };
}
export function findFinishedRecording(
  note: import("@doompile/core").Note,
  id: string,
): Attachment | undefined {
  let attachment: Attachment | undefined;
  const visit = (node: DocumentNode) => {
    if (node.type === "attachment" && node.attrs?.recordingId === id)
      attachment = note.attachments.find(
        (item) => item.url === node.attrs?.url,
      );
    node.content?.forEach(visit);
  };
  visit(note.body);
  return attachment;
}
