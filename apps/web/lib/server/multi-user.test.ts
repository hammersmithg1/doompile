import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote } from "@doompile/core";
import { testEnvironment } from "./test-accounts";
import { identities } from "./identity";
import { sessionCookie } from "./auth";
import { store } from "./store";
import { bucketName, objects } from "./objects";
import { GET as list } from "../../app/api/notes/route";
import { GET as get, PUT as put } from "../../app/api/notes/[id]/route";
import { POST as upload } from "../../app/api/attachments/route";
import { GET as download } from "../../app/api/attachments/[id]/route";
import { POST as device } from "../../app/api/auth/device/route";
import { POST as approve } from "../../app/api/auth/device/approve/route";
import { GET as admin } from "../../app/api/admin/users/route";
import { DELETE as logout } from "../../app/api/session/route";
const origin = "https://notes.example.test";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function browser(userId: string) {
  return {
    cookie: sessionCookie(identities().issue(userId, "web").token, true).split(
      ";",
    )[0],
    Origin: origin,
  };
}

test("two users cannot list, open, conflict with or download each other's data, even with identical IDs", async () => {
  const fixture = testEnvironment(),
    a = fixture.account("alice"),
    b = fixture.account("bob");
  try {
    const note = createNote({ plainText: "Alice private" });
    const save = (token: string, value = note, extra = {}) =>
      put(
        new Request(`${origin}/api/notes/${note.id}`, {
          method: "PUT",
          headers: { ...bearer(token), ...extra },
          body: JSON.stringify({ note: value, baseRevision: 0 }),
        }),
        context(note.id),
      );
    assert.equal((await save(a.token)).status, 200);
    assert.deepEqual(
      (
        await (
          await list(
            new Request(`${origin}/api/notes`, { headers: bearer(b.token) }),
          )
        ).json()
      ).notes,
      [],
    );
    assert.equal(
      (
        await get(
          new Request(`${origin}/api/notes/${note.id}`, {
            headers: bearer(b.token),
          }),
          context(note.id),
        )
      ).status,
      404,
    );
    assert.equal(
      (await save(b.token, { ...note, plainText: "Bob private" })).status,
      200,
    );
    assert.equal(store(a.user.id).get(note.id)?.plainText, "Alice private");
    assert.equal(store(b.user.id).get(note.id)?.plainText, "Bob private");
    assert.equal(
      (await save(b.token, note, { "X-Doompile-User-ID": a.user.id })).status,
      401,
    );
    const id = crypto.randomUUID();
    async function file(token: string, text: string) {
      const body = new FormData();
      body.set("file", new Blob([text], { type: "text/plain" }), "private.txt");
      return upload(
        new Request(`${origin}/api/attachments`, {
          method: "POST",
          headers: { ...bearer(token), "X-Doompile-Upload-ID": id },
          body,
        }),
      );
    }
    assert.equal((await file(a.token, "alice-file")).status, 201);
    assert.equal(
      (
        await download(
          new Request(`${origin}/api/attachments/${id}`, {
            headers: bearer(b.token),
          }),
          context(id),
        )
      ).status,
      404,
    );
    assert.equal((await file(b.token, "bob-file")).status, 201);
    for (const [account, text] of [
      [a, "alice-file"],
      [b, "bob-file"],
    ] as const) {
      const response = await download(
        new Request(`${origin}/api/attachments/${id}`, {
          headers: bearer(account.token),
        }),
        context(id),
      );
      assert.equal(await response.text(), text);
    }
    assert.notEqual(bucketName(a.user.id), bucketName(b.user.id));
    assert.deepEqual(await objects(a.user.id).usage(), {
      bytes: 10,
      objects: 1,
    });
  } finally {
    fixture.cleanup();
  }
});

