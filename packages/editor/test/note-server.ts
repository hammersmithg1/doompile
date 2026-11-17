import type { Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { VersionStore } from "../../../apps/web/lib/server/versions";
import { capture } from "../../sync/changes";
import type { Note } from "../../core/src/index";

/** Browser tests use the actual server archive and merge, including receipts. */
export async function mockNotes(page: Page, notes: any[] = [], writes: any[] = []) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE attachments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  const versions = new VersionStore(db);
  for (const input of notes) {
    const note = { ...input }; if (note.deletedAt === null) delete note.deletedAt;
    db.prepare("INSERT INTO notes VALUES (?,?,?)").run(note.id, JSON.stringify(note), note.updatedAt);
  }
  let offline = false;
  const offlinePages = new Set<Page>();
  const update = (note: Note) => { const index = notes.findIndex(item => item.id === note.id); if (index < 0) notes.push(note); else notes[index] = note; };
  function remote(id: string, patch: Partial<Note>) {
    const current = versions.get(id)!, edited = capture({ ...current, ...patch }, "macos");
    const response = versions.sync(id, edited.change ? [edited.change] : []); update(response.note); return response.note;
  }
  const handler = async (route: import("@playwright/test").Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (offline || offlinePages.has(route.request().frame().page())) return route.fulfill({ status: 503, json: { error: "Offline fixture" } });
    try {
      if (path === "/api/notes") {
        // Some older UI fixtures deliberately change their remote array directly.
        for (const note of notes) {
          const current = versions.get(note.id);
          if (current && note.revision > current.revision) remote(note.id, { ...note, replica: current.replica });
        }
        const result = versions.changes(Number(url.searchParams.get("cursor") ?? 0));
        result.notes.forEach(update); return route.fulfill({ json: result });
      }
      const sync = path.match(/^\/api\/notes\/([^/]+)\/sync$/);
      if (sync) {
        const input = request.postDataJSON();
        const result = input.legacy ? versions.migrate(sync[1], input.legacy) : versions.sync(sync[1], input.changes, input.vector);
        update(result.note); writes.push(result.note); return route.fulfill({ json: result });
      }
      const history = path.match(/^\/api\/notes\/([^/]+)\/versions(?:\/(\d+))?$/);
      if (history) {
        const [, id, revision] = history;
        if (!revision) return route.fulfill({ json: { versions: versions.versions(id, url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined) } });
        if (request.method() === "POST") { const input = request.postDataJSON(), result = versions.restore(id, Number(revision), "web", input.view); update(result.note); return route.fulfill({ json: result }); }
        return route.fulfill({ json: { note: url.searchParams.get("view") === "authored" ? versions.authoredVersion(id, Number(revision)) : versions.version(id, Number(revision)) } });
      }
      return route.fallback();
    } catch (error) { return route.fulfill({ status: (error as { status?: number }).status ?? 500, json: { error: "Fixture rejected change" } }); }
  };
  await page.route("**/api/notes**", handler);
  page.once("close", () => db.close());
  return { versions, notes, writes, remote, attach: (other: Page) => other.route("**/api/notes**", handler), setOffline(value: boolean, target?: Page) { if (target) { if (value) offlinePages.add(target); else offlinePages.delete(target); } else offline = value; }, putAttachment(attachment: unknown) { const file = attachment as { id: string }; db.prepare("INSERT OR REPLACE INTO attachments VALUES (?,?)").run(file.id, JSON.stringify(file)); } };
}
