import { catalog, type EventName, type Platform } from "./catalog.generated";
export { catalog, type EventName, type Platform };
export type Properties = Record<string, string | number | boolean>;
export type Trace = {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
};
export type TelemetryEvent = Trace & {
  schema_version: number;
  id: string;
  timestamp: string;
  name: EventName;
  category: "product" | "technical";
  level: "info" | "warn" | "error";
  platform: Platform;
  release: string;
  environment: "development" | "production" | "test";
  device_id: string;
  session_id: string;
  properties: Properties;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const traceID = /^(?!0{32}$)[0-9a-f]{32}$/;
const spanID = /^(?!0{16}$)[0-9a-f]{16}$/;
export function newTrace(parent?: Trace): Trace {
  return {
    trace_id: parent?.trace_id || crypto.randomUUID().replaceAll("-", ""),
    span_id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    ...(parent ? { parent_span_id: parent.span_id } : {}),
  };
}
export function parseTraceparent(value: string | null): Trace | undefined {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(
    value || "",
  );
  return match && traceID.test(match[1]) && spanID.test(match[2])
    ? { trace_id: match[1], span_id: match[2] }
    : undefined;
}
export const traceparent = (trace: Trace) =>
  `00-${trace.trace_id}-${trace.span_id}-01`;

// Only code locations survive. Error messages, function arguments, URL hosts/queries and file paths never do.
export function safeFrames(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split("\n")
    .flatMap((line) => {
      const native =
        /^native:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{1,16})$/.exec(
          line.trim(),
        );
      if (native) return [native[0]];
      const match =
        /(?:^|[\/\s(@])([a-zA-Z0-9_.-]{1,100}\.(?:[cm]?js|tsx?|swift)):(\d{1,7})(?::(\d{1,7}))?(?:[)\s]|$)/.exec(
          line.trim(),
        );
      return match ? [`${match[1]}:${match[2]}:${match[3] || "0"}`] : [];
    })
    .slice(0, 12)
    .join("\n");
}
export function sanitizeProperties(
  name: EventName,
  input: Record<string, unknown> = {},
): Properties {
  const output: Properties = {};
  for (const key of catalog.events[name].properties) {
    const rule = catalog.properties[key];
    const value = input[key];
    if (Array.isArray(rule)) {
      if (
        typeof value === "string" &&
        (rule as readonly string[]).includes(value)
      )
        output[key] = value;
    } else if (rule === "number") {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1e12
      )
        output[key] = Math.round(value * 100) / 100;
    } else if (rule === "boolean") {
      if (typeof value === "boolean") output[key] = value;
    } else if (rule === "uuid") {
      if (typeof value === "string" && uuid.test(value.toLowerCase()))
        output[key] = value.toLowerCase();
    } else if (rule === "frames") {
      const frames = safeFrames(value);
      if (frames) output[key] = frames;
    } else if (rule === "identifier") {
      if (typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(value))
        output[key] = value;
    }
  }
  return output;
}
export function errorProperties(error: unknown): Properties {
  const value = error as { name?: unknown; stack?: unknown } | null;
  const type =
    typeof value?.name === "string" &&
    (catalog.properties.error_type as readonly string[]).includes(value.name)
      ? value.name
      : "Other";
  const code =
    value?.name === "QuotaExceededError"
      ? "quota"
      : value?.name === "TimeoutError"
        ? "timeout"
        : value?.name === "AbortError"
          ? "cancelled"
          : "unknown";
  return {
    error_type: type,
    error_code: code,
    stack: safeFrames(value?.stack),
  };
}
export function routeName(input: string): string {
  let path: string;
  try {
    path = new URL(input, "http://local").pathname;
  } catch {
    return "other";
  }
  if (/^\/api\/notes\/[^/]+$/.test(path)) return "note";
  if (/^\/api\/attachments\/[^/]+$/.test(path)) return "attachment";
  if (path.startsWith("/api/auth/")) return "auth";
  if (path.startsWith("/api/admin/")) return "admin";
  const name = path.replace(/^\/api\//, "").replaceAll("-", "_");
  return (catalog.properties.route as readonly string[]).includes(name)
    ? name
    : "other";
}
export function mediaKind(mime: string): string {
  const kind = mime.split("/")[0];
  return ["image", "audio", "video"].includes(kind) ? kind : "file";
}
export function validateEvent(input: unknown): TelemetryEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const e = input as TelemetryEvent;
  if (
    e.schema_version !== catalog.version ||
    !Object.hasOwn(catalog.events, e.name) ||
    !uuid.test(e.id) ||
    !uuid.test(e.device_id) ||
    !uuid.test(e.session_id) ||
    !traceID.test(e.trace_id) ||
    !spanID.test(e.span_id) ||
    (e.parent_span_id !== undefined && !spanID.test(e.parent_span_id)) ||
    !(catalog.platforms as readonly string[]).includes(e.platform) ||
    !["development", "production", "test"].includes(e.environment) ||
    typeof e.release !== "string" ||
    !/^[a-zA-Z0-9._-]{1,80}$/.test(e.release) ||
    typeof e.timestamp !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.timestamp) ||
    !Number.isFinite(Date.parse(e.timestamp)) ||
    !e.properties ||
    typeof e.properties !== "object" ||
    Array.isArray(e.properties)
  )
    return null;
  if (new Date(e.timestamp).toISOString() !== e.timestamp) return null;
  const definition = catalog.events[e.name];
  // Rebuild the envelope; untrusted identity/severity and unknown properties never reach storage.
  return {
    schema_version: catalog.version,
    id: e.id,
    timestamp: e.timestamp,
    name: e.name,
    category: definition.category,
    level: definition.level,
    platform: e.platform,
    release: e.release,
    environment: e.environment,
    device_id: e.device_id,
    session_id: e.session_id,
    trace_id: e.trace_id,
    span_id: e.span_id,
    ...(e.parent_span_id ? { parent_span_id: e.parent_span_id } : {}),
    properties: sanitizeProperties(e.name, e.properties),
  };
}
export interface Journal {
  append(event: TelemetryEvent, pending: boolean): Promise<void>;
  read(pendingOnly?: boolean, limit?: number): Promise<TelemetryEvent[]>;
  acknowledge(ids: string[]): Promise<void>;
  clearPending(): Promise<void>;
  stats(): Promise<{ count: number; pending: number; dropped: number }>;
}
export type JournalState = {
  events: { event: TelemetryEvent; pending: boolean }[];
  dropped: number;
};
// Single-writer adapter for browser extension background workers and tests.
export class BoundedJournal implements Journal {
  private work: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: {
      read(): Promise<JournalState | null>;
      write(state: JournalState): Promise<void>;
    },
    private maximum: number = catalog.limits.localEvents,
  ) {}
  private run<T>(fn: (state: JournalState) => Promise<T>): Promise<T> {
    const work = this.work
      .catch(() => {})
      .then(async () =>
        fn((await this.storage.read()) || { events: [], dropped: 0 }),
      );
    this.work = work;
    return work;
  }
  append(event: TelemetryEvent, pending: boolean) {
    return this.run(async (state) => {
      if (state.events.some((row) => row.event.id === event.id)) return;
      state.events.push({ event, pending });
      const cutoff = Date.now() - catalog.limits.localDays * 86400000;
      const keep = state.events
        .filter((row) => Date.parse(row.event.timestamp) >= cutoff)
        .slice(-this.maximum);
      const kept = new Set(keep);
      state.dropped += state.events.filter(
        (row) => row.pending && !kept.has(row),
      ).length;
      state.events = keep;
      await this.storage.write(state);
    });
  }
  read(
    pendingOnly = false,
    limit = catalog.limits.localEvents,
  ): Promise<TelemetryEvent[]> {
    return this.run(async (state) =>
      state.events
        .filter(
          (row) =>
            (!pendingOnly || row.pending) &&
            Date.parse(row.event.timestamp) >=
              Date.now() - catalog.limits.localDays * 86400000,
        )
        .slice(0, limit)
        .map((row) => row.event),
    );
  }
  acknowledge(ids: string[]) {
    return this.run(async (state) => {
      const set = new Set(ids);
      state.events.forEach((row) => {
        if (set.has(row.event.id)) row.pending = false;
      });
      await this.storage.write(state);
    });
  }
  clearPending() {
    return this.run(async (state) => {
      state.events.forEach((row) => {
        row.pending = false;
      });
      await this.storage.write(state);
    });
  }
  stats() {
    return this.run(async (state) => ({
      count: state.events.length,
      pending: state.events.filter((row) => row.pending).length,
      dropped: state.dropped,
    }));
  }
}
export class Recorder {
  private work: Promise<unknown> = Promise.resolve();
  private flushing?: Promise<void>;
  private failures = 0;
  private recent: TelemetryEvent[] = [];
  enabled = true;
  readonly sessionID = crypto.randomUUID();
  constructor(
    readonly journal: Journal,
    readonly resource: {
      platform: Platform;
      deviceID: string;
      release: string;
      environment: TelemetryEvent["environment"];
    },
  ) {}
  record(
    name: EventName,
    properties: Record<string, unknown> = {},
    trace = newTrace(),
    eventID?: string,
  ) {
    const event = validateEvent({
      ...trace,
      schema_version: catalog.version,
      id: eventID || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      name,
      ...this.resource,
      device_id: this.resource.deviceID,
      session_id: this.sessionID,
      properties,
    });
    if (!event) return;
    if (!this.recent.some((previous) => previous.id === event.id))
      this.recent.push(event);
    if (this.recent.length > catalog.limits.localEvents) this.recent.shift();
    const pending = this.enabled;
    this.work = this.work
      .then(() => this.journal.append(event, pending))
      .catch(() => {
        this.failures++;
      });
    return event;
  }
  async settled() {
    await this.work;
  }
  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    await this.settled();
    if (!enabled)
      await this.journal.clearPending().catch(() => {
        this.failures++;
      });
  }
  flush(send: (events: TelemetryEvent[]) => Promise<boolean>): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.settled();
      if (!this.enabled) return;
      const events = await this.journal.read(true, catalog.limits.batchEvents);
      if (events.length && (await send(events)) && this.enabled)
        await this.journal.acknowledge(events.map((e) => e.id));
    })()
      .catch(() => {
        /* Diagnostics never break the host app; pending data remains durable. */
      })
      .finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }
  async dump() {
    this.record("diagnostics.exported");
    await this.settled();
    const events = await this.journal.read().catch(() => this.recent);
    const stats = await this.journal
      .stats()
      .catch(() => ({ count: events.length, pending: 0, dropped: 0 }));
    return {
      format: "doompile-diagnostics",
      schema_version: catalog.version,
      exported_at: new Date().toISOString(),
      resource: this.resource,
      health: {
        ...stats,
        storage_failures: this.failures,
        persistent: this.failures === 0,
      },
      catalog_version: catalog.version,
      events,
    };
  }
}
