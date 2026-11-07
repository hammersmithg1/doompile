import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "./identity";
import { principal } from "./auth";
import {
  catalog,
  newTrace,
  parseTraceparent,
  traceparent,
  routeName,
  validateEvent,
  errorProperties,
  type EventName,
  type TelemetryEvent,
  type Trace,
} from "../../../../packages/telemetry/core";

type Context = { trace: Trace; userID: string | null };
const context = new AsyncLocalStorage<Context>();
const sessionID = randomUUID(),
  deviceID = randomUUID();
let writeFailures = 0;
let writeUnavailable = false;
export class TelemetryStore {
  private db: DatabaseSync;
  private prunedAt = 0;
  constructor(
    directory: string,
    private maximum: number = catalog.limits.serverEvents,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(resolve(directory, "telemetry.sqlite"));
    chmodSync(resolve(directory, "telemetry.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, event_id TEXT NOT NULL, received_at TEXT NOT NULL, timestamp TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, level TEXT NOT NULL, trace_id TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(user_id,event_id));
      CREATE INDEX IF NOT EXISTS events_user_time ON events(user_id,received_at);
      CREATE INDEX IF NOT EXISTS events_time ON events(received_at);
      CREATE INDEX IF NOT EXISTS events_trace ON events(trace_id);
      CREATE TABLE IF NOT EXISTS ingest_quota (user_id TEXT PRIMARY KEY, minute INTEGER NOT NULL, count INTEGER NOT NULL);`);
    // Client-controlled IDs cannot reserve the identity of an authoritative server event.
    this.db.exec(
      "UPDATE OR IGNORE events SET event_id=source||':'||event_id WHERE instr(event_id,':')=0; DELETE FROM events WHERE instr(event_id,':')=0;",
    );
  }
  insert(
    userID: string | null,
    events: TelemetryEvent[],
    source: "client" | "server",
    now = Date.now(),
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (source === "client" && userID) {
        const minute = Math.floor(now / 60000);
        this.db
          .prepare(
            `INSERT INTO ingest_quota VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET minute=excluded.minute,count=CASE WHEN minute=excluded.minute THEN count+excluded.count ELSE excluded.count END`,
          )
          .run(userID, minute, events.length);
        const quota = this.db
          .prepare("SELECT count FROM ingest_quota WHERE user_id=?")
          .get(userID) as { count: number };
        if (quota.count > 3000) {
          this.db.exec("ROLLBACK");
          return false;
        }
      }
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO events(user_id,event_id,received_at,timestamp,name,platform,level,trace_id,source,payload) VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      for (const event of events)
        insert.run(
          userID,
          source + ":" + event.id,
          new Date(now).toISOString(),
          event.timestamp,
          event.name,
          event.platform,
          event.level,
          event.trace_id,
          source,
          JSON.stringify(event),
        );
      const prune = now - this.prunedAt > 60000;
      if (prune) {
        this.db
          .prepare("DELETE FROM events WHERE received_at<?")
          .run(
            new Date(now - catalog.limits.serverDays * 86400000).toISOString(),
          );
        this.db
          .prepare("DELETE FROM ingest_quota WHERE minute<?")
          .run(Math.floor(now / 60000) - 1);
      }
      this.db
        .prepare(
          "DELETE FROM events WHERE seq <= COALESCE((SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?),0)",
        )
        .run(this.maximum);
      this.db.exec("COMMIT");
      if (prune) this.prunedAt = now;
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  events(options: {
    userID?: string;
    after?: number;
    limit?: number;
    traceID?: string;
    name?: string;
    level?: string;
    since?: string;
  }) {
    const filters = ["seq>?", "received_at>=?"];
    const values: (string | number)[] = [
      options.after || 0,
      options.since ||
        new Date(
          Date.now() - catalog.limits.serverDays * 86400000,
        ).toISOString(),
    ];
    for (const [column, value] of [
      ["user_id", options.userID],
      ["trace_id", options.traceID],
      ["name", options.name],
      ["level", options.level],
    ] as const)
      if (value) {
        filters.push(`${column}=?`);
        values.push(value);
      }
    const rows = this.db
      .prepare(
        `SELECT seq,user_id,received_at,source,payload FROM events WHERE ${filters.join(" AND ")} ORDER BY seq LIMIT ?`,
      )
      .all(...values, Math.min(500, Math.max(1, options.limit || 100))) as {
      seq: number;
      user_id: string | null;
      received_at: string;
      source: string;
      payload: string;
    }[];
    return rows.map((row) => ({
      cursor: row.seq,
      actor_id: row.user_id
        ? createHash("sha256").update(row.user_id).digest("hex")
        : null,
      received_at: row.received_at,
      source: row.source,
      event: JSON.parse(row.payload) as TelemetryEvent,
    }));
  }
  summary(userID?: string, days = 7) {
    const since = new Date(
      Date.now() -
        Math.min(catalog.limits.serverDays, Math.max(1, days)) * 86400000,
    ).toISOString();
    const where = `received_at>=?${userID ? " AND user_id=?" : ""}`;
    const values = userID ? [since, userID] : [since];
    const active = `source='client' AND json_extract(payload,'$.category')='product'`;
    const totals = this.db
      .prepare(
        `SELECT count(*) AS events,count(DISTINCT CASE WHEN ${active} THEN user_id END) AS active_users,count(DISTINCT CASE WHEN ${active} THEN json_extract(payload,'$.session_id') END) AS sessions,COALESCE(sum(level='error'),0) AS errors FROM events WHERE ${where}`,
      )
      .get(...values);
    const product = this.db
      .prepare(
        `SELECT name,platform,source,count(*) AS count,count(DISTINCT user_id) AS users FROM events WHERE ${where} AND json_extract(payload,'$.category')='product' GROUP BY name,platform,source ORDER BY count DESC`,
      )
      .all(...values);
    const daily = this.db
      .prepare(
        `SELECT substr(timestamp,1,10) AS day,count(DISTINCT user_id) AS active_users,count(*) AS events FROM events WHERE ${where} AND ${active} GROUP BY day ORDER BY day`,
      )
      .all(...values);
    const apiCondition =
      "source='server' AND name IN ('http.completed','http.failed') AND json_extract(payload,'$.properties.route') NOT IN ('health','telemetry')";
    const requests = this.db
      .prepare(
        `SELECT count(*) AS count,sum(CASE WHEN json_extract(payload,'$.properties.status')>=500 THEN 1 ELSE 0 END) AS server_errors,avg(json_extract(payload,'$.properties.duration_ms')) AS average_ms FROM events WHERE ${where} AND ${apiCondition}`,
      )
      .get(...values) as {
      count: number;
      server_errors: number | null;
      average_ms: number | null;
    };
    const recent = this.db
      .prepare(
        `SELECT count(*) AS count,sum(CASE WHEN json_extract(payload,'$.properties.status')>=500 THEN 1 ELSE 0 END) AS errors FROM events WHERE ${where} AND received_at>=? AND ${apiCondition}`,
      )
      .get(...values, new Date(Date.now() - 15 * 60000).toISOString()) as {
      count: number;
      errors: number | null;
    };
    const errors = this.db
      .prepare(
        `SELECT name,platform,json_extract(payload,'$.release') AS release,json_extract(payload,'$.properties.error_code') AS error_code,count(*) AS count,max(received_at) AS last_seen FROM events WHERE ${where} AND level='error' GROUP BY name,platform,release,error_code ORDER BY count DESC LIMIT 30`,
      )
      .all(...values);
    const commits = this.db
      .prepare(
        `SELECT json_extract(payload,'$.properties.operation') AS operation,count(*) AS count FROM events WHERE ${where} AND source='server' AND name='note.committed' GROUP BY operation`,
      )
      .all(...values);
    const recentErrors = Number(recent.errors || 0);
    const syncs = this.db
      .prepare(
        `SELECT count(*) AS count,COALESCE(sum(name='sync.failed'),0) AS failures FROM events WHERE ${where} AND received_at>=? AND name IN ('sync.completed','sync.failed')`,
      )
      .get(...values, new Date(Date.now() - 15 * 60000).toISOString()) as {
      count: number;
      failures: number;
    };
    const latencyRows = this.db
      .prepare(
        `SELECT ms FROM (SELECT json_extract(payload,'$.properties.duration_ms') AS ms FROM events WHERE ${where} AND received_at>=? AND ${apiCondition} ORDER BY seq DESC LIMIT 10000) ORDER BY ms`,
      )
      .all(...values, new Date(Date.now() - 15 * 60000).toISOString()) as {
      ms: number;
    }[];
    const p95 = latencyRows.length
      ? latencyRows[Math.max(0, Math.ceil(latencyRows.length * 0.95) - 1)].ms
      : null;
    const rejected = this.db
      .prepare(
        `SELECT count(*) AS count FROM events WHERE ${where} AND received_at>=? AND name='telemetry.rejected'`,
      )
      .get(...values, new Date(Date.now() - 15 * 60000).toISOString()) as {
      count: number;
    };
    return {
      since,
      totals,
      daily,
      product,
      note_commits: commits,
      requests,
      errors,
      monitors: [
        {
          name: "api_error_rate",
          window_minutes: 15,
          samples: recent.count,
          failures: recentErrors,
          status:
            recent.count < 10
              ? "insufficient_data"
              : recentErrors / recent.count >= 0.05
                ? "alert"
                : "ok",
        },
        {
          name: "telemetry_storage",
          failures: writeFailures,
          status: writeUnavailable ? "alert" : "ok",
        },
        {
          name: "api_latency",
          window_minutes: 15,
          samples: latencyRows.length,
          p95_ms: p95,
          threshold_ms: 2000,
          status:
            latencyRows.length < 10
              ? "insufficient_data"
              : p95! >= 2000
                ? "alert"
                : "ok",
        },
        {
          name: "sync_failure_rate",
          window_minutes: 15,
          samples: syncs.count,
          failures: syncs.failures,
          status:
            syncs.count < 5
              ? "insufficient_data"
              : syncs.failures / syncs.count >= 0.2
                ? "alert"
                : "ok",
        },
        {
          name: "telemetry_ingest",
          window_minutes: 15,
          rejected_batches: rejected.count,
          status: rejected.count ? "alert" : "ok",
        },
      ],
      time_basis: { window: "received_at", daily: "client_timestamp" },
      limits: catalog.limits,
    };
  }
  close() {
    this.db.close();
  }
}
const globals = globalThis as typeof globalThis & {
  doompileTelemetry?: Map<string, TelemetryStore>;
};
export function telemetryStore(): TelemetryStore {
  const directory = dataDirectory();
  const stores = (globals.doompileTelemetry ??= new Map());
  if (!stores.has(directory))
    stores.set(directory, new TelemetryStore(directory));
  return stores.get(directory)!;
}
export function observedUser(userID: string) {
  const current = context.getStore();
  if (current) current.userID = userID;
}
export function serverEvent(
  name: EventName,
  properties: Record<string, unknown> = {},
  deterministicID?: string,
) {
  try {
    const current = context.getStore();
    const digest = deterministicID
      ? createHash("sha256").update(deterministicID).digest("hex")
      : undefined;
    const id = digest
      ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`
      : randomUUID();
    const event = validateEvent({
      ...(current?.trace || newTrace()),
      schema_version: catalog.version,
      id,
      timestamp: new Date().toISOString(),
      name,
      properties,
      platform: "server",
      device_id: deviceID,
      session_id: sessionID,
      release:
        process.env.DOOMPILE_RELEASE ||
        process.env.DOOMPILE_BUILD_COMMIT ||
        "0.1.0",
      environment:
        process.env.NODE_ENV === "production"
          ? "production"
          : process.env.NODE_ENV === "test"
            ? "test"
            : "development",
    });
    if (event) {
      telemetryStore().insert(current?.userID || null, [event], "server");
      writeUnavailable = false;
    }
  } catch {
    writeFailures++;
    writeUnavailable = true;
  }
}
export function observeRequest<T extends Response | Promise<Response>>(
  request: Request,
  work: () => T,
): T {
  const telemetryRequest = new URL(request.url).pathname === "/api/telemetry";
  const trace = newTrace(parseTraceparent(request.headers.get("traceparent")));
  const started = performance.now();
  return context.run({ trace, userID: null }, () => {
    const finish = (response: Response) => {
      if (!telemetryRequest)
        serverEvent(response.status >= 500 ? "http.failed" : "http.completed", {
          route: routeName(request.url),
          method: request.method,
          status: response.status,
          duration_ms: performance.now() - started,
        });
      try {
        response.headers.set("traceparent", traceparent(trace));
      } catch {
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
        response.headers.set("traceparent", traceparent(trace));
      }
      return response;
    };
    const fail = (error: unknown): never => {
      serverEvent("http.failed", {
        route: routeName(request.url),
        method: request.method,
        status: 500,
        duration_ms: performance.now() - started,
        ...errorProperties(error),
      });
      throw error;
    };
    try {
      const result = work();
      return (
        result instanceof Promise ? result.then(finish, fail) : finish(result)
      ) as T;
    } catch (error) {
      return fail(error);
    }
  });
}
export function observedRoute<
  Args extends unknown[],
  Result extends Response | Promise<Response>,
>(handler: (request: Request, ...args: Args) => Result) {
  return (request: Request, ...args: Args): Result =>
    observeRequest(request, () => {
      try {
        const auth = principal(request);
        if (auth) observedUser(auth.user.id);
      } catch {
        /* Readiness/auth handlers own their failure response. */
      }
      return handler(request, ...args);
    });
}
