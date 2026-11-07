import { identities } from "./identity";
import { testAccount } from "./test-accounts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNote, noteURL, noteIDFromURL } from "@doompile/core";
import { store } from "./store";
import { GET, PUT } from "../../app/api/notes/[id]/route";
test("an authenticated agent can resolve a note link, check a task and preserve revision checks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "doompile-note-link-"));
  const oldDirectory = process.env.DOOMPILE_DATA_DIR,
    oldToken = process.env.DOOMPILE_API_TOKEN;
  process.env.DOOMPILE_DATA_DIR = directory;
  process.env.DOOMPILE_API_TOKEN = "link-agent-test";
  const account = testAccount();
  const repository = store(account.user.id);
  try {
    const note = createNote({
      plainText: "Agent task",
      body: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Done work" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    repository.save(note, 0);
    const id = noteIDFromURL(noteURL(note.id, "https://notes.example.test"))!;
    const context = { params: Promise.resolve({ id }) };
    const endpoint = "http://localhost/api/notes/" + id,
      headers = {
        Authorization: `Bearer ${account.token}`,
        "Content-Type": "application/json",
      };
    assert.equal((await GET(new Request(endpoint), context)).status, 401);
    const response = await GET(new Request(endpoint, { headers }), context);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const fetched = (await response.json()).note;
    fetched.body.content[0].content[0].attrs.checked = true;
    const body = JSON.stringify({
      note: fetched,
      baseRevision: fetched.revision,
    });
    const saved = await PUT(
      new Request(endpoint, { method: "PUT", headers, body }),
      context,
    );
    assert.equal(saved.status, 200);
    assert.equal(
      (await saved.json()).note.body.content[0].content[0].attrs.checked,
      true,
    );
    fetched.plainText = "Stale change";
    assert.equal(
      (
        await PUT(
          new Request(endpoint, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              note: fetched,
              baseRevision: fetched.revision,
            }),
          }),
          context,
        )
      ).status,
      409,
    );
    const current = repository.get(id)!;
    repository.save(
      { ...current, deletedAt: new Date().toISOString() },
      current.revision,
    );
    assert.equal(
      (await GET(new Request(endpoint, { headers }), context)).status,
      404,
    );
    assert.equal(
      (
        await GET(new Request(endpoint, { headers }), {
          params: Promise.resolve({ id: "invalid" }),
        })
      ).status,
      400,
    );
  } finally {
    repository.close(); identities().close();
    rmSync(directory, { recursive: true, force: true });
    if (oldDirectory === undefined) delete process.env.DOOMPILE_DATA_DIR;
    else process.env.DOOMPILE_DATA_DIR = oldDirectory;
    if (oldToken === undefined) delete process.env.DOOMPILE_API_TOKEN;
    else process.env.DOOMPILE_API_TOKEN = oldToken;
  }
});
