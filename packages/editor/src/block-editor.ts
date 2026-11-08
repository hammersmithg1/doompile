import {
  UnsupportedBlock,
  UnsupportedInline,
  preserveAttributes,
  prepareForEditor,
  restoreDocument,
} from "./compatibility";
import type { EditorAction } from "../../core/src/contracts";
import { errorProperties, type EventName } from "../../telemetry/core";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import AttachmentPreview, {
  RecordingPreview,
  type RecordingDisplay,
} from "./media-preview";
import {
  Editor,
  Node,
  getSchema,
  mergeAttributes,
  type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { sourceLink } from "../../core/src/source-link";
import { createSourceDialog } from "./source-dialog";
import { normalizeMedia, pastedMedia } from "./inline-media";
import {
  Formatting,
  TextColor,
  Highlight,
  Subscript,
  Superscript,
} from "./formatting";
import { createFormattingUI } from "./formatting-ui";
import {
  commandAliases,
  commandDefinitions,
  createCommandPreferences,
} from "./command-preferences";
import { icon } from "./icons";
import { copySelection, pasteInternal } from "./clipboard";
import { createBlockControls } from "./block-controls";
import { Slice } from "@tiptap/pm/model";
import { inlineImageView } from "./inline-image-view";
import {
  ListUX,
  parseListText,
  insertMedia,
  moveBlock,
  queryAtSelection,
} from "./blocks";
export { prepareDocument } from "./blocks";
export function documentPlainText(editor: Editor) {
  const text = (node: import("@tiptap/pm/model").Node): string => {
    if (node.isText) return node.text || "";
    if (node.type.name === "hardBreak") return "\n";
    if (node.type.name === "noteReference")
      return node.attrs.title || "Заметка";
    const parts: string[] = [];
    node.forEach((child) => {
      const mediaOnly =
        child.isTextblock &&
        child.childCount > 0 &&
        Array.from({ length: child.childCount }, (_, i) =>
          child.child(i),
        ).every((item) =>
          ["sourceSnippet", "attachment", "image", "recording"].includes(
            item.type.name,
          ),
        );
      if (
        !mediaOnly &&
        !["sourceSnippet", "attachment", "image", "recording"].includes(
          child.type.name,
        )
      )
        parts.push(text(child));
    });
    return parts.join(
      node.isTextblock ? "" : node.type.name === "tableRow" ? "\t" : "\n",
    );
  };
  return text(editor.state.doc);
}
export type NoteOption = { id: string; title: string };
export type Media = {
  url: string;
  name: string;
  mimeType: string;
  size?: number;
  id?: string;
  recordingId?: string;
};
export type EditorOptions = {
  onTelemetry?: (name: EventName, properties?: Record<string, unknown>) => void;
  noteURL?: string;
  content?: JSONContent;
  mediaURL?: (value: unknown) => string;
  notes?: NoteOption[];
  onChange?: (body: JSONContent, text: string) => void;
  onReference?: (id: string) => void;
  onAction?: (action: EditorAction) => void;
  onLink?: (href: string) => void;
  onHeight?: () => void;
  onFiles?: (files: File[]) => void;
  onPaste?: (event: ClipboardEvent) => boolean;
  onOpenAttachment?: (url: string) => void;
  onMediaPaste?: (media: ReturnType<typeof pastedMedia>) => void;
};
export function safeMediaURL(value: unknown) {
  const url = String(value || "");
  return /^(https?:\/\/|\/api\/attachments\/)/i.test(url) ? url : "";
}
export function createBlockEditor(
  root: HTMLElement,
  options: EditorOptions = {},
) {
  const started = performance.now();
  const report = (name: EventName, properties: Record<string, unknown> = {}) => { try { options.onTelemetry?.(name, properties); } catch { /* Observability cannot interrupt editing. */ } };
  root.classList.add("block-editor");
  const content = document.createElement("div");
  const menu = document.createElement("div");
  menu.className = "command-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Команды и заметки");
  menu.id = `commands-${Math.random().toString(36).slice(2)}`;
  const bubble = document.createElement("div");
  bubble.className = "selection-toolbar";
  bubble.setAttribute("role", "toolbar");
  bubble.setAttribute("aria-label", "Форматирование выделения");
  const outline = document.createElement("nav");
  outline.className = "editor-outline";
  outline.setAttribute("aria-label", "Главы заметки");
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "block-handle";
  handle.textContent = "⠿";
  handle.title = "Перетащить блок · ⌥⇧↑ / ⌥⇧↓";
  handle.setAttribute("aria-label", "Перетащить блок");
  handle.draggable = true;
  menu.hidden = bubble.hidden = handle.hidden = true;
  root.append(content, menu, bubble, outline, handle);
  const url = options.mediaURL || safeMediaURL;
  const recordingStates = new Map<string, RecordingDisplay>();
  const recordingViews = new Set<() => void>();
  const NativeImage = Image.extend({
    draggable: true,
    parseHTML() {
      return [{
        tag: "img[src], img[data-original-src]",
        getAttrs: (element) => {
          const src = element.getAttribute("data-original-src") || element.getAttribute("src");
          return url(src) ? null : false;
        },
      }];
    },
    addNodeView() {
      return (props) => inlineImageView(props, url);
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        id: { default: null },
        name: { default: null },
        mimeType: { default: "image/png" },
        size: { default: 0 },
        src: {
          default: null,
          renderHTML: (attrs) => ({
            src: url(attrs.src),
            "data-original-src": attrs.src,
          }),
          parseHTML: (element) =>
            element.getAttribute("data-original-src") ||
            element.getAttribute("src"),
        },
      };
    },
    renderHTML({ HTMLAttributes }) {
      return [
        "img",
        mergeAttributes(HTMLAttributes, {
          src: HTMLAttributes.src,
        }),
      ];
    },
  }).configure({
    inline: true,
    resize: {
      enabled: true,
      directions: ["bottom-left", "bottom-right"],
      minWidth: 80,
      minHeight: 40,
      alwaysPreserveAspectRatio: true,
    },
  });
  const Attachment = Node.create({
    name: "attachment",
    group: "inline",
    inline: true,
    atom: true,
    draggable: true,
    addAttributes: () => ({
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-attachment-id"),
      },
      size: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute("data-size")) || 0,
      },
      recordingId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-recording-id") || "",
      },
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url"),
      },
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-name"),
      },
      mimeType: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-mime-type"),
      },
    }),
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.dataset.attachment = "";
        dom.className = "attachment";
        dom.contentEditable = "false";
        const root = createRoot(dom);
        let current = node;
        const render = () => {
          const attrs = current.attrs;
          root.render(
            createElement(AttachmentPreview, {
              attachment: {
                url: url(attrs.url),
                name: attrs.name || "Файл",
                mimeType: attrs.mimeType || "application/octet-stream",
                size: attrs.size || 0,
              },
              onOpen: options.onOpenAttachment
                ? () => options.onOpenAttachment!(attrs.url)
                : undefined,
            }),
          );
        };
        render();
        return {
          dom,
          update(next) {
            if (next.type.name !== "attachment") return false;
            if (JSON.stringify(next.attrs) !== JSON.stringify(current.attrs)) {
              current = next;
              render();
            }
            return true;
          },
          stopEvent: (event) =>
            !!(event.target as HTMLElement).closest(
              "button,a,input,audio,video",
            ),
          ignoreMutation: () => true,
          destroy: () => {
            queueMicrotask(() => root.unmount());
          },
        };
      };
    },
    parseHTML: () => [{ tag: "[data-attachment]" }],
    renderHTML({ HTMLAttributes: a }) {
      const src = url(a.url);
      return [
        "span",
        {
          "data-attachment": "",
          "data-attachment-id": a.id,
          "data-size": a.size,
          "data-recording-id": a.recordingId,
          "data-url": a.url,
          "data-name": a.name,
          "data-mime-type": a.mimeType,
          class: "attachment",
        },
        String(a.mimeType).startsWith("audio/")
          ? ["audio", { src, controls: "", preload: "metadata" }]
          : String(a.mimeType).startsWith("video/")
            ? [
                "video",
                { src, controls: "", playsinline: "", preload: "metadata" },
              ]
            : [
                "a",
                {
                  href: src,
                  "data-open-attachment": a.url,
                  target: "_blank",
                  rel: "noreferrer",
                },
                `↗ ${a.name || "Вложение"}`,
              ],
      ];
    },
  });
  const Recording = Node.create({
    name: "recording",
    group: "inline",
    inline: true,
    atom: true,
    draggable: true,
    addAttributes: () => ({ id: { default: "" } }),
    parseHTML: () => [{ tag: "[data-recording]" }],
    renderHTML: ({ node }) => [
      "span",
      { "data-recording": node.attrs.id },
      "Голосовая запись",
    ],
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.className = "attachment recording-block";
        dom.contentEditable = "false";
        dom.dataset.recording = node.attrs.id;
        const root = createRoot(dom);
        const render = () =>
          root.render(
            createElement(RecordingPreview, {
              state: recordingStates.get(node.attrs.id) || {
                id: node.attrs.id,
                status: "ready",
                seconds: 0,
                recovered: true,
                error: "Запись хранится на устройстве, где она была начата.",
              },
              onStop: () => options.onAction?.("stopVoice"),
              onRetry: () => options.onAction?.("retryVoice"),
            }),
          );
        recordingViews.add(render);
        render();
        return {
          dom,
          ignoreMutation: () => true,
          stopEvent: (event) =>
            !!(event.target as HTMLElement).closest("button,a,input,audio"),
          destroy() {
            recordingViews.delete(render);
            queueMicrotask(() => root.unmount());
          },
        };
      };
    },
  });
  const Reference = Node.create({
    name: "noteReference",
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => ({
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-note-reference"),
      },
      title: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-title") ||
          element.textContent?.replace(/^↗ /, ""),
      },
    }),
    parseHTML: () => [{ tag: "span[data-note-reference]" }],
    renderHTML: ({ HTMLAttributes: a }) => [
      "span",
      {
        "data-note-reference": a.id,
        "data-title": a.title,
        class: "note-reference",
        role: "link",
        tabindex: "0",
      },
      `↗ ${a.title || "Заметка"}`,
    ],
    renderText: ({ node }) => node.attrs.title || "Заметка",
  });
  const Snippet = Node.create({
    name: "sourceSnippet",
    group: "inline",
    inline: true,
    atom: true,
    draggable: true,
    addAttributes: () => ({
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url"),
      },
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-title"),
      },
      quote: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-quote"),
      },
      quotePrefix: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-quote-prefix"),
      },
      quoteSuffix: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-quote-suffix"),
      },
      timestampSeconds: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-seconds");
          return value !== null && Number.isFinite(Number(value))
            ? Number(value)
            : null;
        },
      },
    }),
    parseHTML: () => [{ tag: "[data-source-snippet]" }],
    renderHTML({ HTMLAttributes: a }) {
      const href = sourceLink({
        url: a.url,
        quote: a.quote,
        quotePrefix: a.quotePrefix,
        quoteSuffix: a.quoteSuffix,
        timestampSeconds: a.timestampSeconds,
      });
      let host = a.title || "Источник";
      try {
        host = new URL(href).hostname.replace(/^www\./, "");
      } catch {}
      return [
        "span",
        {
          "data-source-snippet": "",
          "data-url": a.url,
          "data-title": a.title,
          "data-quote": a.quote,
          "data-quote-prefix": a.quotePrefix,
          "data-quote-suffix": a.quoteSuffix,
          "data-seconds": a.timestampSeconds,
          class: "source-snippet",
        },
        ...(a.quote ? [["span", { class: "source-quote" }, a.quote]] : []),
        [
          "a",
          {
            href,
            target: "_blank",
            rel: "noopener noreferrer",
            contenteditable: "false",
            title: a.quote ? "Открыть источник у цитаты" : a.title || href,
          },
          `↗ ${host}`,
        ],
      ] as any;
    },
    renderText: ({ node }) =>
      node.attrs.quote || node.attrs.title || node.attrs.url,
  });
  let items: {
    label: string;
    hint?: string;
    icon?: string;
    run: () => void;
  }[] = [];
  let selected = 0;
  let activeQuery = "";
  let dismissed = "";
  let destroyed = false;
  let selectingWithPointer = false;
  let renderedItems = "";
  const extensions = [
    StarterKit.configure({
      link: { openOnClick: false },
      trailingNode: {
        notAfter: [
          "bulletList",
          "orderedList",
          "taskList",
          "heading",
          "blockquote",
          "codeBlock",
          "table",
        ],
      },
      heading: { levels: [1, 2, 3] },
    }),
    NativeImage,
    Formatting,
    TextColor,
    Highlight,
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "Пиши…  / команды · @ заметка" }),
    TableKit,
    Attachment,
    Recording,
    Reference,
    Snippet,
    ListUX,
    UnsupportedBlock,
    UnsupportedInline,
  ];
  extensions.push(preserveAttributes(getSchema(extensions)));
  const schema = getSchema(extensions);
  let editor: Editor;
  try { editor = new Editor({
    element: content,
    extensions,
    content: prepareForEditor(
      options.content || { type: "doc", content: [{ type: "paragraph" }] },
      schema,
    ),
    editorProps: {
      transformPasted: (slice) => {
        const json = slice.toJSON();
        if (!json) return slice;
        const clearIDs = (node: JSONContent) => {
          if (node.attrs) delete node.attrs.blockId;
          node.content?.forEach(clearIDs);
        };
        json.content?.forEach(clearIDs);
        options.onMediaPaste?.(
          pastedMedia({ type: "doc", content: json.content }),
        );
        return Slice.fromJSON(editor.schema, json);
      },
      attributes: {
        role: "textbox",
        "aria-label": "Текст заметки",
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        if (!menu.hidden) {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            selected =
              (selected + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
              Math.max(items.length, 1);
            updateSelectedItem(true);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            if (items[selected]) items[selected].run();
            return true;
          }
          if (event.key === "Escape") {
            dismissed = activeQuery;
            menu.hidden = true;
            editor.view.dom.setAttribute("aria-expanded", "false");
            return true;
          }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        if (pasteInternal(editor, event, options.onMediaPaste)) return true;
        if (options.onPaste?.(event)) return true;
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length && options.onFiles) {
          options.onFiles(files);
          return true;
        }
        const data = event.clipboardData;
        if (
          data &&
          !data.getData("text/html") &&
          !editor.state.selection.$from.parent.type.spec.code
        ) {
          const blocks = parseListText(data.getData("text/plain"));
          if (blocks) {
            editor.commands.insertContent(blocks);
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length && options.onFiles) {
          const position = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (position) editor.commands.setTextSelection(position.pos);
          options.onFiles(files);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        copy: (_view, event) => copySelection(editor, false, event),
        cut: (_view, event) => copySelection(editor, true, event),
        keydown: (_view, event) => {
          const target = event.target as HTMLElement;
          if (
            (event as KeyboardEvent).key === "Enter" &&
            target.matches("[data-note-reference]")
          ) {
            event.preventDefault();
            options.onReference?.(target.dataset.noteReference!);
            return true;
          }
          return false;
        },
        click: (_view, event) => {
          const file = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-open-attachment]",
          );
          if (file && options.onOpenAttachment) {
            event.preventDefault();
            options.onOpenAttachment(file.dataset.openAttachment!);
            return true;
          }
          const ref = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-note-reference]",
          );
          if (ref) {
            options.onReference?.(ref.dataset.noteReference!);
            return true;
          }
          return false;
        },
      },
    },
    onUpdate: () => {
      options.onChange?.(editor.getJSON(), documentPlainText(editor));
      renderOutline();
      options.onHeight?.();
    },
    onSelectionUpdate: () => updateUI(),
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged || transaction.selectionSet) dismissed = "";
      if (!destroyed)
        queueMicrotask(() => {
          if (!destroyed) updateUI();
        });
    },
    onBlur: () => {
      setTimeout(() => {
        if (
          !destroyed &&
          !root.contains(
            (root.getRootNode() as Document | ShadowRoot).activeElement,
          )
        ) {
          menu.hidden = bubble.hidden = true;
        }
      }, 0);
    },
  });
  } catch (error) { report("editor.failed", errorProperties(error)); throw error; }
  const rawJSON = editor.getJSON.bind(editor);
  editor.getJSON = () =>
    restoreDocument(rawJSON()) as ReturnType<Editor["getJSON"]>;
  const sourceDialog = createSourceDialog(root, editor);
  const beginSelection = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(
        "button,a,input,textarea,video,audio",
      )
    )
      return;
    selectingWithPointer = true;
    bubble.hidden = true;
  };
  const endSelection = () => {
    if (!selectingWithPointer) return;
    selectingWithPointer = false;
    updateUI();
  };
  content.addEventListener("pointerdown", beginSelection);
  document.addEventListener("pointerup", endSelection);
  document.addEventListener("pointercancel", endSelection);
  const formatting = createFormattingUI(root, editor, bubble, () =>
    options.onLink?.(editor.getAttributes("link").href || ""),
  );
  const preferences = createCommandPreferences(root, () => {
    activeQuery = "";
    editor.view.focus();
    options.onAction?.("preferencesClosed");
  });
  function positionPopup(
    element: HTMLElement,
    position: number,
    above = false,
    endPosition = position,
  ) {
    const rect = root.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(position);
    const end = editor.view.coordsAtPos(endPosition);
    // Keep popups below the tags and inside every clipping scroll container.
    // Clamping an already computed top to the editor's top covers its first line.
    const bounds = {
      top: Math.max(8, rect.top),
      bottom: window.innerHeight - 8,
      left: Math.max(8, rect.left),
      right: Math.min(window.innerWidth - 8, rect.right),
    };
    for (
      let parent = root.parentElement;
      parent && parent !== document.body && parent !== document.documentElement;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, box.top + parent.clientTop);
        bounds.bottom = Math.min(
          bounds.bottom,
          box.top + parent.clientTop + parent.clientHeight,
        );
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left + parent.clientLeft);
        bounds.right = Math.min(
          bounds.right,
          box.left + parent.clientLeft + parent.clientWidth,
        );
      }
    }
    const gap = 8;
    element.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
    if (element === menu) {
      const room = Math.max(
        coords.top - bounds.top - gap,
        bounds.bottom - end.bottom - gap,
      );
      element.style.maxHeight = `${Math.max(0, Math.min(280, Math.floor(room)))}px`;
    }
    element.style.left = `${Math.max(bounds.left, Math.min(coords.left, bounds.right - element.offsetWidth)) - rect.left}px`;
    const height = element.offsetHeight;
    const aboveTop = coords.top - height - gap;
    const belowTop = end.bottom + gap;
    const fitsAbove =
      aboveTop >= bounds.top && aboveTop + height <= bounds.bottom;
    const fitsBelow =
      belowTop >= bounds.top && belowTop + height <= bounds.bottom;
    const top = above
      ? fitsAbove
        ? aboveTop
        : fitsBelow
          ? belowTop
          : null
      : fitsBelow
        ? belowTop
        : fitsAbove
          ? aboveTop
          : null;
    if (top === null || bounds.right <= bounds.left) {
      element.hidden = true;
      return;
    }
    element.style.top = `${top - rect.top}px`;
  }
  function runCommand(run: () => void) {
    report("editor.action", { action: "format" });
    const query = queryAtSelection(editor.state);
    if (query)
      editor
        .chain()
        .focus()
        .deleteRange({ from: query.from, to: query.to })
        .run();
    menu.hidden = true;
    dismissed = "";
    run();
  }
  function commandItems(query: string) {
    const commands: [string, string, () => void][] = [
      [
        "Текст",
        "text paragraph текст",
        () => {
          editor.chain().focus().setParagraph().run();
        },
      ],
      ...([1, 2, 3] as const).map(
        (level) =>
          [
            `Заголовок ${level}`,
            `h${level} heading заголовок`,
            () => {
              editor.chain().focus().setHeading({ level }).run();
            },
          ] as [string, string, () => void],
      ),
      [
        "Маркированный список",
        "bullet list список",
        () => {
          editor.chain().focus().toggleBulletList().run();
        },
      ],
      [
        "Нумерованный список",
        "number ordered list список",
        () => {
          editor.chain().focus().toggleOrderedList().run();
        },
      ],
      [
        "Чеклист",
        "todo task чеклист задачи",
        () => {
          editor.chain().focus().toggleTaskList().run();
        },
      ],
      [
        "Вложенный маркированный список",
        "nested bullet вложенный список",
        () => {
          // Sink the current item before changing only its nested list type.
          if (editor.isActive("listItem"))
            editor
              .chain()
              .focus()
              .sinkListItem("listItem")
              .toggleBulletList()
              .run();
          else editor.chain().focus().toggleBulletList().run();
        },
      ],
      [
        "Цитата",
        "quote цитата",
        () => {
          editor.chain().focus().toggleBlockquote().run();
        },
      ],
      [
        "Источник с цитатой",
        "source snippet link источник ссылка цитата сниппет",
        () => sourceDialog.open(),
      ],
      [
        "Блок кода",
        "code код",
        () => {
          editor.chain().focus().toggleCodeBlock().run();
        },
      ],
      [
        "Разделитель",
        "divider разделитель",
        () => {
          editor.chain().focus().setHorizontalRule().run();
        },
      ],
      [
        "Таблица",
        "table таблица",
        () => {
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        },
      ],
      ...(editor.isActive("table")
        ? ([
            [
              "Добавить строку",
              "row строка",
              () => {
                editor.chain().focus().addRowAfter().run();
              },
            ],
            [
              "Добавить столбец",
              "column столбец",
              () => {
                editor.chain().focus().addColumnAfter().run();
              },
            ],
            [
              "Удалить таблицу",
              "delete table удалить таблицу",
              () => {
                editor.chain().focus().deleteTable().run();
              },
            ],
          ] as [string, string, () => void][])
        : []),
      [
        "Фото",
        "image photo фото изображение",
        () => options.onAction?.("image"),
      ],
      [
        "Файл",
        "file attachment файл вложение",
        () => options.onAction?.("file"),
      ],
      [
        "Голосовая заметка",
        "audio voice голос запись",
        () => options.onAction?.("voice"),
      ],
      ["Рисунок", "drawing рисунок", () => options.onAction?.("drawing")],
      [
        "Настройки команд",
        "settings настройки aliases алиасы",
        () => preferences.open(),
      ],
    ];
    const aliases = commandAliases();
    return commands
      .map(([label, keywords, run]) => {
        const definition = commandDefinitions.find(
          (entry) => entry.title === label,
        );
        return {
          label,
          hint: definition?.shortcut,
          icon: definition?.icon || "table",
          keywords: `${keywords} ${(definition?.aliases || []).join(" ")} ${(aliases[definition?.id || ""] || []).join(" ")}`,
          run: () => runCommand(run),
        };
      })
      .filter((item) =>
        `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(query),
      );
  }
  function renderItems() {
    menu.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "Ничего не найдено";
      menu.append(empty);
    }
    items.forEach((item, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = `${menu.id}-${i}`;
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(i === selected));
      b.setAttribute("aria-label", item.label);
      b.append(icon(item.icon || "text"));
      const label = document.createElement("span");
      label.textContent = item.label;
      b.append(label);
      if (item.hint) {
        const hint = document.createElement("kbd");
        hint.dataset.shortcut = item.hint;
        hint.setAttribute("aria-hidden", "true");
        b.append(hint);
      }
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => items[i]?.run();
      menu.append(b);
    });
    menu.scrollTop = 0;
    updateSelectedItem(false);
  }
  function updateSelectedItem(scroll: boolean) {
    Array.from(menu.children).forEach((child, i) =>
      child.setAttribute("aria-selected", String(i === selected)),
    );
    const option = items.length
      ? (menu.children[selected] as HTMLElement)
      : null;
    if (!option) {
      editor.view.dom.removeAttribute("aria-activedescendant");
      return;
    }
    editor.view.dom.setAttribute("aria-activedescendant", option.id);
    if (scroll) {
      // Scroll only the listbox, never the note or its surrounding page.
      const top = option.offsetTop,
        bottom = top + option.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (bottom > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = bottom - menu.clientHeight;
    }
  }
  function updateUI() {
    if (destroyed) return;
    blockControls.update();
    const query = queryAtSelection(editor.state);
    const key = query ? `${query.from}:${query.kind}:${query.query}` : "";
    if (!key) dismissed = "";
    if (editor.isEditable && editor.isFocused && query && dismissed !== key) {
      const queryChanged = key !== activeQuery;
      if (queryChanged) selected = 0;
      activeQuery = key;
      items =
        query.kind === "/"
          ? commandItems(query.query)
          : (options.notes || [])
              .filter((n) => n.title.toLocaleLowerCase().includes(query.query))
              .slice(0, 50)
              .map((note) => ({
                label: note.title || "Без названия",
                run: () =>
                  runCommand(() => {
                    editor
                      .chain()
                      .focus()
                      .insertContent([
                        { type: "noteReference", attrs: note },
                        { type: "text", text: " " },
                      ])
                      .run();
                  }),
              }));
      menu.hidden = false;
      const signature = JSON.stringify(items.map((item) => item.label));
      if (queryChanged || signature !== renderedItems) {
        selected = Math.min(selected, Math.max(0, items.length - 1));
        renderedItems = signature;
        renderItems();
      }
      positionPopup(menu, query.from);
    } else menu.hidden = true;
    editor.view.dom.setAttribute("aria-expanded", String(!menu.hidden));
    editor.view.dom.setAttribute("aria-controls", menu.id);
    const { from, to, empty } = editor.state.selection;
    bubble.hidden =
      !editor.isEditable ||
      !editor.isFocused ||
      selectingWithPointer ||
      empty ||
      !editor.state.doc.textBetween(from, to).trim() ||
      !menu.hidden;
    if (bubble.hidden && !formatting.nativeOpen) formatting.close();
    if (!bubble.hidden) {
      formatting.update();
      positionPopup(bubble, from, true, to);
    }
  }
  function renderOutline() {
    const headings: { position: number; text: string; level: number }[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "heading")
        headings.push({
          position,
          text: node.textContent || "Заголовок",
          level: node.attrs.level,
        });
    });
    outline.replaceChildren();
    outline.hidden = headings.length === 0;
    headings.forEach(({ position, text, level }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = text;
      b.setAttribute("aria-label", text);
      b.dataset.level = String(level);
      const bar = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = text;
      b.append(bar, label);
      b.onmousedown = (event) => event.preventDefault();
      b.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        editor.commands.setTextSelection(position + 1);
        editor.view.focus();
        (editor.view.nodeDOM(position) as HTMLElement)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        updateOutlineActive();
      };
      outline.append(b);
    });
  }
  const blockControls = createBlockControls(
    root,
    editor,
    handle,
    () => options.noteURL,
    () => formatting.openNative("colors"),
  );
  const reposition = (event?: Event) => {
    if (event?.target instanceof Element && menu.contains(event.target)) return;
    updateUI();
    formatting.reposition();
    updateOutlineActive();
  };
  function updateOutlineActive() {
    let active = 0,
      i = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "heading") return;
      const element = editor.view.nodeDOM(pos) as HTMLElement;
      if (element?.getBoundingClientRect().top < 120) active = i;
      i++;
    });
    Array.from(outline.children).forEach((b, index) =>
      b.setAttribute("aria-current", String(index === active)),
    );
  }
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  const resizeObserver = new ResizeObserver(() => reposition());
  resizeObserver.observe(root);
  function revealAnchor() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!/^block-[\w-]+$/.test(id)) return;
    const element = root.querySelector<HTMLElement>(`[id="${id}"]`);
    if (!element) return;
    const pos = editor.view.posAtDOM(element, 0);
    editor.commands.setTextSelection(pos);
    editor.view.focus();
    element.scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", revealAnchor);
  requestAnimationFrame(() => {
    if (!destroyed) revealAnchor();
  });
  renderOutline();
  report("editor.ready", { duration_ms: performance.now() - started });
  return {
    editor,
    setDocument(body: JSONContent, emitUpdate = true) {
      // Loading a note establishes the baseline; the first Undo must only undo
      // typing, never the loaded document (including a restored capture draft).
      editor
        .chain()
        .setMeta("addToHistory", false)
        .setContent(prepareForEditor(body, editor.schema), { emitUpdate })
        .run();
      requestAnimationFrame(() => {
        if (!destroyed) revealAnchor();
      });
    },
    setNoteURL(value: string) {
      options.noteURL = value;
    },
    openPreferences() {
      preferences.open();
    },
    openFormatting(kind: "colors" | "more" | "type") {
      blockControls.close();
      formatting.openNative(kind);
    },
    openBlockActions() {
      formatting.close();
      blockControls.openAtSelection();
    },
    insertAttachment(media: Media) {
      insertMedia(
        editor,
        media.mimeType.startsWith("image/")
          ? {
              type: "image",
              attrs: { ...media, src: media.url, alt: media.name },
            }
          : { type: "attachment", attrs: media },
      );
    },
    reconcileMedia(body: JSONContent) {
      const known = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (node.type.name === "attachment") known.add(node.attrs.url);
        if (node.type.name === "image") known.add(node.attrs.src);
      });
      const pending: JSONContent[] = [];
      const visit = (node: JSONContent) => {
        const src =
          node.type === "image"
            ? node.attrs?.src
            : node.type === "attachment"
              ? node.attrs?.url
              : null;
        if (src && !known.has(src)) {
          pending.push(node);
          known.add(src);
        }
        node.content?.forEach(visit);
      };
      visit(body);
      if (pending.length) {
        const tr = editor.state.tr;
        for (const node of pending)
          tr.insert(
            tr.doc.content.size,
            editor.schema.nodes.paragraph.create(
              null,
              editor.schema.nodeFromJSON(node),
            ),
          );
        editor.view.dispatch(tr.setMeta("addToHistory", false));
      }
    },
    insertRecording(id: string) {
      let found = false;
      editor.state.doc.descendants((node) => {
        if (
          (node.type.name === "recording" && node.attrs.id === id) ||
          (node.type.name === "attachment" && node.attrs.recordingId === id)
        )
          found = true;
      });
      if (!found) insertMedia(editor, { type: "recording", attrs: { id } });
    },
    setRecordingState(state: RecordingDisplay) {
      recordingStates.set(state.id, state);
      recordingViews.forEach((render) => render());
    },
    completeRecording(id: string, media: Media) {
      const tr = editor.state.tr;
      let found = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "recording" && node.attrs.id === id) {
          tr.replaceWith(
            pos,
            pos + node.nodeSize,
            editor.schema.nodes.attachment.create({
              ...media,
              recordingId: id,
            }),
          );
          found = true;
        }
      });
      if (found) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    dropFiles(files: File[]) {
      options.onFiles?.(files);
    },
    setAttachments(attachments: Media[]) {
      const metadata = new Map(attachments.map((file) => [file.url, file]));
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, position) => {
        const file =
          node.type.name === "attachment" || node.type.name === "image"
            ? metadata.get(node.attrs.url || node.attrs.src)
            : undefined;
        if (
          file &&
          (node.attrs.size !== (file.size || 0) || node.attrs.id !== file.id)
        )
          tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            id: file.id || null,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size || 0,
          });
      });
      if (tr.docChanged)
        editor.view.dispatch(
          tr.setMeta("addToHistory", false).setMeta("preventUpdate", true),
        );
    },
    setNotes(notes: NoteOption[]) {
      options.notes = notes;
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      resizeObserver.disconnect();
      window.removeEventListener("hashchange", revealAnchor);
      blockControls.destroy();
      content.removeEventListener("pointerdown", beginSelection);
      document.removeEventListener("pointerup", endSelection);
      document.removeEventListener("pointercancel", endSelection);
      sourceDialog.destroy();
      editor.destroy();
      formatting.destroy();
      preferences.destroy();
      root.replaceChildren();
    },
  };
}
