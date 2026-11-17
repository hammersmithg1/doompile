import { test, expect } from "@playwright/test";
import { createNote } from "../../core/src/index";
import { prepare } from "../../sync/model";
test("a live editor merges a remote prefix without moving local typing or undoing remote work", async ({ page }) => {
  const base = prepare(createNote({ plainText: "Shared" }));
  await page.goto("/");
  await page.evaluate(note => { (window as any).base = note; (window as any).controller.setNote(note); }, base);
  const editor = page.getByRole("textbox", { name: "Текст заметки" });
  await expect(editor).toHaveText("Shared");
  await editor.click(); await editor.press("ControlOrMeta+End"); await editor.pressSequentially(" local");
  await page.evaluate(() => {
    const w = window as any, note = w.base;
    const remote = w.sync.prepare({ ...note, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Remote Shared" }] }] }, plainText: "Remote Shared", revision: 2 });
    const count = w.replicaEvents.length;
    w.controller.setNote(remote); w.controller.setNote(remote);
    if (w.replicaEvents.length !== count) throw Error("Remote update was echoed as a local edit");
  });
  await expect(editor).toHaveText("Remote Shared local");
  await page.keyboard.type("!"); await expect(editor).toHaveText("Remote Shared local!");
  await page.keyboard.press("ControlOrMeta+z"); await expect(editor).toContainText("Remote Shared");
  const state = await page.evaluate(() => ({ errors: (window as any).syncErrors, events: (window as any).replicaEvents.length, id: (window as any).controller.getNote().id }));
  expect(state.errors).toEqual([]); expect(state.events).toBeGreaterThan(1); expect(state.id).toBe(base.id);
});

test("an older editor pauses on an unknown shared node without deleting it or echoing an update", async ({ page }) => {
  const base = prepare(createNote({ plainText: "Known" }));
  await page.goto("/");
  await page.evaluate(note => {
    const w = window as any; w.controller.setNote(note);
    const doc = w.sync.open(note.replica), node = new w.Y.XmlElement("futureVersionNode");
    doc.getXmlFragment("body").insert(1, [node]);
    w.controller.setNote({ ...note, replica: w.sync.state(doc) });
    w.controller.setEditable(true);
  }, base);
  await expect(page.getByRole("textbox", { name: "Текст заметки" })).toHaveAttribute("contenteditable", "false");
  const result = await page.evaluate(() => ({ errors: (window as any).syncErrors, events: (window as any).replicaEvents.length }));
  expect(result.errors).toHaveLength(1); expect(result.events).toBe(0);
});

test("deleting a media block removes its active attachment and undo restores the same file metadata", async ({ page }) => {
  const file = { id: "813e83a9-92e2-4cd7-8477-9b9395b503c0", name: "Photo.svg", mimeType: "image/svg+xml", size: 400, url: "/api/attachments/813e83a9-92e2-4cd7-8477-9b9395b503c0" };
  const base = prepare(createNote({ plainText: "File", attachments: [file] }));
  await page.route(`**${file.url}`, route => route.fulfill({ contentType: file.mimeType, body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"/>' }));
  await page.goto("/");
  const deleted = await page.evaluate(note => {
    const w = window as any; w.controller.setNote(note);
    let position = -1; w.testEditor.state.doc.descendants((node: any, pos: number) => { if (node.type.name === "image") position = pos; });
    if (position < 0) throw Error("Missing image");
    w.testEditor.commands.setNodeSelection(position); w.testEditor.commands.deleteSelection();
    const after = w.controller.getNote();
    w.controller.setNote(w.sync.prepare(after)); // Persisted metadata cleanup is a remote-origin update.
    return after.attachments.length;
  }, base);
  expect(deleted).toBe(0);
  const restored = await page.evaluate(() => { const w = window as any; w.testEditor.commands.undo(); return w.controller.getNote().attachments; });
  expect(restored).toEqual([file]);
});
