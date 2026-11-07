import { identities, hash } from "./identity";
import { testAccount, testEnvironment } from "./test-accounts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNote } from "@doompile/core";
import { NoteStore, store as currentStore } from "./store";
import { authorized, corsHeaders, sameOrigin, sessionCookie } from "./auth";
import { readLimitedBody } from "./http";
import { parseByteRange } from "./range";
import { PUT as putNote } from "../../app/api/notes/[id]/route";
import { GET as getNotes } from "../../app/api/notes/route";
import { POST as uploadAttachment } from "../../app/api/attachments/route";
import { GET as downloadAttachment } from "../../app/api/attachments/[id]/route";

const originalStorage = process.env.DOOMPILE_STORAGE;
const originalToken = process.env.DOOMPILE_API_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalDataDirectory = process.env.DOOMPILE_DATA_DIR;
afterEach(() => {
  if (originalStorage === undefined) delete process.env.DOOMPILE_STORAGE; else process.env.DOOMPILE_STORAGE = originalStorage;
  if (originalToken === undefined) delete process.env.DOOMPILE_API_TOKEN;
  else process.env.DOOMPILE_API_TOKEN = originalToken;
  if (originalNodeEnv === undefined)
    Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  if (originalDataDirectory === undefined) delete process.env.DOOMPILE_DATA_DIR;
  else process.env.DOOMPILE_DATA_DIR = originalDataDirectory;
});
function withStore(run: (store: NoteStore) => void) {
  const directory = mkdtempSync(join(tmpdir(), "doompile-test-"));
  const store = new NoteStore(directory);
  try {
    run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
}

test("SQLite saves, retries idempotently, rejects stale edits and persists tombstones", () =>
  withStore((store) => {
    const note = createNote({ plainText: "First thought" });
    const first = store.save(note, 0);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.note.revision, 1);
    const retry = store.save(note, 0);
    assert.deepEqual(retry, first);
    const edited = {
      ...first.note,
      plainText: "Changed on first device",
      updatedAt: "2026-10-29T20:00:00.000Z",
    };
    const second = store.save(edited, 1);
    assert.equal(second.ok, true);
    const stale = store.save(
      { ...first.note, plainText: "Changed on second device" },
      1,
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.current?.plainText, edited.plainText);
    if (!second.ok) return;
    const tombstone = store.save(
      { ...second.note, deletedAt: "2026-10-29T20:01:00.000Z" },
      2,
    );
    assert.equal(tombstone.ok, true);
    assert.equal(store.list()[0].deletedAt, "2026-10-29T20:01:00.000Z");
  }));

test("createdAt remains immutable across edits and uploaded metadata round-trips", () =>
  withStore((store) => {
    const first = store.save(createNote(), 0);
    if (!first.ok) assert.fail();
    const second = store.save(
      {
        ...first.note,
        createdAt: "2000-01-01T00:00:00.000Z",
        plainText: "Update",
      },
      1,
    );
    if (!second.ok) assert.fail();
    assert.equal(second.note.createdAt, first.note.createdAt);
    const id = crypto.randomUUID();
    const attachment = {
      id,
      name: "photo.png",
      mimeType: "image/png",
      size: 42,
      url: `/api/attachments/${id}`,
    };
    store.putAttachment(attachment);
    assert.deepEqual(store.getAttachment(id), attachment);
    assert.equal(store.getAttachment("../escape"), null);
  }));

test("production fails closed; personal bearer and revocable opaque cookie authenticate", () => {
  const fixture = testEnvironment();
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    process.env.DOOMPILE_API_TOKEN = "legacy-global-key";
    assert.equal(authorized(new Request("https://notes.example.com/api/notes")), false);
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { headers: { Authorization: "Bearer legacy-global-key" } })), false);
    const account = fixture.account();
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { headers: { Authorization: `Bearer ${account.token}` } })), true);
    const session = identities().issue(account.user.id, "web");
    const cookie = sessionCookie(session.token, true).split(";")[0];
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { headers: { cookie } })), true);
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { method: "PUT", headers: { cookie, Origin: "https://evil.example" } })), false);
    const expired = identities().issue(account.user.id, "web", "expired", Date.now() - 31 * 86_400_000);
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { headers: { cookie: sessionCookie(expired.token, true).split(";")[0] } })), false);
    identities().revoke(hash(session.token));
    assert.equal(authorized(new Request("https://notes.example.com/api/notes", { headers: { cookie } })), false);
  } finally { fixture.cleanup(); }
});

