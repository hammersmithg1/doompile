"use client";
import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";
import { useRecording } from "./use-recording";
import { recordingSession } from "@/lib/client/recording";
import type { RichEditorAPI } from "./rich-editor";
import {
  ArrowUp,
  Flame,
  Link2,
  Maximize2,
  Minimize2,
  Pin,
  Trash2,
  X,
  
  ListChecks,
  Type,
  Highlighter,
  MoreHorizontal,
  Layers,
  ImagePlus,
  Paperclip,
  Mic,
  Keyboard,
  Undo2,
} from "../../../packages/design/ui-icons";
import { type Note, type Attachment, type DocumentNode } from "@doompile/core";
import NoteTags from "./note-tags";
const RichEditor = dynamic(() => import("./rich-editor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Открываем редактор…</div>,
});
export default function NoteEditorSurface({
  note,
  documentVersion = 0,
  notes,
  tags,
  availableTags,
  status,
  busy,
  existing,
  expanded,
  onClose,
  onSendCapture,
  sendingCapture = false,
  captureAttachments,
  onCopyLink,
  onExpand,
  onDelete,
  onChange,
  onTags,
  onBusy,
  onAttachment,
  onReference,
  apiRef,
  mobile = false,
}: {
  note: Note;
  documentVersion?: number;
  notes: Note[];
  tags: string[];
  availableTags: string[];
  status: string;
  busy?: boolean;
  existing: boolean;
  expanded: boolean;
  onClose: () => void;
  onSendCapture?: () => void;
  sendingCapture?: boolean;
  captureAttachments?: ReactNode;
  onCopyLink: () => void;
  onExpand: () => void;
  onDelete: () => void;
  onChange: (patch: Partial<Note>) => void;
  onTags: (tags: string[]) => void;
  onBusy: (busy: boolean) => void;
  onAttachment: (file: File) => Promise<Attachment>;
  onReference: (id: string) => void;
  apiRef?: { current: RichEditorAPI | null };
  mobile?: boolean;
}) {
  const ownAPI = useRef<RichEditorAPI | null>(null);
  const editorAPI = apiRef || ownAPI;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const recording = useRecording();
  const recordingTarget = existing ? note.id : "quick";
  const ownsRecording = recording.draft?.target === recordingTarget;
  const live =
    ownsRecording && ["starting", "recording", "stopping"].includes(recording.status);
  const closeLabel = onSendCapture ? "Свернуть редактор" : "Закрыть редактор";
  return (
    <section
      className={`note-editor-surface ${dragging ? "file-drop-active" : ""}`}
      data-file-drop-zone="editor"
      aria-label="Редактор заметки"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }
      }}
      onDrop={(event) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!event.defaultPrevented && event.dataTransfer.files.length) {
          event.preventDefault();
          event.stopPropagation();
          editorAPI.current?.dropFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      {dragging && (
        <div className="editor-drop-label" role="status">
          Добавить в эту заметку
        </div>
      )}
      <header className="note-editor-header">
        <div className="note-editor-header-inner">
          {mobile && (
            <NoteTags
              value={tags}
              available={availableTags}
              onChange={onTags}
            />
          )}
          <span className="editor-save-status" role="status">
            {status}
          </span>
          {live && (
            <div className="header-recording" role="status">
              <span className="recording-dot" />
              <span>
                {recording.status === "starting" ? (
                  "Включаем микрофон…"
                ) : (
                  <>
                    Запись {Math.floor((recording.draft?.seconds || 0) / 60)}:
                    {String((recording.draft?.seconds || 0) % 60).padStart(
                      2,
                      "0",
                    )}
                  </>
                )}
              </span>
              {existing && (
                <button
                  type="button"
                  aria-label="Остановить запись в шапке"
                  onClick={recordingSession.stop}
                >
                  ■ Стоп
                </button>
              )}
            </div>
          )}
          <div className="note-editor-actions">
            {!existing && (
              <div className="mobile-new-flags">
                <button
                  className={`editor-action ${note.pinned ? "active" : ""}`}
                  aria-label={note.pinned ? "Открепить" : "Закрепить"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange({ pinned: !note.pinned })}
                >
                  <Pin size={20} />
                </button>
                <button
                  className={`editor-action ${note.urgent ? "urgent-active" : ""}`}
                  aria-label={
                    note.urgent ? "Убрать из важного" : "Сделать важной"
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange({ urgent: !note.urgent })}
                >
                  <Flame size={20} />
                </button>
              </div>
            )}
            {existing && (
              <>
                <button
                  type="button"
                  className="editor-action"
                  aria-label="Скопировать ссылку на заметку"
                  title="Скопировать ссылку"
                  onClick={onCopyLink}
                >
                  <Link2 size={17} />
                </button>
              </>
            )}
            {existing && (
              <>
                <button
                  type="button"
                  className={`editor-action ${note.pinned ? "active" : ""}`}
                  aria-label={note.pinned ? "Открепить" : "Закрепить"}
                  aria-pressed={note.pinned}
                  title={note.pinned ? "Открепить" : "Закрепить"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChange({ pinned: !note.pinned })}
                >
                  {<Pin size={mobile ? 20 : 17} />}
                </button>
                <button
                  type="button"
                  className={`editor-action ${note.urgent ? "urgent-active" : ""}`}
                  aria-label={
                    note.urgent ? "Убрать из важного" : "Сделать важной"
                  }
                  aria-pressed={note.urgent}
                  title="Важное"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChange({ urgent: !note.urgent })}
                >
                  <Flame size={18} />
                </button>
                <button
                  type="button"
                  className="editor-action editor-delete"
                  aria-label="Удалить заметку"
                  title="Удалить заметку"
                  disabled={busy}
                  onClick={onDelete}
                >
                  <Trash2 size={17} />
                </button>
                <span className="editor-action-divider" />
                <button
                  type="button"
                  className="editor-action"
                  aria-label={
                    expanded ? "Свернуть заметку" : "Развернуть заметку"
                  }
                  title={expanded ? "Свернуть заметку" : "Развернуть заметку"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onExpand}
                >
                  {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
              </>
            )}
            <button
              type="button"
              className="editor-action"
              aria-label={closeLabel}
              title={busy ? "Загружаем вложения…" : closeLabel}
              disabled={busy || sendingCapture}
              onClick={onClose}
            >
              {onSendCapture ? <Minimize2 size={18} /> : <X size={18} />}
            </button>
            {onSendCapture && (
              <button
                type="button"
                className="send-button"
                aria-label="Сохранить заметку"
                disabled={
                  busy || sendingCapture || recording.status === "starting"
                }
                onClick={onSendCapture}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="note-editor-scroll">
        <div className="note-editor-document">
          {!mobile && (
            <NoteTags
              value={tags}
              available={availableTags}
              onChange={onTags}
            />
          )}
          {captureAttachments}
          <RichEditor
            autoFocus={!existing}
            onMediaPaste={(attachments) =>
              onChange({
                attachments: [
                  ...note.attachments,
                  ...attachments.filter(
                    (item) =>
                      !note.attachments.some(
                        (existing) => existing.id === item.id,
                      ),
                  ),
                ],
              })
            }
            key={`${note.id}:${documentVersion}`}
            noteId={note.id}
            recordingTarget={recordingTarget}
            readOnly={sendingCapture}
            attachments={note.attachments}
            apiRef={editorAPI}
            value={note.body}
            notes={notes}
            onBusy={onBusy}
            onAttachment={onAttachment}
            onReference={onReference}
            onChange={(body, plainText) =>
              onChange({ body: body as DocumentNode, plainText })
            }
          />
          {note.source?.articleText && (
            <details className="saved-article">
              <summary>Сохранённый текст статьи</summary>
              <div>{note.source.articleText}</div>
            </details>
          )}
        </div>
      </div>
      <div
        className="mobile-editor-tools"
        role="toolbar"
        aria-label="Инструменты редактора"
      >
        <div>
          {[
            ["checklist", "Чеклист", ListChecks],
            ["type", "Стиль текста", Type],
            ["colors", "Цвет текста", Highlighter],
            ["more", "Форматирование", MoreHorizontal],
            ["block", "Действия с блоком", Layers],
            ["image", "Добавить фото", ImagePlus],
            ["file", "Добавить файл", Paperclip],
            ["voice", "Голосовая заметка", Mic],
            ["drawing", "Рисунок", Highlighter],
            ["undo", "Отменить ввод", Undo2],
          ].map(([command, label, Icon]) => {
            const Symbol = Icon as typeof Mic;
            return (
              <button
                key={command as string}
                type="button"
                aria-label={label as string}
                disabled={
                  command === "voice" && recording.status !== "idle" && !existing
                }
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editorAPI.current?.touchCommand(command as string)
                }
              >
                <Symbol size={22} />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Скрыть клавиатуру"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorAPI.current?.touchCommand("keyboard")}
        >
          <Keyboard size={22} />
        </button>
      </div>
    </section>
  );
}
