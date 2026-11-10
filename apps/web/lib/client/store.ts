"use client";
import { accountDatabaseName, accountFetch } from "./account";
import {
  compareNoteCreation,
  normalizeNote,
  noteSchema,
  type Note,
} from "@doompile/core";
import { LocalNotes, type StoredRecord } from "./local-notes";
import { syncOutbox } from "./sync-outbox";
import { forgetUpload, uploadQuickFile, type QuickUpload } from "./quick-uploads";
import { track, flushTelemetry } from "./telemetry";
import {
  errorProperties,
  newTrace,
  traceparent,
} from "../../../../packages/telemetry/core";

type State = {
  notes: Note[];
  ready: boolean;
  status: "connecting" | "synced" | "offline" | "syncing" | "locked" | "error";
  pending: number;
  message: string;
  errors: { id: string; title: string; message: string }[];
  queuedUploads: Record<string, string[]>;
};
const initial: State = {
  notes: [],
  ready: false,
  status: "connecting",
  pending: 0,
  message: "",
  errors: [],
  queuedUploads: {},
};
let snapshot: State = initial;
const listeners = new Set<() => void>();
let records: Record<string, StoredRecord> = {};
let database: LocalNotes | undefined;
let initializing: Promise<void> | undefined;
let syncing = false;
let channel: BroadcastChannel | undefined;
const transferring = new Set<string>();
const writer =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "server";
function emit(patch: Partial<State> = {}) {
  snapshot = {
    ...snapshot,
    notes: Object.values(records)
      .map((r) => r.note)
      .filter((n) => !n.deletedAt)
      .sort(compareNoteCreation),
    pending: Object.values(records).filter((r) => r.pending).length,
    queuedUploads: Object.fromEntries(
      Object.values(records).filter((record) => record.uploads?.length)
        .map((record) => [record.note.id, record.uploads!.map((file) => file.attachment.id)]),
    ),
    errors: Object.values(records)
      .filter((record) => record.error)
      .map((record) => ({
        id: record.note.id,
        title: record.note.title || "Без названия",
        message: record.error!,
      })),
    ...patch,
  };
  listeners.forEach((listener) => listener());
}
async function refresh(ids?: string[]) {
  if (!database) return;
  if (!ids)
    records = Object.fromEntries(
      (await database.all()).map((record) => [record.note.id, record]),
    );
  else {
    const rows = await database.read(ids);
    ids.forEach((id, index) => {
      if (rows[index]) records[id] = rows[index]!;
      else delete records[id];
    });
  }
  emit();
}
async function changed(ids: string[]) {
  if (!ids.length) return;
  await refresh(ids);
  channel?.postMessage(ids);
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSnapshot() {
  return snapshot;
}
export function getServerSnapshot() {
  return initial;
}
export function initStore(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    try {
      database = await LocalNotes.open(
        writer,
        accountDatabaseName("doompile-v1"),
        () =>
          emit({
            ready: true,
            status: "error",
            message:
              "Закрой старые вкладки Doompile, чтобы обновить локальное хранилище.",
          }),
      );
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(
          accountDatabaseName("doompile-notes-v2"),
        );
        channel.onmessage = (event) => {
          void refresh(
            Array.isArray(event.data) ? event.data : undefined,
          ).catch(() =>
            emit({
              status: "error",
              message: "Не удалось обновить локальные заметки.",
            }),
          );
        };
      }
      await refresh();
      emit({ ready: true });
      retryUploads();
      void sync();
      window.addEventListener("online", () => {
        retryUploads();
        void sync();
      });
      window.addEventListener("focus", () => {
        void refresh().then(() => sync());
      });
      window.setInterval(() => {
        if (document.visibilityState === "visible") void sync();
      }, 20_000);
    } catch (error) {
      track("storage.failed", { operation: "read", ...errorProperties(error) });
      initializing = undefined;
      emit({
        ready: true,
        status: "error",
        message:
          "Не удалось открыть локальное хранилище. Проверь настройки браузера.",
      });
    }
  })();
  return initializing;
}
export async function saveNote(input: Note, uploads: QuickUpload[] = []) {
  const started = performance.now();
  try {
    await initStore();
    if (!database) throw new Error("Хранилище браузера недоступно");
    const note = normalizeNote(input);
    const parsed = noteSchema.safeParse(note);
    if (!parsed.success)
      throw new Error(
        "Заметка превышает допустимый размер или содержит некорректные данные. Текст остаётся в черновике.",
      );
    const previous = records[parsed.data.id]?.note;
    const operation = parsed.data.deletedAt
      ? "delete"
      : previous
        ? "update"
        : "create";
    await changed(await database.save(parsed.data, uploads));
    track("note.saved", {
      note_id: parsed.data.id,
      operation,
      kind: parsed.data.kind,
      duration_ms: performance.now() - started,
    });
    if ((previous?.pinned ?? false) !== parsed.data.pinned)
      track("editor.action", { action: "pin" });
    if ((previous?.urgent ?? false) !== parsed.data.urgent)
      track("editor.action", { action: "urgent" });
    if (
      JSON.stringify([...(previous?.tags || [])].sort()) !==
      JSON.stringify([...parsed.data.tags].sort())
    )
      track("editor.action", { action: "tag" });
    if (uploads.length) retryUploads(parsed.data.id);
    else void sync(false);
  } catch (error) {
    track("storage.failed", { operation: "update", ...errorProperties(error) });
    throw error;
  }
}
export function retryUploads(noteID?: string) {
  if (!database || !navigator.onLine) return;
  const local = database;
  const ids = noteID ? [noteID] : Object.keys(snapshot.queuedUploads);
  for (const id of ids) {
    if (transferring.has(id)) continue;
    transferring.add(id);
    const send = async () => {
      const [current] = await local.read([id]);
      if (!current?.uploads?.length) return;
      for (const file of current.uploads) {
        if (!records[id]?.uploads?.some((upload) => upload.attachment.id === file.attachment.id))
          continue;
        try {
          const attachment = await uploadQuickFile(file);
          await changed(await local.finishUpload(id, attachment));
          forgetUpload(attachment.id);
        } catch {
          // Retain the file for another attempt and continue with other files.
        }
      }
      if (!records[id]?.uploads?.length) void sync(false);
    };
    const task = navigator.locks
      ? navigator.locks.request(accountDatabaseName(`doompile-upload-${id}`), send)
      : send();
    void task.catch(() => {}).finally(() => transferring.delete(id));
  }
}
export async function discardUploads(noteID: string) {
  if (!database) return false;
  const uploads = records[noteID]?.uploads;
  const removed = await database.discardUploads(noteID);
  if (!removed.length) return false;
  for (const file of uploads || []) forgetUpload(file.attachment.id);
  await changed(removed);
  return true;
}
export async function sync(pull = true) {
  if (syncing || !snapshot.ready || !database) return;
  if (!navigator.onLine) {
    emit({ status: "offline" });
    return;
  }
  syncing = true;
  const started = performance.now(),
    trace = newTrace();
  try {
    const run = async () => {
      if (!(await database!.lease(true))) return;
      const heartbeat = window.setInterval(() => {
        void database!.lease(true);
      }, 15_000);
      try {
        emit({ status: "syncing" });
        track("sync.started", { pending: snapshot.pending, pull }, trace);
        const result = await syncOutbox(
          database!,
          changed,
          (url, init) => {
            const headers = new Headers(init?.headers);
            headers.set("traceparent", traceparent(trace));
            return accountFetch(url, { ...init, headers });
          },
          pull,
        );
        track(
          result.locked || result.failed ? "sync.failed" : "sync.completed",
          {
            pending: snapshot.pending,
            failed: result.failed,
            pull,
            duration_ms: performance.now() - started,
            ...(result.locked ? { error_code: "authentication" } : {}),
          },
          trace,
        );
        emit({
          status: result.locked
            ? "locked"
            : result.failed
              ? "error"
              : snapshot.pending
                ? "syncing"
                : "synced",
          message: result.failed
            ? `Не удалось отправить ${result.failed} заметок. Остальные изменения синхронизированы.`
            : result.conflicts
              ? "Заметка менялась на двух устройствах. Обе версии сохранены."
              : "",
        });
      } finally {
        window.clearInterval(heartbeat);
        await database!.lease(false);
      }
    };
    if (navigator.locks)
      await navigator.locks.request(
        accountDatabaseName("doompile-sync-v2"),
        { ifAvailable: true },
        async (lock) => {
          if (lock) await run();
        },
      );
    else await run();
  } catch (error) {
    track(
      "sync.failed",
      {
        pending: snapshot.pending,
        ...errorProperties(error),
        duration_ms: performance.now() - started,
      },
      trace,
    );
    emit({
      status: navigator.onLine ? "error" : "offline",
      message: navigator.onLine
        ? "Синхронизация недоступна. Изменения остаются на устройстве."
        : "",
    });
  } finally {
    syncing = false;
    void flushTelemetry();
  }
}
export async function clearLocalData() {
  await initStore();
  if (!database) throw new Error("Хранилище браузера недоступно");
  const clear = async () => {
    await database!.clear();
    for (const ids of Object.values(snapshot.queuedUploads))
      ids.forEach(forgetUpload);
    records = {};
    emit({ status: "locked", message: "" });
    channel?.postMessage(null);
  };
  if (navigator.locks)
    await navigator.locks.request(
      accountDatabaseName("doompile-sync-v2"),
      clear,
    );
  else await clear();
}
