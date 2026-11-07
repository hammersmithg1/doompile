import { quoteContext } from "../../core/src/source-link";
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import {
  Plugin,
  NodeSelection,
  TextSelection,
  type EditorState,
} from "@tiptap/pm/state";

// Manually inserted cards also count as a note when there is no text yet.
export function documentSource(body: JSONContent):
  | {
      url: string;
      title?: string;
      quote?: string;
      timestampSeconds?: number;
      selector?: {
        type: string;
        exact: string;
        prefix: string;
        suffix: string;
      };
    }
  | undefined {
  if (
    body.type === "sourceSnippet" &&
    typeof body.attrs?.url === "string" &&
    /^https?:\/\//i.test(body.attrs.url)
  ) {
    const attrs = body.attrs;
    return {
      url: attrs.url,
      ...(typeof attrs.title === "string" ? { title: attrs.title } : {}),
      ...(typeof attrs.quote === "string" ? { quote: attrs.quote } : {}),
      ...(attrs.quotePrefix || attrs.quoteSuffix
        ? {
            selector: {
              type: "TextQuoteSelector",
              exact: String(attrs.quote || ""),
              prefix: String(attrs.quotePrefix || ""),
              suffix: String(attrs.quoteSuffix || ""),
            },
          }
        : {}),
      ...(Number.isFinite(attrs.timestampSeconds) && attrs.timestampSeconds >= 0
        ? { timestampSeconds: attrs.timestampSeconds }
        : {}),
    };
  }
  return body.content?.map(documentSource).find(Boolean);
}

// Keep the source metadata for capture provenance; the block owns its position.
export function prepareDocument(
  body: JSONContent,
  title = "",
  source?: Record<string, unknown>,
): JSONContent {
  const findSource = (node: JSONContent): JSONContent | undefined =>
    node.type === "sourceSnippet"
      ? node
      : node.content?.map(findSource).find(Boolean);
  if (source?.url && typeof source.url === "string") {
    const context = quoteContext(source);
    if (context.quotePrefix || context.quoteSuffix) {
      const content = body.content?.map((node) => {
        const attrs = node.attrs;
        if (
          node.type !== "sourceSnippet" ||
          !attrs ||
          attrs.url !== source.url ||
          (attrs.quote && attrs.quote !== source.quote)
        )
          return node;
        return {
          ...node,
          attrs: {
            ...attrs,
            ...(!attrs.quotePrefix && context.quotePrefix
              ? { quotePrefix: context.quotePrefix }
              : {}),
            ...(!attrs.quoteSuffix && context.quoteSuffix
              ? { quoteSuffix: context.quoteSuffix }
              : {}),
          },
        };
      });
      if (content) body = { ...body, content };
    }
  }
  if (body.attrs?.captureVersion === 2) return body;
  let content = [...(body.content || [{ type: "paragraph" }])];
  const provenance = source || findSource(body)?.attrs;
  const nodeText = (node: JSONContent): string =>
    node.text || node.content?.map(nodeText).join("") || "";
  // Older captures stored a blockquote plus source metadata. The first editor
  // migration then inserted another source card and its page title. Collapse
  // only that generated prefix; leave authored text and attachments intact.
  const versioned = body.attrs?.editorVersion === 1;
  if (
    provenance?.url &&
    (!versioned ||
      content.some(
        (node) =>
          node.type === "sourceSnippet" && node.attrs?.url === provenance.url,
      ))
  ) {
    let prefix = true,
      seenSource = false;
    content = content.filter((node) => {
      if (!prefix) return true;
      if (node.type === "sourceSnippet") {
        if (node.attrs?.url !== provenance.url) {
          prefix = false;
          return true;
        }
        if (seenSource) return false;
        seenSource = true;
        return true;
      }
      const text = nodeText(node).trim();
      if (
        (node.type === "heading" &&
          text === String(provenance.title || "").trim()) ||
        (node.type === "blockquote" &&
          text === String(provenance.quote || "").trim())
      )
        return false;
      prefix = false;
      return true;
    });
  }
  if (versioned)
    return provenance &&
      content.some(
        (node) =>
          node.type === "sourceSnippet" && node.attrs?.url === provenance.url,
      )
      ? { ...body, attrs: { ...body.attrs, captureVersion: 2 }, content }
      : body;
  const firstText = (node?: JSONContent): string =>
    node?.text || node?.content?.map(firstText).join("") || "";
  if (
    title.trim() &&
    (!provenance || title.trim() !== String(provenance.title || "").trim()) &&
    firstText(content[0]).trim() !== title.trim() &&
    !content.some(
      (n) => n.type === "heading" && firstText(n).trim() === title.trim(),
    )
  ) {
    content.unshift({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: title }],
    });
  }
  if (source && !findSource({ type: "doc", content }))
    content.unshift({
      type: "sourceSnippet",
      attrs: {
        ...Object.fromEntries(
          Object.entries(quoteContext(source)).filter(([, value]) => value),
        ),
        ...Object.fromEntries(
          ["url", "title", "quote", "timestampSeconds"]
            .filter((key) => source[key] !== undefined)
            .map((key) => [key, source[key]]),
        ),
      },
    });
  return {
    ...body,
    attrs: {
      ...body.attrs,
      editorVersion: 1,
      ...(provenance ? { captureVersion: 2 } : {}),
    },
    content,
  };
}

