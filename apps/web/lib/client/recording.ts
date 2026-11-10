import { openDB } from "idb";
import { accountDatabaseName } from "./account";
import { track } from "./telemetry";
import { errorProperties } from "../../../../packages/telemetry/core";
export type RecordingDraft = {
  id: string;
  target: string;
  startedAt: number;
  seconds: number;
  mimeType: string;
  blob: Blob;
};
export type RecordingState = {
  status:
    "idle" | "starting" | "recording" | "stopping" | "ready" | "uploading";
  draft: RecordingDraft | null;
  url: string;
  error: string;
  recovered: boolean;
  analyser?: AnalyserNode;
};
const empty: RecordingState = {
  status: "idle",
  draft: null,
  url: "",
  error: "",
  recovered: false,
};
export type RecordingStorage = {
  read(): Promise<RecordingDraft | undefined>;
  write(draft: RecordingDraft): Promise<void>;
  remove(): Promise<void>;
};
const database = () =>
  openDB(accountDatabaseName("doompile-recordings"), 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("drafts"))
        db.createObjectStore("drafts");
      if (!db.objectStoreNames.contains("chunks"))
        db.createObjectStore("chunks");
    },
  });
const checkpointSizes = new Map<string, number>();
const storage: RecordingStorage = {
  async read() {
    const db = await database(),
      saved = await db.get("drafts", "active");
    if (!saved) return undefined;
    if (saved.blob instanceof Blob) return saved; // Earlier local builds.
    if (saved.bytes)
      return {
        ...saved,
        blob: new Blob([saved.bytes], { type: saved.mimeType }),
      };
    const chunks = await db.getAll(
      "chunks",
      IDBKeyRange.bound([saved.id, 0], [saved.id, Number.MAX_SAFE_INTEGER]),
    );
    const blob = new Blob(chunks, { type: saved.mimeType });
    checkpointSizes.set(saved.id, blob.size);
    return { ...saved, blob };
  },
  async write(draft) {
    // Append only newly recorded bytes. ArrayBuffers also work in Safari's IDB
    // implementation where storing empty Blob objects can fail.
    const written = checkpointSizes.get(draft.id) || 0;
    const bytes = await draft.blob.slice(written).arrayBuffer();
    const db = await database(),
      transaction = db.transaction(["drafts", "chunks"], "readwrite");
    if (bytes.byteLength)
      await transaction.objectStore("chunks").put(bytes, [draft.id, written]);
    const { blob, ...metadata } = draft;
    await transaction
      .objectStore("drafts")
      .put({ ...metadata, byteLength: blob.size }, "active");
    await transaction.done;
    checkpointSizes.set(draft.id, blob.size);
  },
  async remove() {
    const db = await database(),
      saved = await db.get("drafts", "active"),
      transaction = db.transaction(["drafts", "chunks"], "readwrite");
    await transaction.objectStore("drafts").delete("active");
    if (saved) {
      await transaction
        .objectStore("chunks")
        .delete(
          IDBKeyRange.bound([saved.id, 0], [saved.id, Number.MAX_SAFE_INTEGER]),
        );
      checkpointSizes.delete(saved.id);
    }
    await transaction.done;
  },
};
/** Owns the microphone and durable checkpoints independently of any mounted UI. */
export class RecordingSession {
  private state = empty;
  private listeners = new Set<() => void>();
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private writes = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private initialized = false;
  private checkpointFailed = false;
  private restoring?: Promise<void>;
  private generation = 0;
  private context?: AudioContext;
  private delivery?: Promise<void>;
  constructor(private disk: RecordingStorage = storage) {}
  getSnapshot = () => this.state;
  getServerSnapshot = () => empty;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(patch: Partial<RecordingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  restore() {
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const draft = await this.disk.read();
      if (draft?.blob.size && ["idle", "starting"].includes(this.state.status))
        this.emit({
          draft,
          status: "ready",
          url: URL.createObjectURL(draft.blob),
          recovered: true,
        });
      if (!this.initialized && typeof window !== "undefined") {
        this.initialized = true;
        window.addEventListener("pagehide", this.stop);
        window.addEventListener("beforeunload", (event) => {
          if (this.checkpointFailed && this.state.draft?.blob.size) {
            event.preventDefault();
            event.returnValue = "";
          }
        });
        document.addEventListener("visibilitychange", () => {
          if (
            document.visibilityState === "hidden" &&
            this.recorder?.state === "recording"
          ) {
            this.recorder.requestData();
            void this.checkpoint();
          }
        });
        window.addEventListener("online", this.retry);
      }
    })().catch(() => {
      this.emit({ error: "Не удалось открыть локальное хранилище записи." });
    });
    return this.restoring;
  }
  async start(target = "quick") {
    if (this.state.status !== "idle") return;
    const generation = ++this.generation;
    const pending: RecordingDraft = {
      id: crypto.randomUUID(),
      target,
      startedAt: 0,
      seconds: 0,
      mimeType: "audio/webm",
      blob: new Blob([], { type: "audio/webm" }),
    };
    this.emit({
      status: "starting",
      draft: pending,
      error: "",
      recovered: false,
    });
    let context: AudioContext | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Для записи нужен микрофон и HTTPS или localhost.");
      // Request permission in the click handler, before any database await.
      const capture = navigator.mediaDevices.getUserMedia({ audio: true });
      const restoring = this.restore();
      try {
        if (typeof window.AudioContext === "function") {
          context = new window.AudioContext();
          this.context = context;
          void context.resume().catch(() => {});
        }
      } catch {} // Meter availability must never prevent recording.
      const stream = await capture;
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        void context?.close().catch(() => {});
        return;
      }
      await restoring;
      if (
        generation !== this.generation ||
        this.state.draft?.id !== pending.id
      ) {
        stream.getTracks().forEach((track) => track.stop());
        void context?.close().catch(() => {});
        return;
      }
      this.stream = stream;
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? ["audio/webm;codecs=opus", "audio/mp4"].find((type) =>
              MediaRecorder.isTypeSupported(type),
            )
          : undefined;
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      this.recorder = recorder;
      const actualMimeType = recorder.mimeType || "audio/webm";
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          this.chunks.push(event.data);
          void this.checkpoint();
        }
      };
      recorder.onstop = () => {
        this.release();
        void this.checkpoint().then(() => {
          const blob = this.state.draft?.blob;
          track("recording.completed", { bytes: blob?.size || 0, duration_ms: (this.state.draft?.seconds || 0) * 1000 });
          this.emit({
            status: "ready",
            analyser: undefined,
            url: blob?.size ? URL.createObjectURL(blob) : "",
            error: blob?.size
              ? this.state.error
              : "В записи пока нет звука. Попробуй записать ещё раз.",
          });
        });
      };
      recorder.onerror = () => {
        track("recording.failed", { error_code: "unknown" });
        this.emit({
          error:
            "Запись прервалась. Записанный фрагмент сохранён на устройстве.",
        });
        this.stop();
      };
      // Capture immediately. Durable writes run in order in the background.
      recorder.start(200);
      track("recording.started");
      let analyser: AnalyserNode | undefined;
      try {
        if (context) {
          analyser = context.createAnalyser();
          analyser.fftSize = 512;
          context.createMediaStreamSource(stream).connect(analyser);
        }
      } catch {}
      this.checkpointFailed = false;
      this.emit({
        draft: {
          ...pending,
          target: this.state.draft?.target || target,
          startedAt: Date.now(),
          mimeType: actualMimeType,
          blob: new Blob([], { type: actualMimeType }),
        },
        status: "recording",
        analyser,
      });
      void this.checkpoint();
      this.timer = setInterval(() => {
        const draft = this.state.draft;
        if (draft)
          this.emit({
            draft: {
              ...draft,
              seconds: Math.floor((Date.now() - draft.startedAt) / 1000),
            },
          });
      }, 250);
    } catch (error) {
      track("recording.failed", errorProperties(error));
      if (generation !== this.generation) return;
      this.release();
      this.emit({
        status: "idle",
        draft: null,
        analyser: undefined,
        error:
          error instanceof Error ? error.message : "Не удалось начать запись.",
      });
    }
  }
  private release() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
  private checkpoint() {
    const previous = this.state.draft;
    if (!previous) return this.writes;
    const draft = {
      ...previous,
      blob: new Blob(this.chunks, { type: previous.mimeType }),
      seconds: Math.floor((Date.now() - previous.startedAt) / 1000),
    };
    this.emit({ draft });
    const task = this.writes.catch(() => {}).then(() => this.disk.write(draft));
    this.writes = task;
    return task
      .then(() => {
        this.checkpointFailed = false;
      })
      .catch(() => {
        this.checkpointFailed = true;
        this.emit({
          error:
            "Не удалось сохранить контрольную копию. Запись остановлена; повтори сохранение.",
        });
        if (this.state.status === "recording") this.stop();
      });
  }
  stop = () => {
    if (this.state.status === "starting") {
      this.generation++;
      this.release();
      this.emit({ ...empty });
      return;
    }
    if (this.recorder?.state === "recording") {
      this.emit({ status: "stopping" });
      this.recorder.stop();
    }
  };
  async finish(target?: string) {
    if (target && this.state.draft?.target !== target) return;
    this.stop();
    if (this.state.status !== "stopping") return;
    await new Promise<void>((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (this.state.status !== "stopping") {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  async discardQuick() {
    const draft = this.state.draft;
    if (draft?.target !== "quick" || this.state.status === "uploading") return;
    await this.finish("quick");
    if (this.state.draft?.id !== draft.id) return;
    this.emit({ status: "stopping" });
    try {
      await this.writes.catch(() => {});
      await this.disk.remove();
      if (this.state.url) URL.revokeObjectURL(this.state.url);
      this.emit({ ...empty, analyser: undefined });
    } catch {
      this.emit({ status: "ready", error: "Не удалось убрать запись." });
    }
  }
  moveTo(target: string) {
    if (!this.state.draft || this.state.draft.target === target) return;
    const draft = { ...this.state.draft, target };
    this.emit({ draft });
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.disk.write(draft));
    void this.writes.catch(() => {
      this.checkpointFailed = true;
      this.emit({ error: "Не удалось сохранить контрольную копию записи." });
    });
  }
  retry = () => {
    if (this.state.status !== "ready" || !this.state.draft) return;
    if (!this.state.draft.blob.size) {
      void this.disk.remove().then(() => this.emit({ ...empty }));
      return;
    }
    const draft = this.state.draft;
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.disk.write(draft));
    void this.writes
      .then(() => {
        this.checkpointFailed = false;
        this.emit({ error: "" });
      })
      .catch(() =>
        this.emit({ error: "Не удалось сохранить контрольную копию записи." }),
      );
  };
  deliver(save: (draft: RecordingDraft) => Promise<void>): Promise<void> {
    if (this.delivery) return this.delivery;
    const draft = this.state.draft;
    if (this.state.status !== "ready" || !draft?.blob.size)
      return Promise.resolve();
    this.emit({ status: "uploading", error: "" });
    this.delivery = (async () => {
      try {
        await this.writes;
        await save(draft);
        await this.disk.remove();
        if (this.state.url) URL.revokeObjectURL(this.state.url);
        this.emit({ ...empty, analyser: undefined });
      } catch (error) {
        this.emit({
          status: "ready",
          error:
            error instanceof Error
              ? error.message
              : "Запись сохранена на устройстве. Повтори отправку.",
        });
      }
    })().finally(() => {
      this.delivery = undefined;
    });
    return this.delivery;
  }
}
export const recordingSession = new RecordingSession();
