import {
  createBlockEditor,
  documentPlainText,
  prepareDocument,
  type Media,
  type NoteOption,
} from "./block-editor";
import type { JSONContent } from "@tiptap/core";
import { setBlockType } from "./formatting-ui";
import { indentText } from "./formatting";
import { clipboardFiles, clipboardImageSource, isDoompileClipboardHTML } from "./clipboard-files";
import { errorProperties } from "../../telemetry/core";
type ImagePasteHandler = {
  postMessage: (message: { name: string; mimeType: string; data: string }) => Promise<Media>;
};
declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        doompile: { postMessage: (message: unknown) => void };
        storePastedImage?: ImagePasteHandler;
      };
    };
    doompileEditor: typeof api;
  }
}
function post(message: unknown) {
  window.webkit?.messageHandlers.doompile.postMessage(message);
}
window.addEventListener("error", event => post({ type: "telemetry", name: "runtime.error", properties: errorProperties(event.error) }));
window.addEventListener("unhandledrejection", event => post({ type: "telemetry", name: "runtime.error", properties: errorProperties(event.reason) }));
function mediaURL(value: unknown): string {
  const url = String(value || "");
  const remote = url.match(/^\/api\/attachments\/([0-9a-f-]{36})$/i);
  if (remote) return `doompile-media://attachment/${remote[1]}`;
  const local = url.match(/^local:([0-9a-f-]{36})$/i);
  if (local) return `doompile-media://local/${local[1]}`;
  return /^https?:\/\//.test(url) ? url : "";
}
let frame = 0;
const pasteFeedback = document.getElementById("paste-feedback")!;
const editorElement = document.getElementById("editor")!;
function height() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const compact = document.documentElement.dataset.nativeCapture === "compact";
    const height = editorElement.getBoundingClientRect().height;
    post({
      type: "height",
      height: compact ? height : Math.max(280, height),
      compact,
    });
  });
}
const controller = createBlockEditor(editorElement, {
  onTelemetry: (name, properties) => post({ type: "telemetry", name, properties }),
  mediaURL,
  onChange: (body, plainText) => {
    post({ type: "change", body, plainText });
    height();
  },
  onReference: (id) => post({ type: "reference", id }),
  onAction: (action) => post({ type: "action", action }),
  onLink: (href) => post({ type: "requestLink", href }),
  onHeight: height,
  onOpenAttachment: (url) => post({ type: "openAttachment", url }),
  onMediaPaste: (attachments) => post({ type: "pastedMedia", attachments }),
  onPaste: (event) => {
    const store = window.webkit?.messageHandlers.storePastedImage;
    const clipboard = event.clipboardData;
    if (!store || !clipboard) return false;
    const html = clipboard.getData("text/html");
    if (isDoompileClipboardHTML(html)) return false;
    const images = clipboardFiles(clipboard).filter((file) => file.type.startsWith("image/"));
    const source = images.length ? "" : clipboardImageSource(html);
    if (!images.length && !/^(?:data:image\/|blob:|file:|webkit-fake-url:)/i.test(source)) return false;
    void pasteImages(store, images, source);
    return true;
  },
});
const { editor } = controller;
async function pasteImages(store: ImagePasteHandler, images: File[], source: string) {
  pasteFeedback.hidden = true;
  let bookmark = editor.state.selection.getBookmark();
  const mapBookmark = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
    bookmark = bookmark.map(transaction.mapping);
  };
  const unreadable = "Не удалось прочитать изображение из буфера.";
  editor.on("transaction", mapBookmark);
  try {
    if (!images.length) {
      if (!/^(?:data:image\/|blob:)/i.test(source)) throw new Error(unreadable);
      const response = await fetch(source).catch(() => null);
      const blob = response?.ok ? await response.blob() : null;
      if (!blob?.type.startsWith("image/")) throw new Error(unreadable);
      images = [new File([blob], `Изображение.${blob.type.split("/")[1]}`, { type: blob.type })];
    }
    for (const image of images) {
      if (!image.size) throw new Error(unreadable);
      if (image.size > 30 * 1024 * 1024) throw new Error("Максимальный размер вложения — 30 МБ.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error(unreadable));
        reader.readAsDataURL(image);
      });
      if (!editor.isEditable) return;
      const attachment = await store.postMessage({ name: image.name, mimeType: image.type, data });
      if (!editor.isEditable) return;
      editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
      controller.insertAttachment(attachment);
      bookmark = editor.state.selection.getBookmark();
    }
  } catch (error) {
    pasteFeedback.textContent = error instanceof Error ? error.message : unreadable;
    pasteFeedback.hidden = false;
  } finally {
    editor.off("transaction", mapBookmark);
  }
}
// The Mac capture panel keeps this editor alive when it changes size.
// Compact mode only changes presentation; it never serializes rich blocks to text.
editor.view.dom.addEventListener("keydown", (event) => {
  if (document.documentElement.dataset.nativeCapture !== "compact" || event.isComposing) return;
  if (event.key === "/" || event.key === "@") post({ type: "action", action: "expandCapture" });
  if (document.documentElement.dataset.nativeDesktop === "true" && event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !document.querySelector(".command-menu:not([hidden])")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ type: "action", action: "sendCapture" });
  }
}, true);
const api = {
  setCaptureMode(compact: boolean) {
    document.documentElement.dataset.nativeCapture = compact ? "compact" : "expanded";
    height();
  },
  setCaptureHeightLimit(height: number | null) {
    const style = document.documentElement.style;
    if (height === null) style.removeProperty("--capture-height-limit");
    else style.setProperty("--capture-height-limit", `${height}px`);
  },
  setNoteURL(value: string) {
    controller.setNoteURL(value);
  },
  openPreferences() {
    controller.openPreferences();
  },
  setTheme(theme: "light" | "dark") {
    document.documentElement.dataset.theme =
      theme === "light" ? "light" : "dark";
  },
  setEditable(editable: boolean) {
    editor.setEditable(editable === true);
    height();
  },
  setDocument(
    body: JSONContent,
    title?: string,
    source?: Record<string, unknown>,
  ) {
    pasteFeedback.hidden = true;
    controller.setDocument(
      title !== undefined || source !== undefined
        ? prepareDocument(body, title, source)
        : body,
      false,
    );
    height();
  },
  setAttachments(value: Media[]) {
    controller.setAttachments(value || []);
  },
  setNotes(value: NoteOption[]) {
    controller.setNotes(value || []);
  },
  reconcileAttachments(updates: { from: string; to: string }[]) {
    const replacements = new Map(updates.map(({ from, to }) => [from, to]));
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      const attribute =
        node.type.name === "image"
          ? "src"
          : node.type.name === "attachment"
            ? "url"
            : null;
      if (!attribute) return;
      const replacement = replacements.get(node.attrs[attribute]);
      if (replacement && replacement !== node.attrs[attribute])
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          [attribute]: replacement,
        });
    });
    if (transaction.docChanged)
      editor.view.dispatch(transaction.setMeta("addToHistory", false));
  },
  insertAttachment(attachment: Media) {
    controller.insertAttachment(attachment);
  },
  removeAttachment(url: string) {
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      if ((node.type.name === "image" && node.attrs.src === url) ||
          (node.type.name === "attachment" && node.attrs.url === url)) {
        transaction.delete(transaction.mapping.map(position), transaction.mapping.map(position + node.nodeSize));
      }
    });
    if (transaction.docChanged) editor.view.dispatch(transaction);
  },
  insertRecording(id: string) {
    controller.insertRecording(id);
  },
  setRecordingState(state: import("./media-preview").RecordingDisplay) {
    controller.setRecordingState(state);
  },
  completeRecording(id: string, attachment: Media) {
    controller.completeRecording(id, attachment);
    controller.reconcileMedia({
      type: "doc",
      content: [
        { type: "attachment", attrs: { ...attachment, recordingId: id } },
      ],
    });
  },
  setLink(url: string) {
    if (/^https?:\/\//.test(url))
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    else if (!url) editor.chain().focus().unsetLink().run();
  },
  toggleTaskList() {
    editor.chain().focus().toggleTaskList().run();
  },
  focus() {
    editor.commands.focus("end");
  },
  blur() {
    editor.commands.blur();
  },
  setTouchMode(enabled: boolean) {
    document.documentElement.dataset.nativeTouch = String(enabled);
    formats();
    height();
  },
  command(action: string) {
    const chain = editor.chain().focus();
    switch (action) {
      case "colors":
        controller.openFormatting("colors");
        return true;
      case "more":
        controller.openFormatting("more");
        return true;
      case "blockType":
        controller.openFormatting("type");
        return true;
      case "blockActions":
        controller.openBlockActions();
        return true;
      case "bold":
        return chain.toggleBold().run();
      case "italic":
        return chain.toggleItalic().run();
      case "underline":
        return chain.toggleUnderline().run();
      case "heading":
        return setBlockType(
          editor,
          editor.isActive("heading", { level: 2 }) ? "paragraph" : "h2",
        );
      case "checklist":
        return chain.toggleTaskList().run();
      case "bulletList":
        return chain.toggleBulletList().run();
      case "orderedList":
        return chain.toggleOrderedList().run();
      case "quote":
        return chain.toggleBlockquote().run();
      case "code":
        return chain.toggleCodeBlock().run();
      case "table":
        return chain
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      case "indent":
        if (editor.isActive("table")) return chain.goToNextCell().run();
        if (editor.isActive("codeBlock"))
          return chain.insertContent("\t").run();
        editor.view.focus();
        return indentText(editor, 1);
      case "outdent":
        if (editor.isActive("table")) return chain.goToPreviousCell().run();
        editor.view.focus();
        return indentText(editor, -1);
      case "tableRow":
        return chain.addRowAfter().run();
      case "tableColumn":
        return chain.addColumnAfter().run();
      case "deleteTable":
        return chain.deleteTable().run();
      case "mention":
        return chain.insertContent("@").run();
      case "undo":
        return chain.undo().run();
      case "redo":
        return chain.redo().run();
      default:
        return false;
    }
  },
  getDocument() {
    return editor.getJSON();
  },
  getState() {
    return { body: editor.getJSON(), plainText: documentPlainText(editor) };
  },
};
function formats() {
  if (document.documentElement.dataset.nativeTouch !== "true") return;
  const active = [
    ["bold", editor.isActive("bold")],
    ["italic", editor.isActive("italic")],
    ["underline", editor.isActive("underline")],
    ["heading", editor.isActive("heading")],
    ["checklist", editor.isActive("taskList")],
    ["bulletList", editor.isActive("bulletList")],
    ["orderedList", editor.isActive("orderedList")],
    ["quote", editor.isActive("blockquote")],
    ["code", editor.isActive("codeBlock")],
    ["table", editor.isActive("table")],
  ]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  post({ type: "formats", active });
}
editor.on("selectionUpdate", formats);
editor.on("transaction", formats);
// Padding and the bottom of a short native note are capture targets too.
// A click listener preserves selection, links, media controls and scroll gestures.
document.addEventListener("click", (event) => {
  const { nativeCapture, nativeDesktop, nativeTouch } = document.documentElement.dataset;
  if (nativeTouch !== "true" && !(nativeCapture === "compact" && nativeDesktop !== "true")) return;
  const target = event.target as HTMLElement;
  if (
    target === document.body ||
    target === document.documentElement ||
    target.id === "editor" ||
    target.classList.contains("block-editor")
  )
    api.focus();
});
window.doompileEditor = api;
new ResizeObserver(height).observe(editorElement);
window.addEventListener("load", height);
post({ type: "ready" });
height();
