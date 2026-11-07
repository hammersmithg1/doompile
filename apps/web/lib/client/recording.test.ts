import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RecordingSession,
  type RecordingDraft,
  type RecordingStorage,
} from "./recording";
class FakeRecorder {
  static latest: FakeRecorder;
  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor() {
    FakeRecorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  requestData() {
    this.flush("checkpoint");
  }
  flush(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = "inactive";
    this.flush("-final");
    this.onstop?.();
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup() {
  let saved: RecordingDraft | undefined;
  let removed = false;
  let fail = false;
  let stops = 0;
  const disk: RecordingStorage = {
    async read() {
      return saved;
    },
    async write(value) {
      if (fail) throw Error("Disk full");
      saved = value;
    },
    async remove() {
      removed = true;
      saved = undefined;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks: () => [
              {
                stop() {
                  stops++;
                },
              },
            ],
          };
        },
      },
    },
  });
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), { MediaRecorder: FakeRecorder }),
    MediaRecorder: FakeRecorder,
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  });
  return {
    session: new RecordingSession(disk),
    disk,
    get saved() {
      return saved;
    },
    get removed() {
      return removed;
    },
    get stops() {
      return stops;
    },
    set fail(value: boolean) {
      fail = value;
    },
  };
}
test("recording checkpoints bytes before stopping, independently of a mounted view", async () => {
  const fixture = setup();
  await fixture.session.start("quick");
  FakeRecorder.latest.flush("first");
  await tick();
  assert.equal(await fixture.saved?.blob.text(), "first");
  assert.equal(fixture.session.getSnapshot().status, "recording");
  fixture.session.stop();
  await tick();
  assert.equal(await fixture.saved?.blob.text(), "first-final");
  assert.equal(fixture.session.getSnapshot().status, "ready");
  assert.equal(fixture.stops, 1);
});
test("expansion transfers the recording target while preserving all chunks", async () => {
  const fixture = setup();
  await fixture.session.start();
  FakeRecorder.latest.flush("before-");
  fixture.session.moveTo("note-id");
  FakeRecorder.latest.flush("after");
  fixture.session.stop();
  await tick();
  assert.equal(fixture.saved?.target, "note-id");
  assert.equal(await fixture.saved?.blob.text(), "before-after-final");
});
test("reload recovers the last checkpoint; a failed delivery retains it for retry", async () => {
  const fixture = setup();
  await fixture.session.start("note-id");
  FakeRecorder.latest.flush("audio");
  await tick();
  const recovered = new RecordingSession(fixture.disk);
  await recovered.restore();
  assert.equal(recovered.getSnapshot().recovered, true);
  assert.equal(recovered.getSnapshot().status, "ready");
  await recovered.deliver(async () => {
    throw Error("Offline");
  });
  assert.equal(fixture.removed, false);
  assert.equal(recovered.getSnapshot().error, "Offline");
  let bytes = "";
  await recovered.deliver(async (draft) => {
    bytes = await draft.blob.text();
  });
  assert.equal(bytes, "audio");
  assert.equal(fixture.removed, true);
  assert.equal(recovered.getSnapshot().status, "idle");
  fixture.session.stop();
  await tick();
});
test("storage failure stops capture promptly and retains its final bytes for retry", async () => {
  const fixture = setup();
  fixture.fail = true;
  await fixture.session.start();
  await tick();
  assert.equal(fixture.session.getSnapshot().status, "ready");
  assert.match(fixture.session.getSnapshot().error, /контрольную копию/);
  assert.equal(
    await fixture.session.getSnapshot().draft?.blob.text(),
    "-final",
  );
  assert.equal(fixture.stops, 1);
});
test("failed checkpoints remain retryable without losing the buffered recording", async () => {
  const fixture = setup();
  await fixture.session.start();
  fixture.fail = true;
  FakeRecorder.latest.flush("buffered");
  fixture.session.stop();
  await tick();
  assert.equal(fixture.session.getSnapshot().status, "ready");
  fixture.fail = false;
  fixture.session.retry();
  await tick();
  assert.equal(await fixture.saved?.blob.text(), "buffered-final");
  await fixture.session.deliver(async () => {});
  assert.equal(fixture.removed, true);
});

test("a slow checkpoint never delays the start of audio capture; finish waits for final bytes", async () => {
  const fixture = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = fixture.disk.write;
  fixture.disk.write = async (value) => {
    await gate;
    await write(value);
  };
  await fixture.session.start("note-id");
  assert.equal(FakeRecorder.latest.state, "recording");
  FakeRecorder.latest.flush("first syllable");
  let finished = false;
  const final = fixture.session.finish("note-id").then(() => {
    finished = true;
  });
  await tick();
  assert.equal(fixture.stops, 1);
  assert.equal(finished, false);
  release();
  await final;
  assert.equal(await fixture.saved?.blob.text(), "first syllable-final");
  assert.equal(fixture.session.getSnapshot().status, "ready");
});

test("cancelling a pending microphone request releases a late stream without starting capture", async () => {
  const fixture = setup();
  const previous = FakeRecorder.latest;
  let acquire!: (stream: any) => void;
  let stopped = false,
    requested = false;
  navigator.mediaDevices.getUserMedia = () => {
    requested = true;
    return new Promise((resolve) => {
      acquire = resolve;
    });
  };
  const starting = fixture.session.start();
  assert.equal(requested, true);
  assert.equal(fixture.session.getSnapshot().status, "starting");
  await fixture.session.finish("quick");
  acquire({
    getTracks: () => [
      {
        stop: () => {
          stopped = true;
        },
      },
    ],
  });
  await starting;
  assert.equal(stopped, true);
  assert.equal(FakeRecorder.latest, previous);
  assert.equal(fixture.session.getSnapshot().status, "idle");
  assert.equal(fixture.session.getSnapshot().draft, null);
});

test("close and automatic stop share one delivery and leave no draft after saving", async () => {
  const fixture = setup();
  await fixture.session.start("quick");
  FakeRecorder.latest.flush("voice");
  fixture.session.moveTo("note-id");
  await fixture.session.finish("note-id");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saves = 0;
  const first = fixture.session.deliver(async (draft) => {
    saves++;
    assert.equal(draft.target, "note-id");
    assert.equal(await draft.blob.text(), "voice-final");
    await gate;
  });
  const closing = fixture.session.deliver(async () => {
    throw Error("Duplicate delivery");
  });
  assert.equal(first, closing);
  await tick();
  assert.equal(saves, 1);
  release();
  await closing;
  assert.equal(fixture.session.getSnapshot().status, "idle");
  assert.equal(fixture.session.getSnapshot().draft, null);
  assert.equal(fixture.session.getSnapshot().url, "");
  assert.equal(fixture.removed, true);
});
