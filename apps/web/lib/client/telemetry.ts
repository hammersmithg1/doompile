"use client";
import {
  Recorder,
  BoundedJournal,
  newTrace,
  parseTraceparent,
  traceparent,
  errorProperties,
  routeName,
  type Trace,
  type EventName,
  type Journal,
  type JournalState,
} from "../../../../packages/telemetry/core";
import { indexedDBJournal } from "../../../../packages/telemetry/indexed-db";

let recorder: Recorder | undefined;
let scope = "";
let timer: ReturnType<typeof setInterval> | undefined;
let hooksInstalled = false;
let retryAt = 0;
let backoff = 1000;
const settingKey = () => `doompile-telemetry-enabled:${scope}`;
export function webTelemetry() {
  return recorder;
}
export function track(
  name: EventName,
  properties: Record<string, unknown> = {},
  trace?: Trace,
) {
  return recorder?.record(name, properties, trace);
}
export function captureWebError(error: unknown) {
  ensureBootstrapRecorder();
  track("runtime.error", errorProperties(error));
}
function ensureBootstrapRecorder() {
  if (recorder || typeof window === "undefined") return;
  let state: JournalState | null = null;
  recorder = new Recorder(
    new BoundedJournal({
      read: async () => state,
      write: async (next) => {
        state = next;
      },
    }),
    {
      platform: "web",
      deviceID: crypto.randomUUID(),
      release: process.env.NEXT_PUBLIC_DOOMPILE_RELEASE || "0.1.0",
      environment:
        process.env.NODE_ENV === "production" ? "production" : "development",
    },
  );
  recorder.enabled = false;
}
export function startTelemetry(userID: string) {
  if (typeof window === "undefined") return;
  if (scope === userID && recorder) return;
  const bootstrap = !scope ? recorder : undefined;
  scope = userID;
  let deviceID = crypto.randomUUID();
  let enabled = true;
  try {
    const existing = localStorage.getItem("doompile-diagnostics-device");
    if (/^[0-9a-f-]{36}$/.test(existing || ""))
      deviceID = existing as typeof deviceID;
    else localStorage.setItem("doompile-diagnostics-device", deviceID);
    enabled = localStorage.getItem(settingKey()) !== "false";
  } catch {
    /* IndexedDB can still work when localStorage is unavailable. */
  }
  let journal: Journal;
  try {
    journal = indexedDBJournal(userID);
  } catch {
    journal = new BoundedJournal({
      read: async () => {
        throw new Error("Storage unavailable");
      },
      write: async () => {},
    });
  }
  recorder = new Recorder(journal, {
    platform: "web",
    deviceID,
    release: process.env.NEXT_PUBLIC_DOOMPILE_RELEASE || "0.1.0",
    environment:
      process.env.NODE_ENV === "production" ? "production" : "development",
  });
  recorder.enabled = enabled;
  if (!enabled) void recorder.setEnabled(false);
  track("app.started");
  if (bootstrap) {
    const target = recorder;
    void bootstrap
      .settled()
      .then(async () => {
        for (const event of await bootstrap.journal.read())
          target.record(event.name, event.properties, event, event.id);
      })
      .catch(() => {});
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void flushTelemetry();
  }, 15000);
  installTelemetryHooks();
  void flushTelemetry();
}
export function installTelemetryHooks() {
  if (hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;
  window.addEventListener("error", (event) => captureWebError(event.error));
  window.addEventListener("unhandledrejection", (event) =>
    captureWebError(event.reason),
  );
  for (const state of ["online", "offline"] as const)
    window.addEventListener(state, () => {
      track("app.state", { state });
      if (state === "online") {
        retryAt = 0;
        void flushTelemetry();
      }
    });
  document.addEventListener("visibilitychange", () => {
    track("app.state", {
      state: document.visibilityState === "visible" ? "active" : "background",
    });
    void flushTelemetry();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === settingKey() && recorder)
      void recorder.setEnabled(event.newValue !== "false");
  });
}
export async function setTelemetryEnabled(enabled: boolean) {
  try {
    localStorage.setItem(settingKey(), String(enabled));
  } catch {
    /* Preference remains effective for this session. */
  }
  await recorder?.setEnabled(enabled);
}
export async function flushTelemetry() {
  const target = recorder,
    userID = scope;
  if (!target || !userID || !navigator.onLine || Date.now() < retryAt) return;
  return target.flush(async (events) => {
    try {
      const body = JSON.stringify({ events });
      const response = await fetch("/api/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Doompile-User-ID": userID,
        },
        body,
        signal: AbortSignal.timeout(8000),
        keepalive: new TextEncoder().encode(body).length < 60000,
      });
      if (!response.ok) throw new Error("Telemetry delivery failed");
      backoff = 1000;
      retryAt = 0;
      return true;
    } catch {
      retryAt = Date.now() + backoff;
      backoff = Math.min(backoff * 2, 300000);
      return false;
    }
  });
}
export async function telemetryFetch(
  input: string | URL | Request,
  init?: RequestInit,
  parent?: Trace,
): Promise<Response> {
  ensureBootstrapRecorder();
  const rawURL = input instanceof Request ? input.url : String(input);
  const url = new URL(rawURL, location.origin);
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith("/api/") ||
    url.pathname === "/api/telemetry"
  )
    return fetch(input, init);
  const started = performance.now();
  const headers = new Headers(
    init?.headers || (input instanceof Request ? input.headers : undefined),
  );
  const trace = newTrace(
    parent || parseTraceparent(headers.get("traceparent")),
  );
  headers.set("traceparent", traceparent(trace));
  const properties = {
    route: routeName(rawURL),
    method: init?.method || (input instanceof Request ? input.method : "GET"),
  };
  try {
    const response = await fetch(input, { ...init, headers });
    track(
      response.status >= 500 ? "http.failed" : "http.completed",
      {
        ...properties,
        status: response.status,
        duration_ms: performance.now() - started,
      },
      trace,
    );
    return response;
  } catch (error) {
    track(
      "http.failed",
      {
        ...properties,
        ...errorProperties(error),
        ...(!navigator.onLine ? { error_code: "offline" } : {}),
        duration_ms: performance.now() - started,
      },
      trace,
    );
    throw error;
  }
}
export async function exportDiagnostics() {
  ensureBootstrapRecorder();
  if (!recorder) return;
  const dump = await recorder.dump();
  if (!scope) dump.health.persistent = false;
  const file = new File(
    [JSON.stringify(dump, null, 2)],
    `doompile-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    { type: "application/json" },
  );
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Диагностика Doompile" });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
