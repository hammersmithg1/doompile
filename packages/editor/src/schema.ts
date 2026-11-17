import { Node, getSchema, mergeAttributes, type Extensions, type NodeConfig } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { sourceLink } from "../../core/src/source-link";
import { UnsupportedBlock, UnsupportedInline, preserveAttributes } from "./compatibility";
import { Formatting, TextColor, Highlight, Subscript, Superscript } from "./formatting";
import { ListUX } from "./blocks";

export type EditorNodeViews = Partial<Record<"image" | "attachment" | "recording", NodeConfig["addNodeView"]>>;
export function safeMediaURL(value: unknown) {
  const url = String(value || "");
  return /^(https?:\/\/|\/api\/attachments\/)/i.test(url) ? url : "";
}
/** One schema for rendering, CRDT encoding and headless native/server edits. */
export function createEditorExtensions(
  url: (value: unknown) => string = safeMediaURL,
  nodeViews: EditorNodeViews = {},
  history = true,
): Extensions {
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
    addNodeView: nodeViews.image,
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
    addNodeView: nodeViews.attachment,
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
    addNodeView: nodeViews.recording,
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
  const extensions = [
    StarterKit.configure({
      undoRedo: history ? undefined : false,
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
  return extensions;
}