test("CORS permits extension bearer requests without granting cross-origin cookies", () => {
  const headers = corsHeaders(
    new Request("https://notes.example.com/api/notes", {
      headers: { Origin: "chrome-extension://abcdef" },
    }),
  );
  assert.equal(
    headers.get("Access-Control-Allow-Origin"),
    "chrome-extension://abcdef",
  );
  assert.equal(headers.has("Access-Control-Allow-Credentials"), false);
  assert.equal(
    corsHeaders(
      new Request("https://notes.example.com/api/notes", {
        headers: { Origin: "https://evil.example" },
      }),
    ).has("Access-Control-Allow-Origin"),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("https://notes.example.com/api/notes", {
        headers: { Origin: "https://notes.example.com" },
      }),
    ),
    true,
  );
});

test("body limits apply even without Content-Length", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("too much"));
      controller.close();
    },
  });
  await assert.rejects(
    readLimitedBody(
      new Request("https://notes.example.com/api/notes", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
      4,
    ),
    /too large/,
  );
});

test("byte ranges support closed, open, suffix and clipped ends without overflow", () => {
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=2-100", 10), { start: 2, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-100", 10), { start: 0, end: 9 });
  for (const header of [
    "bytes=10-",
    "bytes=8-2",
    "bytes=-0",
    "bytes=-",
    "bytes=9007199254740999-",
  ])
    assert.equal(parseByteRange(header, 10), false);
  assert.equal(parseByteRange("bytes=0-", 0), false);
  assert.equal(parseByteRange("unknown=0-1", 10), null);
  assert.equal(parseByteRange("bytes=0-1,4-5", 10), null);
});

test("API handlers enforce auth, revisions, validation, bounded file storage and safe downloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "doompile-api-test-"));
  process.env.DOOMPILE_DATA_DIR = directory;
  process.env.DOOMPILE_STORAGE = "filesystem";
  const account = testAccount();
  const headers = {
    Authorization: `Bearer ${account.token}`,
    "Content-Type": "application/json",
  };
  const note = createNote({
    plainText: "Captured quote",
    tags: ["work", "reading"],
  });
  const url = `https://notes.example.com/api/notes/${note.id}`;
  const context = { params: Promise.resolve({ id: note.id }) };
  try {
    assert.equal(
      (await getNotes(new Request("https://notes.example.com/api/notes")))
        .status,
      401,
    );
    const first = await putNote(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ note, baseRevision: 0 }),
      }),
      context,
    );
    assert.equal(first.status, 200);
    const { note: saved } = await first.json();
    assert.equal(saved.revision, 1);
    const stale = await putNote(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          note: { ...note, plainText: "A stale edit" },
          baseRevision: 0,
        }),
      }),
      context,
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).current.plainText, "Captured quote");
    const invalid = await putNote(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          note: { ...note, source: { url: "javascript:alert(1)" } },
          baseRevision: 1,
        }),
      }),
      context,
    );
    assert.equal(invalid.status, 400);
    const listed = await getNotes(
      new Request("https://notes.example.com/api/notes", { headers }),
    );
    assert.equal((await listed.json()).notes.length, 1);

    const form = new FormData();
    form.append(
      "file",
      new File(["<script>unsafe()</script>"], "../private.html", {
        type: "text/html",
      }),
    );
    const uploaded = await uploadAttachment(
      new Request("https://notes.example.com/api/attachments", {
        method: "POST",
        headers: { Authorization: headers.Authorization },
        body: form,
      }),
    );
    assert.equal(uploaded.status, 201);
    const { attachment } = await uploaded.json();
    assert.match(attachment.id, /^[0-9a-f-]{36}$/);
    const download = await downloadAttachment(
      new Request(`https://notes.example.com${attachment.url}`, { headers }),
      { params: Promise.resolve({ id: attachment.id }) },
    );
    assert.equal(download.status, 200);
    assert.match(download.headers.get("Content-Disposition")!, /^attachment;/);
    assert.equal(await download.text(), "<script>unsafe()</script>");
    const media = new FormData();
    media.append(
      "file",
      new File(["0123456789"], "voice.m4a", { type: "audio/mp4" }),
    );
    const mediaResponse = await uploadAttachment(
      new Request("https://notes.example.com/api/attachments", {
        method: "POST",
        headers: { Authorization: headers.Authorization },
        body: media,
      }),
    );
    const { attachment: audio } = await mediaResponse.json();
    const audioContext = { params: Promise.resolve({ id: audio.id }) };
    const audioURL = `https://notes.example.com${audio.url}`;
    for (const [range, expected, contentRange] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
    ]) {
      const response = await downloadAttachment(
        new Request(audioURL, { headers: { ...headers, Range: range } }),
        audioContext,
      );
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("Content-Range"), contentRange);
      assert.equal(
        response.headers.get("Content-Length"),
        String(expected.length),
      );
      assert.equal(response.headers.get("Accept-Ranges"), "bytes");
      assert.match(response.headers.get("Content-Disposition")!, /^inline;/);
      assert.equal(await response.text(), expected);
    }
    const unsatisfiable = await downloadAttachment(
      new Request(audioURL, { headers: { ...headers, Range: "bytes=20-" } }),
      audioContext,
    );
    assert.equal(unsatisfiable.status, 416);
    assert.equal(unsatisfiable.headers.get("Content-Range"), "bytes */10");
    const changed = await downloadAttachment(
      new Request(audioURL, {
        headers: {
          ...headers,
          Range: "bytes=2-3",
          "If-Range": '"different-etag"',
        },
      }),
      audioContext,
    );
    assert.equal(changed.status, 200);
    assert.equal(await changed.text(), "0123456789");
    const unauthorized = await downloadAttachment(
      new Request(audioURL, { headers: { Range: "bytes=2-3" } }),
      audioContext,
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.has("Content-Range"), false);
    const missing = await downloadAttachment(
      new Request(audioURL, { headers: { ...headers, Range: "bytes=2-3" } }),
      { params: Promise.resolve({ id: crypto.randomUUID() }) },
    );
    assert.equal(missing.status, 404);
    const traversal = await downloadAttachment(
      new Request("https://notes.example.com/api/attachments/invalid", {
        headers,
      }),
      { params: Promise.resolve({ id: "../../etc/passwd" }) },
    );
    assert.equal(traversal.status, 404);
  } finally {
    currentStore(account.user.id).close(); identities().close();
    rmSync(directory, { recursive: true });
  }
});

