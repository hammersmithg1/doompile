import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";

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

export function indentText(editor: Editor, direction: number) {
  if (editor.isActive("listItem") || editor.isActive("taskItem")) {
    const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
    return direction > 0
      ? editor.commands.sinkListItem(type)
      : editor.commands.liftListItem(type);
  }
  const { from, to } = editor.state.selection,
    tr = editor.state.tr;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (["paragraph", "heading"].includes(node.type.name))
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        indent: Math.max(0, Math.min(6, (node.attrs.indent || 0) + direction)),
      });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  return tr.docChanged;
}
export const Formatting = Extension.create({
  name: "editorFormatting",
  priority: 1200,
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
