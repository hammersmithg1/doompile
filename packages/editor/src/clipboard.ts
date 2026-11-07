import { prepareForEditor } from "./compatibility";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  DOMSerializer,
  Fragment,
  Slice,
  type Node as PMNode,
} from "@tiptap/pm/model";
import { pastedMedia } from "./inline-media";

export const clipboardMIME = "application/x-doompile-slice+json";
function plain(node: PMNode): string {
  if (node.isText) return node.text || "";
  if (node.type.name === "hardBreak") return "\n";
  if (node.type.name === "image") return node.attrs.alt || "Изображение";
  if (node.type.name === "attachment") return node.attrs.name || "Вложение";
  if (node.type.name === "sourceSnippet")
    return [node.attrs.quote, node.attrs.title, node.attrs.url]
      .filter(Boolean)
      .join("\n");
  if (node.type.name === "noteReference") return node.attrs.title || "Заметка";
  if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) {
    const lines: string[] = [];
    node.forEach((item, _offset, index) => {
      const marker =
        node.type.name === "orderedList"
          ? `${(Number(node.attrs.start) || 1) + index}.`
          : node.type.name === "taskList"
            ? item.attrs.checked
              ? "☑"
              : "☐"
            : "•";
      lines.push(`${marker} ${plain(item).replace(/\n/g, "\n  ")}`);
    });
    return lines.join("\n");
  }
  const parts: string[] = [];
  node.forEach((child) => parts.push(plain(child)));
  return parts.join(node.isTextblock ? "" : "\n");
}
export function fragmentText(fragment: Fragment) {
  const parts: string[] = [];
  fragment.forEach((node) => parts.push(plain(node)));
  return parts.join("\n");
}

export function clipboardPayload(editor: Editor) {
  const slice = editor.state.selection.content();
  const container = document.createElement("div");
  container.setAttribute("data-doompile-clipboard", "1");
  container.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content),
  );
  container
    .querySelectorAll("label, input[type=checkbox]")
    .forEach((element) => element.remove());
  container
    .querySelectorAll("p,h1,h2,h3,blockquote,pre,ul,ol")
    .forEach((element) => {
      (element as HTMLElement).style.marginBlock = "0";
    });
  return {
    [clipboardMIME]: JSON.stringify(slice.toJSON()),
    "text/html": container.outerHTML,
    "text/plain": fragmentText(slice.content),
  };
}
export function copySelection(
  editor: Editor,
  cut = false,
  event?: ClipboardEvent,
) {
  if (editor.state.selection.empty) return false;
  const payload = clipboardPayload(editor);
  if (event?.clipboardData) {
    for (const [type, value] of Object.entries(payload))
      event.clipboardData.setData(type, value);
    event.preventDefault();
    if (cut) editor.commands.deleteSelection();
  } else {
    // execCommand routes through the same copy/cut handler, including in WKWebView.
    editor.view.focus();
    if (!document.execCommand(cut ? "cut" : "copy")) return false;
  }
  return true;
}
export function pasteInternal(
  editor: Editor,
  event: ClipboardEvent,
  onMedia?: (media: ReturnType<typeof pastedMedia>) => void,
) {
  const value = event.clipboardData?.getData(clipboardMIME);
  if (!value || value.length > 4_000_000) return false;
  try {
    const parsed = JSON.parse(value);
    // A pasted block receives its own anchor; a link to the original stays stable.
    const clearIDs = (node: JSONContent) => {
      if (node.attrs) delete node.attrs.blockId;
      node.content?.forEach(clearIDs);
    };
    parsed.content?.forEach(clearIDs);
    parsed.content = prepareForEditor(
      { type: "doc", content: parsed.content || [] },
      editor.schema,
      true,
    ).content;
    const slice = Slice.fromJSON(editor.schema, parsed);
    slice.content.forEach((node) => node.check());
    onMedia?.(pastedMedia({ type: "doc", content: parsed.content }));
    editor.view.dispatch(
      editor.state.tr.replaceSelection(slice).scrollIntoView(),
    );
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}
