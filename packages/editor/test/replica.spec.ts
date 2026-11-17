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