test("streams binary uploads larger than the former 30 MiB cap and removes incomplete uploads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "doompile-large-upload-"));
  process.env.DOOMPILE_DATA_DIR = directory;
  process.env.DOOMPILE_STORAGE = "filesystem";
  const account = testAccount();
  const boundary = "doompile-test-boundary";
  const encoder = new TextEncoder();
  const size = 33 * 1024 * 1024 + 19;
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="архив.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  let remaining = size;
  let started = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(head);
        return;
      }
      if (remaining) {
        const count = Math.min(remaining, 65536);
        remaining -= count;
        controller.enqueue(new Uint8Array(count).fill(173));
        return;
      }
      controller.enqueue(tail);
      controller.close();
    },
  });
  try {
    const request = new Request("https://notes.example.com/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await uploadAttachment(request);
    assert.equal(response.status, 201);
    const { attachment } = await response.json();
    assert.equal(attachment.size, size);
    assert.equal(attachment.name, "архив.bin");
    const { stat, readFile, readdir } = await import("node:fs/promises");
    assert.equal(
      (await stat(join(directory, "users", account.user.id, "objects", currentStore(account.user.id).attachmentKey(attachment.id)!))).size,
      size,
    );
    const malformed = new Request("https://notes.example.com/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: head,
    });
    assert.equal((await uploadAttachment(malformed)).status, 400);
    assert.deepEqual(await readdir(join(directory, "users", account.user.id, "uploads")), []);
    const downloaded = await downloadAttachment(
      new Request(`https://notes.example.com${attachment.url}`, {
        headers: {
          Authorization: `Bearer ${account.token}`,
          Range: "bytes=-19",
        },
      }),
      { params: Promise.resolve({ id: attachment.id }) },
    );
    assert.equal(downloaded.status, 206);
    assert.deepEqual(
      new Uint8Array(await downloaded.arrayBuffer()),
      new Uint8Array(19).fill(173),
    );
  } finally {
    currentStore(account.user.id).close(); identities().close();
    rmSync(directory, { recursive: true, force: true });
  }
});
