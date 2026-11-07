import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEnvironment } from "./test-accounts";
import { TelemetryStore, telemetryStore, observeRequest } from "./telemetry";
import {
  Recorder,
  BoundedJournal,
  newTrace,
  traceparent,
  parseTraceparent,
  type JournalState,
} from "../../../../packages/telemetry/core";
import { createNote } from "@doompile/core";
import { POST, GET } from "../../app/api/telemetry/route";
import { PUT } from "../../app/api/notes/[id]/route";
const base = "https://notes.example.test";
function event() {
  let state: JournalState | null = null;
  const recorder = new Recorder(
    new BoundedJournal({
      read: async () => state,
      write: async (value) => {
        state = value;
      },
    }),
    {
      platform: "ios",
      deviceID: crypto.randomUUID(),
      environment: "test",
      release: "test.1",
    },
  );
  return recorder.record("note.saved", { operation: "create", kind: "note" })!;
}
function request(
  path: string,
  token: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("telemetry is authenticated, isolated per account, deduplicated and scrubbed on ingestion", async () => {
  const fixture = testEnvironment();
  const first = fixture.account("first"),
    second = fixture.account("second");
  const previousAdmin = process.env.DOOMPILE_ADMIN_EMAIL;
  try {
    assert.equal(
      (
        await POST(
          new Request(base + "/api/telemetry", { method: "POST", body: "{}" }),
        )
      ).status,
      401,
    );
    const value = {
      ...event(),
      user_id: second.user.id,
      properties: {
        operation: "create",
        kind: "note",
        token: "never-store",
        plainText: "private note",
      },
    };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await POST(
            request("/api/telemetry", first.token, { events: [value] }),
          )
        ).status,
        200,
      );
    assert.equal(
      (await POST(request("/api/telemetry", second.token, { events: [value] })))
        .status,
      200,
    );
    const own = await (
      await GET(request("/api/telemetry", first.token))
    ).json();
    assert.equal(own.events.length, 1);
    assert.equal(own.events[0].event.id, value.id);
    assert.ok(!JSON.stringify(own).includes("never-store"));
    assert.ok(!JSON.stringify(own).includes("private note"));
    assert.ok(!JSON.stringify(own).includes(second.user.id));
    assert.equal(
      (await GET(request("/api/telemetry?scope=all", first.token))).status,
      403,
    );
    process.env.DOOMPILE_ADMIN_EMAIL = first.user.email;
    assert.equal(
      (
        await (
          await GET(request("/api/telemetry?scope=all", first.token))
        ).json()
      ).events.length,
      2,
    );
    const summary = await (
      await GET(request("/api/telemetry?view=summary&scope=all", first.token))
    ).json();
    assert.equal(summary.totals.active_users, 2);
    assert.equal(summary.monitors[0].status, "insufficient_data");
    const cursor = own.next_cursor;
    assert.equal(
      (
        await (
          await GET(request(`/api/telemetry?after=${cursor}`, first.token))
        ).json()
      ).events.length,
      0,
    );
  } finally {
    if (previousAdmin === undefined) delete process.env.DOOMPILE_ADMIN_EMAIL;
    else process.env.DOOMPILE_ADMIN_EMAIL = previousAdmin;
    telemetryStore().close();
    fixture.cleanup();
  }
});
test("collector rejects forged authoritative events malformed data and oversized batches", async () => {
  const fixture = testEnvironment(),
    account = fixture.account();
  try {
    for (const events of [
      [{ ...event(), platform: "server" }],
      [{ ...event(), name: "note.committed" }],
      [{ ...event(), trace_id: "0".repeat(32) }],
      [{ ...event(), schema_version: 999 }],
      Array.from({ length: 51 }, event),
    ])
      assert.equal(
        (await POST(request("/api/telemetry", account.token, { events })))
          .status,
        400,
      );
    assert.equal(
      (
        await POST(
          request("/api/telemetry", account.token, {
            padding: "x".repeat(131073),
          }),
        )
      ).status,
      413,
    );
    assert.equal(
      (await GET(request("/api/telemetry?after=-1", account.token))).status,
      400,
    );
    assert.equal(
      (
        await GET(
          request("/api/telemetry?view=summary&days=NaN", account.token),
        )
      ).status,
      400,
    );
  } finally {
    fixture.cleanup();
  }
});
test("client and server trace correlate; a lost-response retry does not inflate product commits", async () => {
  const fixture = testEnvironment(),
    account = fixture.account();
  try {
    const note = createNote({ plainText: "private content" }),
      trace = newTrace();
    const put = () =>
      PUT(
        new Request(base + "/api/notes/" + note.id, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${account.token}`,
            "Content-Type": "application/json",
            traceparent: traceparent(trace),
          },
          body: JSON.stringify({ note, baseRevision: 0 }),
        }),
        { params: Promise.resolve({ id: note.id }) },
      );
    const response = await put();
    assert.equal(response.status, 200);
    const propagated = parseTraceparent(response.headers.get("traceparent"))!;
    assert.equal(propagated.trace_id, trace.trace_id);
    assert.notEqual(propagated.span_id, trace.span_id);
    assert.equal((await put()).status, 200);
    const events = telemetryStore().events({
      userID: account.user.id,
      traceID: trace.trace_id,
    });
    assert.equal(
      events.filter((row) => row.event.name === "note.committed").length,
      1,
    );
    assert.equal(
      events.filter((row) => row.event.name === "http.completed").length,
      2,
    );
    assert.equal(events[0].event.parent_span_id, trace.span_id);
    assert.ok(!JSON.stringify(events).includes("private content"));
  } finally {
    telemetryStore().close();
    fixture.cleanup();
  }
});
test("server retention count bounds and ingest quota are durable", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "doompile-telemetry-retention-"),
  );
  const store = new TelemetryStore(directory, 3),
    user = crypto.randomUUID();
  try {
    const old = event();
    store.insert(user, [old], "client", Date.now() - 31 * 86400000);
    for (let i = 0; i < 4; i++) store.insert(user, [event()], "client");
    const rows = store.events({ userID: user, since: "2000-01-01" });
    assert.equal(rows.length, 3);
    assert.ok(!rows.some((row) => row.event.id === old.id));
    assert.equal(
      store.insert(user, Array.from({ length: 3001 }, event), "client"),
      false,
    );
    assert.equal(store.events({ userID: user }).length, 3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("a client ID cannot suppress an authoritative server event", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "doompile-telemetry-authority-"),
  );
  const store = new TelemetryStore(directory),
    user = crypto.randomUUID();
  try {
    const value = event();
    store.insert(user, [value], "client");
    store.insert(
      user,
      [{ ...value, platform: "server", name: "note.committed" }],
      "server",
    );
    assert.equal(store.events({ userID: user }).length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("a diagnostics disk failure does not change the host response", async () => {
  const directory = mkdtempSync(
      join(tmpdir(), "doompile-telemetry-unavailable-"),
    ),
    previous = process.env.DOOMPILE_DATA_DIR;
  const file = join(directory, "blocked");
  writeFileSync(file, "not a directory");
  try {
    process.env.DOOMPILE_DATA_DIR = file;
    const response = await observeRequest(
      new Request(base + "/api/notes"),
      async () => Response.json({ ok: true }),
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("traceparent"));
    const redirect = await observeRequest(
      new Request(base + "/api/auth/google"),
      async () => Response.redirect(base, 303),
    );
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("location"), base + "/");
  } finally {
    if (previous === undefined) delete process.env.DOOMPILE_DATA_DIR;
    else process.env.DOOMPILE_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
