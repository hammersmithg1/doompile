import { test } from "node:test";
import assert from "node:assert/strict";
import fixtures from "../test-fixtures/telemetry.json";
import {
  Recorder,
  BoundedJournal,
  sanitizeProperties,
  parseTraceparent,
  newTrace,
  traceparent,
  validateEvent,
  type JournalState,
  type EventName,
} from "../../telemetry/core";
function setup(maximum = 1200) {
  let state: JournalState | null = null;
  const disk = {
    read: async () => structuredClone(state),
    write: async (next: JournalState) => {
      state = structuredClone(next);
    },
  };
  const journal = new BoundedJournal(disk, maximum);
  const recorder = new Recorder(journal, {
    platform: "web",
    deviceID: crypto.randomUUID(),
    release: "test.1",
    environment: "test",
  });
  return { recorder, journal, disk };
}
test("Swift and JavaScript share the same privacy cases", () => {
  for (const fixture of fixtures)
    assert.deepEqual(
      sanitizeProperties(fixture.event as EventName, fixture.input),
      fixture.expected,
      fixture.name,
    );
});
test("traceparent rejects zero IDs and propagates independent child spans", () => {
  const root = newTrace(),
    child = newTrace(root);
  assert.equal(child.trace_id, root.trace_id);
  assert.equal(child.parent_span_id, root.span_id);
  assert.notEqual(child.span_id, root.span_id);
  assert.deepEqual(parseTraceparent(traceparent(root)), {
    trace_id: root.trace_id,
    span_id: root.span_id,
  });
  for (const value of [
    "",
    "00-" + "0".repeat(32) + "-" + root.span_id + "-01",
    "00-" + root.trace_id + "-" + "0".repeat(16) + "-01",
    "xx-" + root.trace_id + "-" + root.span_id + "-01",
  ])
    assert.equal(parseTraceparent(value), undefined);
});
test("offline events survive recorder restart and retry keeps IDs without clearing local history", async () => {
  const { recorder, journal, disk } = setup();
  const event = recorder.record("note.saved", {
    operation: "create",
    plainText: "never include",
  })!;
  await recorder.flush(async () => false);
  assert.equal((await journal.stats()).pending, 1);
  const restarted = new Recorder(new BoundedJournal(disk), recorder.resource);
  await restarted.flush(async (events) => {
    assert.equal(events[0].id, event.id);
    return true;
  });
  assert.equal((await journal.stats()).pending, 0);
  assert.equal((await journal.read()).length, 1);
  assert.ok(!JSON.stringify(await restarted.dump()).includes("never include"));
});
test("acknowledging an in-flight batch never deletes a later event", async () => {
  const { recorder, journal } = setup();
  const first = recorder.record("app.started")!;
  await recorder.flush(async (events) => {
    assert.deepEqual(
      events.map((e) => e.id),
      [first.id],
    );
    recorder.record("note.saved", { operation: "create" });
    await recorder.settled();
    return true;
  });
  assert.equal((await journal.stats()).pending, 1);
  assert.equal((await journal.read()).length, 2);
});
test("bounded journal reports overwritten pending events; disabling sending retains local traces", async () => {
  const { recorder, journal } = setup(3);
  for (let i = 0; i < 5; i++) recorder.record("app.started");
  await recorder.settled();
  assert.deepEqual(await journal.stats(), { count: 3, pending: 3, dropped: 2 });
  await recorder.setEnabled(false);
  recorder.record("runtime.error");
  await recorder.settled();
  assert.equal((await journal.stats()).pending, 0);
  await recorder.flush(async () => {
    assert.fail("Disabled telemetry must not transmit");
  });
  assert.equal((await recorder.dump()).events.length, 3);
});
test("storage failure cannot throw from recording and an in-memory dump still diagnoses it", async () => {
  const journal = new BoundedJournal({
    read: async () => {
      throw new Error("disk blocked");
    },
    write: async () => {},
  });
  const recorder = new Recorder(journal, setup().recorder.resource);
  assert.doesNotThrow(() =>
    recorder.record("storage.failed", { error_code: "storage" }),
  );
  const dump = await recorder.dump();
  assert.equal(dump.health.persistent, false);
  assert.ok(dump.health.storage_failures > 0);
  assert.equal(dump.events[0].name, "storage.failed");
});
test("untrusted severity identity and unknown envelope properties cannot change stored telemetry", () => {
  const event = setup().recorder.record("app.started")!;
  const result = validateEvent({
    ...event,
    level: "error",
    category: "technical",
    user_id: "someone else",
    token: "secret",
    properties: { token: "secret" },
  })!;
  assert.equal(result.level, "info");
  assert.equal(result.category, "product");
  assert.equal(Object.hasOwn(result, "user_id"), false);
  assert.equal(Object.hasOwn(result, "token"), false);
  assert.equal(validateEvent({ ...event, name: "__proto__" }), null);
});
test("repeated capture acknowledgement cannot duplicate local product events", async () => {
  const { recorder, journal } = setup();
  const id = crypto.randomUUID();
  recorder.record("capture.saved", {}, newTrace(), id);
  recorder.record("capture.saved", {}, newTrace(), id);
  await recorder.settled();
  assert.equal((await journal.read()).length, 1);
  assert.equal((await journal.stats()).pending, 1);
});
