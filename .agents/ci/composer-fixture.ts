/** Isolated native UI fixture using the production causal version store. */
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createNote, textToDocument, type Note } from "../../packages/core/src/index";
import { capture } from "../../packages/sync/changes";
import { VersionStore } from "../../apps/web/lib/server/versions";
let db: DatabaseSync, versions: VersionStore, originalID: string | undefined, active = false, offline = false, requests = 0, marker: Note | undefined;
function reset() {
  db?.close(); db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE attachments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  versions = new VersionStore(db); originalID = undefined; active = false; offline = false; requests = 0; marker = undefined;
}
reset();
function notes() { return (db.prepare("SELECT id FROM notes").all() as { id: string }[]).map(row => versions.get(row.id)!).filter(note => !note.deletedAt); }
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const bytes = Buffer.concat(chunks);
    const url = new URL(req.url!, "http://127.0.0.1:18743"), path = url.pathname;
    const json = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (path === "/api/review/sync" && req.method === "POST") {
      reset(); active = true;
      const seed = capture(createNote({ plainText: "Sync review", body: { type: "doc", attrs: { editorVersion: 1, attachmentRecoveryVersion: 1 }, content: textToDocument("Sync review").content } }), "web");
      originalID = seed.note.id; return json(versions.sync(originalID, [seed.change! ]));
    }
    if (path === "/api/review/reset") { reset(); return json({}); }
    if (path === "/api/review/offline") { offline = true; return json({}); }
    if (path === "/api/review/online") { offline = false; return json({}); }
    if (path === "/api/review/marker") { marker = versions.get(originalID!)!; return json({ revision: marker.revision, plainText: marker.plainText }); }
    if (path === "/api/review/remote") {
      const current = versions.get(originalID!)!, text = "Remote " + current.plainText;
      const changed = capture({ ...current, body: { ...current.body, content: textToDocument(text).content }, plainText: text }, "macos");
      return json(versions.sync(originalID!, [changed.change!]));
    }
    if (path === "/api/review/sync") return json({ active, originalID, requests, conflicts: 0, offline, notes: notes(), marker });
    if (path === "/api/telemetry") return json({});
    if (offline) return json({ error: "Offline fixture" }, 503);
    if (path === "/api/notes") return json(url.searchParams.has("cursor") ? versions.changes(Number(url.searchParams.get("cursor"))) : { notes: active ? notes() : [] });
    const sync = path.match(/^\/api\/notes\/([a-f0-9-]+)\/sync$/);
    if (sync) {
      requests++; const input = JSON.parse(bytes.toString());
      const result = input.legacy ? versions.migrate(sync[1], input.legacy) : versions.sync(sync[1], input.changes, input.vector);
      if (active && requests > 3) await new Promise(resolve => setTimeout(resolve, 250));
      return json(result);
    }
    const history = path.match(/^\/api\/notes\/([a-f0-9-]+)\/versions(?:\/(\d+))?$/);
    if (history) {
      const [, id, revision] = history;
      if (!revision) return json({ versions: versions.versions(id, url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined) });
      if (req.method === "POST") { const input = JSON.parse(bytes.toString()); return json(versions.restore(id, Number(revision), input.origin, input.view)); }
      return json({ note: url.searchParams.get("view") === "authored" ? versions.authoredVersion(id, Number(revision)) : versions.version(id, Number(revision)) });
    }
    if (path === "/api/attachments") {
      const [head, tail] = bytes.toString("latin1").split("\r\n\r\n", 2);
      const id = String(req.headers["x-doompile-upload-id"] ?? randomUUID());
      const name = Buffer.from(head.match(/filename="([^"]*)"/)?.[1] ?? "file", "latin1").toString("utf8");
      const mimeType = head.match(/Content-Type: ([^\r\n]+)/)?.[1] ?? "application/octet-stream";
      await new Promise(resolve => setTimeout(resolve, Number(process.env.DOOMPILE_COMPOSER_FIXTURE_DELAY ?? 8) * 1000));
      const attachment = { id, name, mimeType, size: Buffer.byteLength(tail?.split("\r\n--")[0] ?? "", "latin1"), url: `/api/attachments/${id}` };
      db.prepare("INSERT OR REPLACE INTO attachments VALUES (?,?)").run(id, JSON.stringify(attachment));
      return json({ attachment }, 201);
    }
    json({}, 404);
  } catch (error) { res.writeHead(Number((error as { status?: number }).status ?? 500), { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Fixture synchronization failed" })); }
}).listen(18743, "127.0.0.1");