export function moveBlock(
  editor: Editor,
  from: number,
  target: number,
): boolean {
  const { doc, tr } = editor.state;
  if (
    from < 0 ||
    target < 0 ||
    from > doc.content.size ||
    target > doc.content.size
  )
    return false;
  const node = doc.nodeAt(from);
  if (!node || (target >= from && target <= from + node.nodeSize)) return false;
  const $from = doc.resolve(from),
    $target = doc.resolve(target);
  // Across compatible lists, move the item itself and remove an emptied list.
  if (!$from.sameParent($target)) {
    if (
      !$target.parent.canReplaceWith(
        $target.index(),
        $target.index(),
        node.type,
      )
    )
      return false;
    let removeFrom = from,
      removeTo = from + node.nodeSize;
    if (
      ["bulletList", "orderedList", "taskList"].includes(
        $from.parent.type.name,
      ) &&
      $from.parent.childCount === 1
    ) {
      removeFrom = $from.before($from.depth);
      removeTo = $from.after($from.depth);
    }
    tr.delete(removeFrom, removeTo);
    const destination = tr.mapping.map(target);
    tr.insert(destination, node);
    tr.setSelection(NodeSelection.create(tr.doc, destination));
    try {
      tr.doc.check();
    } catch {
      return false;
    }
    editor.view.dispatch(closeHistory(tr).scrollIntoView());
    editor.view.focus();
    return true;
  }
  // Reordering peers preserves their list nesting and attributes.
  if (
    !$from.sameParent($target) ||
    !$target.parent.canReplaceWith($target.index(), $target.index(), node.type)
  )
    return false;
  const children: import("@tiptap/pm/model").Node[] = [];
  $from.parent.forEach((child) => children.push(child));
  const index = $from.index(),
    targetIndex = $target.index() - (target > from ? 1 : 0);
  children.splice(index, 1);
  children.splice(targetIndex, 0, node);
  const reordered = Fragment.fromArray(children);
  if (!$from.parent.type.validContent(reordered)) return false;
  const destination =
    $from.start() +
    children
      .slice(0, targetIndex)
      .reduce((size, child) => size + child.nodeSize, 0);
  closeHistory(tr).replaceWith($from.start(), $from.end(), reordered);
  tr.setSelection(NodeSelection.create(tr.doc, destination)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

export function insertMedia(editor: Editor, node: JSONContent) {
  // An attachment belongs to the current list item. Leave a text cursor after it
  // so Enter can split the item and Shift+Enter can continue the same paragraph.
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContent(node)
    .run();
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export const ListUX = Extension.create({
  name: "listUX",
  priority: 1100,
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          editorVersion: { default: null, rendered: false },
          captureVersion: { default: null, rendered: false },
          attachmentRecoveryVersion: { default: null, rendered: false },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== " " || view.composing) return false;
            const $from = view.state.doc.resolve(from);
            if ($from.parent.type.spec.code) return false;
            const before = $from.parent.textBetween(
              0,
              $from.parentOffset,
              "",
              "\n",
            );
            const match = /\n([-+*]|\d+\.)$/.exec(before);
            if (!match) return false;
            const start = from - match[1].length - 1;
            const ordered = /^\d/.test(match[1]);
            return this.editor
              .chain()
              .deleteRange({ from: start, to })
              .splitBlock()
              .command(({ commands }) =>
                ordered
                  ? commands.toggleOrderedList()
                  : commands.toggleBulletList(),
              )
              .command(
                ({ commands }) =>
                  !ordered ||
                  commands.updateAttributes("orderedList", {
                    start: parseInt(match[1], 10),
                  }),
              )
              .run();
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Alt-Enter": () => {
        // A new paragraph inside a list item, including media and nested lists.
        if (
          !this.editor.isActive("listItem") &&
          !this.editor.isActive("taskItem")
        )
          return false;
        return this.editor.commands.splitBlock();
      },
      Enter: () => {
        const { selection } = this.editor.state;
        if (splitTailParagraph(this.editor)) return true;
        if (
          !(selection instanceof NodeSelection) ||
          !["attachment", "image", "sourceSnippet", "recording"].includes(
            selection.node.type.name,
          )
        )
          return false;
        const $from = selection.$from;
        if (selection.node.isInline) {
          this.editor.view.dispatch(
            this.editor.state.tr.setSelection(
              TextSelection.create(this.editor.state.doc, selection.to),
            ),
          );
          return (
            this.editor.commands.splitListItem(
              this.editor.isActive("taskItem") ? "taskItem" : "listItem",
            ) || this.editor.commands.splitBlock()
          );
        }
        const listDepth = Array.from({ length: $from.depth }, (_, i) => i + 1)
          .reverse()
          .find((d) =>
            ["listItem", "taskItem"].includes($from.node(d).type.name),
          );
        if (!listDepth) return false;
        const position = selection.to;
        const tr = this.editor.state.tr;
        if (tr.doc.nodeAt(position)?.type.name !== "paragraph")
          tr.insert(position, this.editor.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, position + 1));
        this.editor.view.dispatch(closeHistory(tr));
        return (
          splitTailParagraph(this.editor) ||
          this.editor.commands.splitListItem($from.node(listDepth).type.name)
        );
      },
      "Alt-Shift-ArrowUp": () => moveSelected(this.editor, -1),
      "Alt-Shift-ArrowDown": () => moveSelected(this.editor, 1),
    };
  },
});
function splitTailParagraph(editor: Editor): boolean {
  const { selection } = editor.state;
  const $cursor = selection.$from,
    itemDepth = $cursor.depth - 1;
  if (
    !selection.empty ||
    $cursor.parent.type.name !== "paragraph" ||
    $cursor.parent.content.size ||
    itemDepth <= 0 ||
    !["listItem", "taskItem"].includes($cursor.node(itemDepth).type.name) ||
    $cursor.index(itemDepth) === 0
  )
    return false;
  const item = $cursor.node(itemDepth),
    paragraphStart = $cursor.before(),
    nextItem = $cursor.after(itemDepth) - $cursor.parent.nodeSize;
  const replacement = item.type.create(
    {
      ...item.attrs,
      ...(item.type.name === "taskItem" ? { checked: false } : {}),
    },
    editor.schema.nodes.paragraph.create(),
  );
  const tr = editor.state.tr
    .delete(paragraphStart, paragraphStart + $cursor.parent.nodeSize)
    .insert(nextItem, replacement);
  tr.setSelection(TextSelection.create(tr.doc, nextItem + 2));
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  return true;
}

