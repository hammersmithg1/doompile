"use client";
import { track } from "@/lib/client/telemetry";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { JSONContent } from "@tiptap/core";
import type { Note, Attachment } from "@doompile/core";
import { createBlockEditor } from "../../../packages/editor/src/block-editor";
import "../../../packages/editor/src/blocks.css";
import Drawing from "./drawing";
import { X } from "../../../packages/design/ui-icons";
import {
  clipboardFiles,
  clipboardImage,
  clipboardImageSource,
  isDoompileClipboardHTML,
  isLocalImagePath,
  readClipboardImage,
} from "@/lib/client/clipboard";

import { recordingSession } from "@/lib/client/recording";
import { useRecording } from "./use-recording";
export type RichEditorAPI = {
  touchCommand: (command: string) => void;
  dropFiles: (files: File[]) => void;
  insertAttachment: (attachment: Attachment) => void;
  completeRecording: (id: string, attachment: Attachment) => void;
};
export default function RichEditor(props: {
  value: unknown;
  noteId: string;
  recordingTarget: string;
  readOnly?: boolean;
  attachments: Attachment[];
  apiRef?: { current: RichEditorAPI | null };
  autoFocus?: boolean;
  onChange: (body: JSONContent, text: string) => void;
  notes: Note[];
  onAttachment: (file: File) => Promise<Attachment>;
  onBusy?: (busy: boolean) => void;
  onReference?: (id: string) => void;
  onMediaPaste?: (attachments: Attachment[]) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(false);
  const recording = useRecording();
  const current = useRef(props);
  current.current = props;
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createBlockEditor> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const pending = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const instance = createBlockEditor(host.current!, {
      onTelemetry: track,
      content: current.current.value as JSONContent,
      noteURL: new URL(`/notes/${current.current.noteId}`, location.href).href,
      notes: current.current.notes,
      onChange: (body, text) => {
        setError("");
        current.current.onChange(body, text);
      },
      onMediaPaste: (attachments) =>
        current.current.onMediaPaste?.(attachments),
      onReference: (id) => current.current.onReference?.(id),
      onFiles: (files) => {
        void uploadFiles(files);
      },
      onPaste: (event) => {
        const data = event.clipboardData;
        if (!data) return false;
        const html = data.getData("text/html");
        if (isDoompileClipboardHTML(html)) return false;
        const files = clipboardFiles(data);
        if (files.length) {
          void uploadFiles(files);
          return true;
        }
        const localPath = isLocalImagePath(data.getData("text/plain"));
        if (localPath || /^(?:file:|webkit-fake-url:|blob:|data:image\/)/i.test(clipboardImageSource(html))) {
          void (
            localPath ? readClipboardImage() : clipboardImage(data)
          )
            .then((file) => {
              if (file) void upload(file);
              else if (mounted.current)
                setError("Перетащи изображение или добавь его через /фото.");
            })
            .catch(() => {
              if (mounted.current)
                setError("Не удалось прочитать изображение из буфера.");
            });
          return true;
        }
        return false;
      },
      onAction: (action) => {
        switch (action) {
          case "drawing":
            setDraw(true);
            break;
          case "voice":
            void recordingSession.start(current.current.recordingTarget);
            break;
          case "stopVoice":
            recordingSession.stop();
            break;
          case "retryVoice":
            recordingSession.retry();
            break;
          case "file":
          case "image":
            fileInput.current!.accept = action === "image" ? "image/*" : "*/*";
            fileInput.current!.click();
            break;
          case "preferencesClosed":
          case "expandCapture":
          case "sendCapture":
            break;
          default: {
            const exhaustive: never = action;
            return exhaustive;
          }
        }
      },
      onLink: (href) => {
        const link = window.prompt("Адрес ссылки", href || "https://");
        if (link === "") instance.editor.chain().focus().unsetLink().run();
        else if (link && /^https?:\/\//i.test(link))
          instance.editor
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href: link })
            .run();
      },
    });
    controller.current = instance;
    if (current.current.apiRef)
      current.current.apiRef.current = {
        touchCommand: (command) => {
          if (["type", "colors", "more"].includes(command))
            instance.openFormatting(command as "type" | "colors" | "more");
          else if (command === "block") instance.openBlockActions();
          else if (command === "checklist")
            instance.editor.chain().focus().toggleTaskList().run();
          else if (command === "undo")
            instance.editor.chain().focus().undo().run();
          else if (command === "keyboard")
            (document.activeElement as HTMLElement)?.blur();
          else if (command === "focus") instance.editor.commands.focus("end");
          else if (command === "drawing") setDraw(true);
          else if (command === "voice") {
            if (recordingSession.getSnapshot().status === "recording")
              recordingSession.stop();
            else void recordingSession.start(current.current.recordingTarget);
          } else {
            fileInput.current!.accept = command === "image" ? "image/*" : "*/*";
            fileInput.current?.click();
          }
        },
        dropFiles: (files) => {
          void uploadFiles(files);
        },
        insertAttachment: (attachment) => instance.insertAttachment(attachment),
        completeRecording: (id, attachment) => {
          instance.completeRecording(id, attachment);
          instance.reconcileMedia({
            type: "doc",
            content: [
              { type: "attachment", attrs: { ...attachment, recordingId: id } },
            ],
          });
        },
      };
    if (
      current.current.autoFocus ||
      !window.matchMedia("(max-width: 760px)").matches
    )
      instance.editor.commands.focus("end");
    return () => {
      mounted.current = false;
      current.current.onBusy?.(false);
      if (current.current.apiRef) current.current.apiRef.current = null;
      instance.destroy();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.setNotes(props.notes);
  }, [props.notes]);
  useEffect(() => {
    controller.current?.editor.setEditable(!props.readOnly, false);
  }, [props.readOnly]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 8000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    controller.current?.setAttachments(props.attachments);
  }, [props.attachments]);
  async function uploadFiles(files: File[]) {
    for (const file of files) await upload(file);
  }
  async function upload(file: File) {
    const instance = controller.current;
    if (!instance) return;
    let bookmark = instance.editor.state.selection.getBookmark();
    const mapBookmark = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      bookmark = bookmark.map(transaction.mapping);
    };
    instance.editor.on("transaction", mapBookmark);
    pending.current++;
    setBusy(true);
    current.current.onBusy?.(true);
    setError("");
    try {
      const attachment = await current.current.onAttachment(file);
      if (!mounted.current || instance.editor.isDestroyed) return;
      instance.editor.view.dispatch(
        instance.editor.state.tr.setSelection(
          bookmark.resolve(instance.editor.state.doc),
        ),
      );
      instance.insertAttachment(attachment);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Не удалось загрузить файл");
    } finally {
      instance.editor.off("transaction", mapBookmark);
      pending.current--;
      if (mounted.current) {
        setBusy(pending.current > 0);
        current.current.onBusy?.(pending.current > 0);
      }
    }
  }
  useLayoutEffect(() => {
    const instance = controller.current;
    if (!instance) return;
    const visit = (node: JSONContent) => {
      if (node.type === "attachment" && node.attrs?.recordingId)
        instance.completeRecording(node.attrs.recordingId, node.attrs as any);
      node.content?.forEach(visit);
    };
    visit(props.value as JSONContent);
    instance.reconcileMedia(props.value as JSONContent);
  }, [props.value]);
  useEffect(() => {
    const draft = recording.draft,
      instance = controller.current;
    if (!draft || !instance) return;
    if (draft.target === props.recordingTarget && recording.status !== "starting")
      instance.insertRecording(draft.id);
    instance.setRecordingState({
      id: draft.id,
      status: recording.status,
      seconds: draft.seconds,
      size: draft.blob.size,
      url: recording.url,
      error: recording.error,
      recovered: recording.recovered,
      analyser: recording.analyser,
    });
  }, [recording, props.recordingTarget]);
  return (
    <div className="rich-editor">
      <div ref={host} />
      {busy && (
        <p className="muted" role="status">
          Загружаем…
        </p>
      )}
      <input
        hidden
        ref={fileInput}
        type="file"
        multiple
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      {error && (
        <div className="editor-feedback" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Скрыть сообщение редактора"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {draw && (
        <Drawing
          onClose={() => setDraw(false)}
          onSave={(blob) =>
            upload(new File([blob], "Рисунок.png", { type: "image/png" }))
          }
        />
      )}
    </div>
  );
}
