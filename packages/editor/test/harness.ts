import * as sync from "../../sync/model";
import * as Y from "yjs";
import { createBlockEditor } from "../src/block-editor";
const replicaEvents: unknown[] = [], syncErrors: string[] = [];
const changes: unknown[] = [],
  actions: string[] = [],
  references: string[] = [];
const controller = createBlockEditor(document.getElementById("editor")!, {
  onReplica: (note, change) => replicaEvents.push({ note, change }),
  onSyncError: message => syncErrors.push(message),
  notes: [
    { id: "note-one", title: "Первая заметка" },
    { id: "note-two", title: "Вторая мысль" },
  ],
  onChange: (body, text) => changes.push({ body, text }),
  onAction: (action) => actions.push(action),
  onReference: (id) => references.push(id),
});
Object.assign(window, {
  testEditor: controller.editor, sync, Y, replicaEvents, syncErrors,
  controller,
  changes,
  actions,
  references,
});
