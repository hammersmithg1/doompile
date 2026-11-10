"use client";

import { brandCopy, uiCopy } from "../../../packages/design/copy";
import {
  useLayoutEffect,
  type Dispatch,
  type SetStateAction,
  type RefObject,
  type ClipboardEvent,
} from "react";
import { X, Paperclip, Maximize2 } from "../../../packages/design/ui-icons";
import type { Attachment } from "@doompile/core";
import { recordingSession, type RecordingState } from "@/lib/client/recording";
import { RecordingPreview } from "../../../packages/editor/src/media-preview";
import CaptureAttachment from "./capture-attachment";
import VoiceCapture from "./voice-capture";

function resizeComposerInput(input: HTMLTextAreaElement) {
  const scrollTop = input.scrollTop;
  input.style.overflowY = "hidden";
  input.style.height = "0px";
  input.style.height = `${input.scrollHeight}px`;
  input.style.overflowY = "";
  input.scrollTop = scrollTop;
}

export default function QuickComposer({
  recording,
  editorId,
  dropActive,
  attachments,
  pending,
  removeAttachment,
  retryAttachment,
  text,
  hasContent,
  setText,
  sending,
  input,
  fileInput,
  send,
  openEditor,
  pasteQuick,
  attachQuick,
  setSelected,
}: {
  recording: RecordingState;
  editorId?: string;
  dropActive: boolean;
  attachments: Attachment[];
  pending: string[];
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
  text: string;
  hasContent: boolean;
  setText: Dispatch<SetStateAction<string>>;
  sending: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  send: () => Promise<void>;
  openEditor: () => void;
  pasteQuick: (event: ClipboardEvent) => Promise<void>;
  attachQuick: (files: File[]) => void;
  setSelected: (id: string) => void;
}) {
  useLayoutEffect(() => {
    if (input.current) resizeComposerInput(input.current);
  }, [input, text]);
  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resizeComposerInput(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [input]);

  return (
    <>
      <form
        className={`quick-composer ${dropActive ? "file-drop-active" : ""}`}
        data-file-drop-zone="quick"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {dropActive && (
          <div className="quick-drop-label" role="status">
            Добавить в новое сообщение
          </div>
        )}
        {(attachments.length > 0 ||
          (recording.draft && recording.draft.target !== editorId)) && (
          <div className="quick-attachments">
            {attachments.map((attachment) => (
              <CaptureAttachment
                key={attachment.id}
                attachment={attachment}
                pending={pending.includes(attachment.id)}
                onRetry={() => retryAttachment(attachment.id)}
                onRemove={() => removeAttachment(attachment.id)}
                compact
              />
            ))}
            {recording.draft && recording.draft.target !== editorId && (
              <div className="quick-recording">
                <RecordingPreview
                  state={{
                    id: recording.draft.id,
                    status: recording.status,
                    seconds: recording.draft.seconds,
                    size: recording.draft.blob.size,
                    url: recording.url,
                    error: recording.error,
                    recovered: recording.recovered,
                    analyser: recording.analyser,
                  }}
                  onStop={recordingSession.stop}
                  onRetry={recordingSession.retry}
                />
                {recording.draft.target === "quick" &&
                  recording.status === "ready" && (
                    <button
                      type="button"
                      className="draft-remove"
                      aria-label="Убрать голосовую запись"
                      onClick={() => void recordingSession.discardQuick()}
                    >
                      <X size={14} />
                    </button>
                  )}
                {recording.draft.target !== "quick" && (
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setSelected(recording.draft!.target)}
                  >
                    Открыть заметку с записью
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="composer-input-row">
          <button
            type="button"
            className="icon-button attachment-trigger"
            aria-label="Прикрепить файл"
            disabled={sending}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={input}
            readOnly={sending}
            onPaste={pasteQuick}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={uiCopy.capturePlaceholder}
            aria-label="Быстрая заметка"
            rows={1}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                e.ctrlKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                const target = e.currentTarget;
                const start = target.selectionStart,
                  end = target.selectionEnd;
                setText(
                  target.value.slice(0, start) + "\n" + target.value.slice(end),
                );
                requestAnimationFrame(() =>
                  input.current?.setSelectionRange(start + 1, start + 1),
                );
                return;
              }
              if (
                e.key === "Enter" &&
                (!window.matchMedia("(max-width: 760px)").matches ||
                  e.metaKey) &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-tools">
            <button
              type="button"
              className="icon-button composer-expand"
              aria-label="Развернуть редактор"
              disabled={sending}
              onClick={openEditor}
            >
              <Maximize2 size={18} />
            </button>
            <VoiceCapture
              recording={recording}
              hasContent={hasContent}
              sending={sending}
              send={send}
            />
          </div>
        </div>
      </form>
      <div className="composer-footnote">
        <span>{brandCopy.motto}</span>
        <span>
          <kbd>⌘</kbd> <kbd>↵</kbd> сохранить
        </span>
      </div>
      <input
        hidden
        type="file"
        multiple
        ref={fileInput}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) attachQuick(files);
          e.target.value = "";
        }}
      />
    </>
  );
}
