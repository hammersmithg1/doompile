import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const textColors = [
  "",
  "#787774",
  "#9f6b53",
  "#c47624",
  "#a88713",
  "#32835d",
  "#2985b5",
  "#8755b5",
  "#b64b84",
  "#c44f4f",
];
export const highlightColors = [
  "",
  "#e7e5e4",
  "#e8d4c4",
  "#f6dbbd",
  "#f4e8a4",
  "#c8e5ce",
  "#c9e4f2",
  "#e0d3ee",
  "#f0d1e2",
  "#f5cecb",
];
export const colorNames = [
  "По умолчанию",
  "Серый",
  "Коричневый",
  "Оранжевый",
  "Жёлтый",
  "Зелёный",
  "Голубой",
  "Фиолетовый",
  "Розовый",
  "Красный",
];
const validColor = (value: unknown) =>
  typeof value === "string" && /^(#[\da-f]{3,8}|rgb\([\d\s,]+\))$/i.test(value)
    ? value
    : null;

export const TextColor = Mark.create({
  name: "textStyle",
  addAttributes: () => ({
    color: {
      default: null,
      parseHTML: (el) => validColor(el.style.color),
      renderHTML: (attrs) =>
        attrs.color
          ? { style: `color:${validColor(attrs.color) || "inherit"}` }
          : {},
    },
  }),
  parseHTML: () => [
    {
      tag: "span[style*=color]",
      getAttrs: (el) => ((el as HTMLElement).style.color ? {} : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes),
    0,
  ],
});
export const Highlight = Mark.create({
  name: "highlight",
  addAttributes: () => ({
    color: {
      default: "#f4e8a4",
      parseHTML: (el) => validColor(el.style.backgroundColor) || "#f4e8a4",
    },
  }),
  parseHTML: () => [{ tag: "mark" }, { tag: "span[style*=background-color]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "mark",
    {
      style: `background-color:${validColor(HTMLAttributes.color) || "#f4e8a4"};color:#20221f`,
    },
    0,
  ],
});
export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: () => ["sub", 0],
});
export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: () => ["sup", 0],
});

export function indentText(
  editor: Editor,
  direction: number,
  position?: number,
) {
  const { state, view } = editor;
  if (
    position === undefined &&
    (editor.isActive("listItem") || editor.isActive("taskItem"))
  ) {
    const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
    return direction > 0
      ? editor.commands.sinkListItem(type)
      : editor.commands.liftListItem(type);
  }
  if (position !== undefined) {
    const selection = TextSelection.create(state.doc, position);
    const listItems = [];
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const { type } = selection.$from.node(depth);
      if (type.name === "listItem" || type.name === "taskItem")
        listItems.push(type);
    }
    if (listItems.length) {
      if (direction < 0 && listItems.length === 1) return false;
      const bookmark = state.selection.getBookmark();
      const command = direction > 0 ? sinkListItem : liftListItem;
      return command(listItems[0])(
        state.apply(state.tr.setSelection(selection)),
        (tr) => {
          tr.setSelection(bookmark.map(tr.mapping).resolve(tr.doc));
          if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
          view.dispatch(closeHistory(tr));
        },
      );
    }
  }
  const from = position ?? state.selection.from;
  const to = position ?? state.selection.to;
  const tr = state.tr;
  let handled = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!["paragraph", "heading"].includes(node.type.name)) return;
    handled = true;
    const indent = Math.max(
      0,
      Math.min(6, (node.attrs.indent || 0) + direction),
    );
    if (indent !== node.attrs.indent)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
  });
  if (tr.docChanged)
    view.dispatch(position === undefined ? tr : closeHistory(tr));
  return handled;
}

