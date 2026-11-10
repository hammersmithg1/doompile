"use client";

import { useSyncExternalStore } from "react";
import { ArrowUp, LoaderCircle, X } from "../../../packages/design/ui-icons";
import type { Attachment } from "@doompile/core";
import {
  initialUploadState,
  subscribeToUploads,
  uploadState,
} from "@/lib/client/quick-uploads";
import AttachmentPreview from "./attachment-preview";

export default function CaptureAttachment({
  attachment,
  pending,
  onRetry,
  onRemove,
  compact,
}: {
  attachment: Attachment;
  pending?: boolean;
  onRetry?: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const state = useSyncExternalStore(
    subscribeToUploads,
    () => uploadState(attachment.id),
    initialUploadState,
  );
  const percent = state.status === "uploading" ? state.percent : undefined;
  const failed = state.status === "failed";
  const status = failed
    ? "Не удалось загрузить"
    : state.status === "queued"
      ? "Ожидает отправки"
      : percent === undefined || percent === 100
        ? "Загрузка…"
        : `Загрузка ${percent}%`;
  const transfer = pending && state.status !== "ready" ? {
    status: <span className="capture-attachment-status">{status}</span>,
    icon: failed || state.status === "queued" ? (
      <button
        type="button"
        className="capture-attachment-retry"
        aria-label={`Повторить загрузку ${attachment.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRetry?.();
        }}
      >
        <ArrowUp size={18} />
      </button>
    ) : (
      <span
        className="capture-attachment-progress"
        role="progressbar"
        aria-label={`Загрузка ${attachment.name}`}
        aria-valuenow={percent}
      >
        {percent === undefined || percent === 100 ? (
          <LoaderCircle size={22} className="recording-spinner" />
        ) : (
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="10" fill="none" strokeWidth="2" />
            <circle cx="13" cy="13" r="10" fill="none" strokeWidth="2" pathLength="100" strokeDasharray={`${percent} 100`} />
          </svg>
        )}
      </span>
    ),
  } : undefined;
  const preview = (
    <AttachmentPreview
      attachment={state.status === "ready" ? state.attachment : attachment}
      compact={compact}
      transfer={transfer}
    />
  );
  if (!onRemove) return preview;
  return (
    <div className="draft-attachment">
      {preview}
      <button
        type="button"
        className="draft-remove"
        aria-label={`Убрать вложение ${attachment.name}`}
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}
