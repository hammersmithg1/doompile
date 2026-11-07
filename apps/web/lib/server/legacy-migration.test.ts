import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createNote } from "@doompile/core";
import { NoteStore, store } from "./store";
import { testEnvironment } from "./test-accounts";
test("legacy ownership is explicit; source bytes stay intact and repeated migration is safe", () => {
  const fixture = testEnvironment(),
    first = fixture.account("first"),
    owner = fixture.account("owner");
  const legacy = new NoteStore(fixture.directory),
    id = crypto.randomUUID();
  const attachment = {
    id,
    name: "legacy.txt",
    mimeType: "text/plain",
    size: 3,
    url: `/api/attachments/${id}`,
  };
  legacy.save(
    createNote({ plainText: "Legacy private note", attachments: [attachment] }),
    0,
  );
  legacy.putAttachment(attachment);
  legacy.close();
  mkdirSync(resolve(fixture.directory, "attachments"));
  writeFileSync(resolve(fixture.directory, "attachments", id), "abc");
  const source = resolve(fixture.directory, "doompile.sqlite");
  const before = createHash("sha256")
    .update(readFileSync(source))
    .digest("hex");
  function migrate(userId: string) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "infra/migrate-legacy.ts", "--user", userId],
      {
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve("apps/web/tsconfig.json"),
        },
        encoding: "utf8",
      },
    );
  }
  try {
    assert.notEqual(migrate(crypto.randomUUID()).status, 0);
    for (let retry = 0; retry < 2; retry++) {
      const result = migrate(owner.user.id);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(store(first.user.id).list().length, 0);
    assert.equal(store(owner.user.id).list().length, 1);
    assert.equal(
      store(owner.user.id).list()[0].plainText,
      "Legacy private note",
    );
    assert.equal(store(owner.user.id).list()[0].revision, 1);
    const key = store(owner.user.id).attachmentKey(id)!;
    assert.equal(
      readFileSync(
        resolve(fixture.directory, "users", owner.user.id, "objects", key),
        "utf8",
      ),
      "abc",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(source)).digest("hex"),
      before,
    );
  } finally {
    fixture.cleanup();
  }
});