test("device sign-in requires browser consent, a private polling secret, and one-use exchange", async () => {
  const fixture = testEnvironment(),
    account = fixture.account("alice");
  try {
    const created = await device(
      new Request(`${origin}/api/auth/device`, {
        method: "POST",
        body: JSON.stringify({ label: "Test Mac" }),
      }),
    );
    assert.equal(created.status, 201);
    const flow = await created.json();
    const poll = (secret = flow.secret) =>
      device(
        new Request(`${origin}/api/auth/device`, {
          method: "POST",
          body: JSON.stringify({ code: flow.code, secret }),
        }),
      );
    assert.equal((await (await poll()).json()).status, "pending");
    assert.equal((await poll("x".repeat(43))).status, 410);
    const request = (headers: Record<string, string>) =>
      new Request(`${origin}/api/auth/device/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code: flow.code, userId: "attacker" }),
      });
    assert.equal((await approve(request(bearer(account.token)))).status, 403);
    const headers = browser(account.user.id);
    assert.equal(
      (await approve(request({ ...headers, Origin: "https://evil.example" })))
        .status,
      401,
    );
    assert.equal((await approve(request(headers))).status, 200);
    const result = await (await poll()).json();
    assert.equal(result.status, "approved");
    assert.equal(result.user.id, account.user.id);
    assert.ok(identities().authenticate(result.token, "device"));
    assert.equal((await poll()).status, 410);
    assert.equal((await approve(request(headers))).status, 410);
  } finally {
    fixture.cleanup();
  }
});

test("admin is closed until configured, uses a verified email and optional user pin, and excludes device tokens", async () => {
  const fixture = testEnvironment(),
    owner = fixture.account("owner"),
    other = fixture.account("other");
  const oldEmail = process.env.DOOMPILE_ADMIN_EMAIL,
    oldPin = process.env.DOOMPILE_ADMIN_USER_ID;
  delete process.env.DOOMPILE_ADMIN_EMAIL;
  delete process.env.DOOMPILE_ADMIN_USER_ID;
  try {
    const request = (headers: Record<string, string>) =>
      new Request(`${origin}/api/admin/users`, { headers });
    const ownerHeaders = browser(owner.user.id);
    assert.equal((await admin(request(ownerHeaders))).status, 403);
    process.env.DOOMPILE_ADMIN_EMAIL = owner.user.email.toUpperCase();
    assert.equal((await admin(request(bearer(owner.token)))).status, 403);
    assert.equal((await admin(request(browser(other.user.id)))).status, 403);
    const response = await admin(request(ownerHeaders));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 2);
    assert.equal(data.users[0].usage.bytes, 0);
    assert.ok(data.users.every((row: any) => !row.token && !row.subject));
    process.env.DOOMPILE_ADMIN_USER_ID = other.user.id;
    assert.equal((await admin(request(ownerHeaders))).status, 403);
    delete process.env.DOOMPILE_ADMIN_USER_ID;
    identities().login({
      provider: "google",
      subject: "owner",
      email: owner.user.email,
      emailVerified: false,
      name: "owner",
    });
    assert.equal((await admin(request(ownerHeaders))).status, 403);
    assert.equal(
      (
        await logout(
          new Request(`${origin}/api/session`, {
            method: "DELETE",
            headers: bearer(owner.token),
          }),
        )
      ).status,
      200,
    );
    assert.equal(identities().authenticate(owner.token, "device"), null);
  } finally {
    if (oldEmail === undefined) delete process.env.DOOMPILE_ADMIN_EMAIL;
    else process.env.DOOMPILE_ADMIN_EMAIL = oldEmail;
    if (oldPin === undefined) delete process.env.DOOMPILE_ADMIN_USER_ID;
    else process.env.DOOMPILE_ADMIN_USER_ID = oldPin;
    fixture.cleanup();
  }
});

test("matching emails across providers never silently merge user contexts or legacy stores", () => {
  const fixture = testEnvironment();
  try {
    const one = identities().login({
      provider: "google",
      subject: "one",
      email: "same@example.test",
      emailVerified: true,
      name: "One",
    });
    const two = identities().login({
      provider: "yandex",
      subject: "two",
      email: "same@example.test",
      emailVerified: true,
      name: "Two",
    });
    assert.notEqual(one.id, two.id);
    assert.equal(
      identities().login({ ...one, email: "new@example.test" }).id,
      one.id,
    );
    assert.throws(() => store("../legacy"), /Invalid/);
    assert.throws(() => bucketName("../../other"), /Invalid/);
  } finally {
    fixture.cleanup();
  }
});
