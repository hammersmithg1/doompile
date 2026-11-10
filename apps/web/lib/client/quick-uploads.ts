"use client";

import { NOTE_LIMITS, attachmentSchema, type Attachment } from "@doompile/core";
import { accountID } from "./account";
import { track } from "./telemetry";
import {
  errorProperties,
  newTrace,
  routeName,
  traceparent,
} from "../../../../packages/telemetry/core";

export type QuickUpload = { attachment: Attachment; data: Blob };
export type UploadState =
  | { status: "queued" }
  | { status: "uploading"; percent?: number }
  | { status: "failed" }
  | { status: "ready"; attachment: Attachment };

const queued: UploadState = { status: "queued" };
const states = new Map<string, UploadState>();
const active = new Map<
  string,
  { controller: AbortController; task: Promise<Attachment> }
>();
const listeners = new Set<() => void>();

export function subscribeToUploads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const uploadState = (id: string) => states.get(id) || queued;
export const initialUploadState = () => queued;

function update(id: string, state: UploadState) {
  states.set(id, state);
  listeners.forEach((listener) => listener());
}

export function quickUpload(
  file: File,
  id: string = crypto.randomUUID(),
): QuickUpload {
  return {
    attachment: {
      id,
      name:
        file.name
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, NOTE_LIMITS.attachmentName) || "Файл",
      mimeType:
        file.type.slice(0, NOTE_LIMITS.mimeType) || "application/octet-stream",
      url: `/api/attachments/${id}`,
      size: file.size,
    },
    data: file,
  };
}

function postFile(upload: QuickUpload, signal: AbortSignal) {
  return new Promise<Attachment>((resolve, reject) => {
    const { attachment, data } = upload;
    const request = new XMLHttpRequest();
    const trace = newTrace();
    const properties = { route: routeName("/api/attachments"), method: "POST" };
    const started = performance.now();
    const abort = () => request.abort();
    const fail = (error: Error) => {
      signal.removeEventListener("abort", abort);
      if (!signal.aborted)
        track(
          "http.failed",
          {
            ...properties,
            ...errorProperties(error),
            duration_ms: performance.now() - started,
          },
          trace,
        );
      reject(error);
    };
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total)
        update(attachment.id, {
          status: "uploading",
          percent: Math.min(99, Math.floor((event.loaded / event.total) * 100)),
        });
    };
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      track(
        request.status >= 500 ? "http.failed" : "http.completed",
        {
          ...properties,
          status: request.status,
          duration_ms: performance.now() - started,
        },
        trace,
      );
      if (request.status === 401)
        window.dispatchEvent(new Event("doompile-session-expired"));
      const parsed = attachmentSchema.safeParse(request.response?.attachment);
      if (
        request.status >= 200 &&
        request.status < 300 &&
        parsed.success &&
        parsed.data.id === attachment.id &&
        parsed.data.url === attachment.url
      )
        resolve(parsed.data);
      else reject(new Error("Не удалось загрузить вложение."));
    };
    request.onerror = () =>
      fail(new Error("Не удалось подключиться к хранилищу."));
    request.onabort = () =>
      fail(new DOMException("Отправка отменена.", "AbortError"));
    request.ontimeout = () =>
      fail(new Error("Время ожидания загрузки истекло."));
    request.open("POST", "/api/attachments");
    request.responseType = "json";
    request.setRequestHeader("X-Doompile-User-ID", accountID());
    request.setRequestHeader("X-Doompile-Upload-ID", attachment.id);
    request.setRequestHeader("traceparent", traceparent(trace));
    signal.addEventListener("abort", abort, { once: true });
    const form = new FormData();
    form.append(
      "file",
      data.type === attachment.mimeType
        ? data
        : data.slice(0, data.size, attachment.mimeType),
      attachment.name,
    );
    request.send(form);
  });
}

export function uploadQuickFile(upload: QuickUpload): Promise<Attachment> {
  const id = upload.attachment.id;
  const existing = active.get(id);
  if (existing) return existing.task;
  const state = uploadState(id);
  if (state.status === "ready") return Promise.resolve(state.attachment);
  if (!navigator.onLine) {
    update(id, queued);
    return Promise.reject(new Error("Ожидает соединения."));
  }
  const controller = new AbortController();
  update(id, { status: "uploading" });
  const task = postFile(upload, controller.signal)
    .then((attachment) => {
      if (!controller.signal.aborted)
        update(id, { status: "ready", attachment });
      return attachment;
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted)
        update(id, navigator.onLine ? { status: "failed" } : queued);
      throw error;
    })
    .finally(() => {
      if (active.get(id)?.controller === controller) active.delete(id);
    });
  active.set(id, { controller, task });
  return task;
}

export function forgetUpload(id: string) {
  active.get(id)?.controller.abort();
  active.delete(id);
  if (states.delete(id)) listeners.forEach((listener) => listener());
}

export function markUploadFailed(id: string) {
  update(id, { status: "failed" });
}