function touchIndent(editor: Editor, view: EditorView) {
  const { dom } = view;
  const surface = dom.closest<HTMLElement>(".block-editor") || dom;
  const listeners = new AbortController();
  let gesture: {
    start: Touch;
    line: Element;
    startedAt: number;
    horizontal: boolean;
  } | null = null;
  const cancel = () => {
    gesture = null;
  };
  const hasSelection = () =>
    !view.state.selection.empty ||
    dom.ownerDocument.getSelection()?.isCollapsed === false;
  surface.addEventListener(
    "touchstart",
    (event) => {
      cancel();
      if (
        !view.editable ||
        view.composing ||
        hasSelection() ||
        event.touches.length !== 1
      )
        return;
      const start = event.touches[0];
      if (
        dom.ownerDocument.documentElement.dataset.nativeCapture !== "compact" &&
        (start.clientX < 8 || start.clientX > window.innerWidth - 24)
      )
        return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest("table, pre, a, button, input, label, [contenteditable=false]")
      )
        return;
      const position = view.posAtCoords({
        left: start.clientX + 24,
        top: start.clientY,
      });
      if (!position) return;
      const node = view.domAtPos(position.pos).node;
      const line = (node instanceof Element ? node : node.parentElement)
        ?.closest("p, h1, h2, h3");
      if (!line || !dom.contains(line) || line.closest("table, pre")) return;
      const bounds = line.getBoundingClientRect();
      if (
        start.clientX < bounds.left - 24 ||
        start.clientX >= bounds.left ||
        start.clientY < bounds.top ||
        start.clientY >= bounds.bottom
      )
        return;
      gesture = { start, line, startedAt: performance.now(), horizontal: false };
    },
    { passive: true, signal: listeners.signal },
  );
  // ProseMirror's own touchmove listener is passive. Cancel only a horizontal pan.
  surface.addEventListener(
    "touchmove",
    (event) => {
      if (!gesture) return;
      const { start } = gesture;
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        touch.identifier !== start.identifier ||
        !event.cancelable ||
        hasSelection()
      )
        return cancel();
      const dx = Math.abs(touch.clientX - start.clientX);
      const dy = Math.abs(touch.clientY - start.clientY);
      if (!gesture.horizontal) {
        if (performance.now() - gesture.startedAt > 250) return cancel();
        if (Math.max(dx, dy) < 10) return;
        if (dx <= dy * 1.4) return cancel();
        gesture.horizontal = true;
      }
      event.preventDefault();
    },
    { passive: false, signal: listeners.signal },
  );
  surface.addEventListener(
    "touchend",
    (event) => {
      const swipe = gesture;
      cancel();
      if (
        !swipe?.horizontal ||
        !view.editable ||
        view.composing ||
        hasSelection() ||
        !dom.contains(swipe.line)
      )
        return;
      const touch = Array.from(event.changedTouches).find(
        ({ identifier }) => identifier === swipe.start.identifier,
      );
      if (!touch || event.touches.length) return;
      const dx = touch.clientX - swipe.start.clientX;
      const dy = touch.clientY - swipe.start.clientY;
      if (Math.abs(dx) < 28 || Math.abs(dx) <= Math.abs(dy) * 1.4) return;
      event.preventDefault();
      indentText(editor, Math.sign(dx), view.posAtDOM(swipe.line, 0));
    },
    { signal: listeners.signal },
  );
  for (const type of ["touchcancel", "contextmenu", "compositionstart"])
    surface.addEventListener(type, cancel, { signal: listeners.signal });
  dom.ownerDocument.addEventListener("selectionchange", cancel, {
    signal: listeners.signal,
  });
  return {
    update: (_view: EditorView, previous: typeof view.state) => {
      if (
        view.state.doc !== previous.doc ||
        !view.state.selection.eq(previous.selection)
      )
        cancel();
    },
    destroy: () => listeners.abort(),
  };
}

export const Formatting = Extension.create({
  name: "editorFormatting",
  priority: 1200,
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => touchIndent(this.editor, view) })];
  },
  addGlobalAttributes: () => [
    {
      types: ["paragraph", "heading"],
      attributes: {
        textAlign: {
          default: null,
          parseHTML: (el) =>
            ["left", "center", "right", "justify"].includes(el.style.textAlign)
              ? el.style.textAlign
              : null,
          renderHTML: (attrs) =>
            attrs.textAlign ? { style: `text-align:${attrs.textAlign}` } : {},
        },
        indent: {
          default: 0,
          parseHTML: (el) => Number(el.dataset.indent) || 0,
          renderHTML: (attrs) =>
            attrs.indent
              ? {
                  "data-indent": attrs.indent,
                  style: `margin-inline-start:${Math.max(0, Math.min(6, attrs.indent)) * 24}px`,
                }
              : {},
        },
      },
    },
    {
      types: [
        "paragraph",
        "heading",
        "listItem",
        "taskItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "table",
      ],
      attributes: {
        blockId: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-block-id"),
          renderHTML: (attrs) =>
            attrs.blockId
              ? { "data-block-id": attrs.blockId, id: `block-${attrs.blockId}` }
              : {},
        },
      },
    },
  ],
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-t": () => {
        this.editor.chain().clearNodes().setHeading({ level: 1 }).run();
        return true;
      },
      "Mod-Shift-h": () => {
        this.editor.chain().clearNodes().setHeading({ level: 2 }).run();
        return true;
      },
      "Mod-Shift-j": () => {
        this.editor.chain().clearNodes().setHeading({ level: 3 }).run();
        return true;
      },
      "Mod-Shift-b": () => {
        this.editor.commands.clearNodes();
        this.editor.commands.setParagraph();
        return true;
      },
      "Mod-Shift-l": () => this.editor.commands.toggleTaskList(),
      Tab: () =>
        this.editor.isActive("table") || this.editor.isActive("codeBlock")
          ? false
          : indentText(this.editor, 1),
      "Shift-Tab": () =>
        this.editor.isActive("table") || this.editor.isActive("codeBlock")
          ? false
          : indentText(this.editor, -1),
    };
  },
});