function moveSelected(editor: Editor, direction: number) {
  const { $from } = editor.state.selection;
  let depth = Math.max(1, $from.depth);
  if (!(editor.state.selection instanceof NodeSelection)) {
    for (let d = $from.depth; d > 0; d--)
      if (["listItem", "taskItem"].includes($from.node(d).type.name)) {
        depth = d;
        break;
      }
  }
  const from =
    editor.state.selection instanceof NodeSelection
      ? $from.pos
      : $from.depth
        ? $from.before(depth)
        : $from.pos;
  const $pos = editor.state.doc.resolve(from);
  const node = editor.state.doc.nodeAt(from);
  if (!node) return false;
  const index = $pos.index();
  if (direction < 0 && index > 0)
    return moveBlock(
      editor,
      from,
      from - $pos.parent.child(index - 1).nodeSize,
    );
  if (direction > 0 && index + 1 < $pos.parent.childCount)
    return moveBlock(
      editor,
      from,
      from + node.nodeSize + $pos.parent.child(index + 1).nodeSize,
    );
  return false;
}

export function queryAtSelection(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code)
    return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc");
  const match = /(?:^|\s)([/@])([^\s/@]*)$/.exec(before);
  if (!match || (match[1] === "/" && before.trimStart()[0] !== "/"))
    return null;
  return {
    kind: match[1],
    query: match[2].toLocaleLowerCase(),
    from: $from.pos - match[2].length - 1,
    to: $from.pos,
  };
}

/** Plain-text clipboard lists should not depend on a blank separator paragraph. */
export function parseListText(value: string): JSONContent[] | null {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const marker = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
  if (!lines.some((line) => marker.test(line))) return null;
  const blocks: JSONContent[] = [];
  const stack: { indent: number; node: JSONContent; item: JSONContent }[] = [];
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
  for (const line of lines) {
    const match = marker.exec(line);
    const indent = (match?.[1] || /^\s*/.exec(line)![0]).replace(
      /\t/g,
      "    ",
    ).length;
    if (!match) {
      if (stack.length && line.trim() && indent > stack.at(-1)!.indent)
        stack.at(-1)!.item.content!.push(paragraph(line.trimStart()));
      else {
        stack.length = 0;
        blocks.push(paragraph(line));
      }
      continue;
    }
    const type = /^\d/.test(match[2]) ? "orderedList" : "bulletList";
    while (
      stack.length &&
      (stack.at(-1)!.indent > indent ||
        (stack.at(-1)!.indent === indent && stack.at(-1)!.node.type !== type))
    )
      stack.pop();
    const item: JSONContent = {
      type: "listItem",
      content: [paragraph(match[3])],
    };
    if (!stack.length || stack.at(-1)!.indent < indent) {
      const node: JSONContent = {
        type,
        ...(type === "orderedList"
          ? { attrs: { start: parseInt(match[2], 10) } }
          : {}),
        content: [],
      };
      if (stack.length) stack.at(-1)!.item.content!.push(node);
      else blocks.push(node);
      stack.push({ indent, node, item });
    }
    stack.at(-1)!.node.content!.push(item);
    stack.at(-1)!.item = item;
  }
  return blocks;
}
