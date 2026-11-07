"use client";
import { brandCopy, uiCopy } from "../../../packages/design/copy";
import type {
  Dispatch,
  SetStateAction,
  RefObject,
  ClipboardEvent,
} from "react";
import { Plus, X, Paperclip, Maximize2, ArrowUp } from "../../../packages/design/ui-icons";
import type { Attachment } from "@doompile/core";
import { recordingSession } from "@/lib/client/recording";
import { RecordingPreview } from "../../../packages/editor/src/media-preview";
import AttachmentPreview from "./attachment-preview";
import VoiceCapture from "./voice-capture";
type RecordingState = ReturnType<typeof recordingSession.getSnapshot>;
export default function QuickComposer({
  recording,
  editorId,
  dropActive,
  draftAttachments,
  setDraftAttachments,
  uploading,
  text,
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
  draftAttachments: Attachment[];
  setDraftAttachments: Dispatch<SetStateAction<Attachment[]>>;
  uploading: number;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  sending: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  send: () => Promise<void>;
  openEditor: () => void;
  pasteQuick: (event: ClipboardEvent) => Promise<void>;
  attachQuick: (files: File[]) => Promise<void>;
  setSelected: (id: string) => void;
}) {
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
        {dropActive && (
          <div className="quick-drop-label" role="status">
            Добавить в новое сообщение
          </div>
        )}
        {(draftAttachments.length > 0 || uploading > 0) && (
          <div className="quick-attachments" aria-live="polite">
            {draftAttachments.map((a) => (
              <div className="draft-attachment" key={a.id}>
                <AttachmentPreview attachment={a} />
                <button
                  type="button"
                  className="draft-remove"
                  aria-label={`Убрать вложение ${a.name}`}
                  onClick={() =>
                    setDraftAttachments((current) =>
                      current.filter((item) => item.id !== a.id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {uploading > 0 && (
              <span className="upload-status">
                <span className="upload-spinner" />
                Загружаем файлы…
              </span>
            )}
          </div>
        )}
        <div className="composer-input-row">
          <button
            type="button"
            className="mobile-compose-plus"
            aria-label="Новая заметка"
            onClick={() => openEditor()}
          >
            <Plus size={23} />
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
            <VoiceCapture disabled={!!uploading} />
            <button
              type="button"
              className="icon-button attachment-trigger"
              aria-label="Прикрепить файл"
              disabled={sending}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={19} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Развернуть редактор"
              disabled={sending}
              onClick={() => openEditor()}
            >
              <Maximize2 size={17} />
            </button>
            <button
              type="submit"
              className="send-button"
              aria-label="Сохранить заметку"
              disabled={
                (!text.trim() &&
                  !draftAttachments.length &&
                  recording.draft?.target !== "quick") ||
                sending ||
                (recording.draft?.target === "quick" &&
                  ["starting", "uploading"].includes(recording.status)) ||
                !!uploading
              }
            >
              <ArrowUp size={22} />
            </button>
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
          if (files.length) void attachQuick(files);
          e.target.value = "";
        }}
      />
    </>
  );
}
