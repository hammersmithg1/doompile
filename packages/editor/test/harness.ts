import { createBlockEditor } from "../src/block-editor";
const changes: unknown[] = [],
  actions: string[] = [],
  references: string[] = [];
const controller = createBlockEditor(document.getElementById("editor")!, {
  notes: [
    { id: "note-one", title: "Первая заметка" },
    { id: "note-two", title: "Вторая мысль" },
  ],
  onChange: (body, text) => changes.push({ body, text }),
  onAction: (action) => actions.push(action),
  onReference: (id) => references.push(id),
});
Object.assign(window, {
  testEditor: controller.editor,
  controller,
  changes,
  actions,
  references,
});
