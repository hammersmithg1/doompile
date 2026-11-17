import { mkdir } from "node:fs/promises";
import { test, expect, mockNotes, browserTestUser, type Page } from "./web-test";
import { createNote } from "../../core/src/index";
const captures = ".agents/local/note-history/captures";
async function queued(page: Page, id: string) {
  return page.evaluate(async id => {
    const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111");
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<number>((resolve, reject) => { const row = db.transaction("records").objectStore("records").get(id); row.onsuccess = () => resolve(row.result?.changes?.length ?? 0); row.onerror = () => reject(row.error); });
    } finally { db.close(); }
  }, id);
}
test("two browser devices keep offline edits across restart and restore history in the same note", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (info.project.name === "web-webkit") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
  }
  const note = createNote({ plainText: "Общий текст", revision: 1 });
  const server = await mockNotes(page, [note]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/api/session", route => route.fulfill({ json: { authenticated: true, user: browserTestUser, providers: [], development: false } }));
  const other = await context.newPage(); await server.attach(other);
  try {
    await page.goto("/"); await other.goto("http://127.0.0.1:4176/");
    await page.locator(".note-main").click(); await other.locator(".note-main").click();
    const left = page.getByRole("textbox", { name: "Текст заметки" }), right = other.getByRole("textbox", { name: "Текст заметки" });
    await expect(left).toHaveText("Общий текст"); await expect(right).toHaveText("Общий текст");
    server.setOffline(true, other);
    await right.click(); await right.press("ControlOrMeta+End"); await right.pressSequentially(" второе");
    await expect.poll(() => queued(other, note.id)).toBeGreaterThan(0);
    await other.reload(); await other.locator(".note-main").click(); await expect(right).toContainText("второе");
    await left.click(); await left.press("ControlOrMeta+Home"); await left.pressSequentially("Первое ");
    await expect.poll(() => server.versions.get(note.id)?.plainText, { timeout: 15_000 }).toBe("Первое Общий текст");
    server.setOffline(false, other); await other.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.versions.get(note.id)?.plainText, { timeout: 15_000 }).toBe("Первое Общий текст второе");
    await expect(left).toHaveText("Первое Общий текст второе");
    await expect.poll(() => queued(other, note.id)).toBe(0);
    const mergedRevision = server.versions.get(note.id)!.revision;
    await mkdir(captures, { recursive: true });
    await page.screenshot({ path: `${captures}/merged-${info.project.name}.png` });
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        const animations = document.getAnimations().filter(animation => (animation.effect as KeyframeEffect)?.target instanceof HTMLElement && ((animation.effect as KeyframeEffect).target as HTMLElement).matches(".note-history, .modal-backdrop"));
        if (animations.length) { (window as any).historyAnimations = animations; observer.disconnect(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole("button", { name: "История версий", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "История версий" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).historyAnimations?.length ?? 0)).toBeGreaterThan(0);
    await dialog.locator('[data-history-version="1"]').click();
    await expect(dialog.getByRole("textbox", { name: "Текст заметки" })).toHaveText("Общий текст");
    for (const fraction of [0.2, 0.6]) {
      await page.evaluate(fraction => {
        const animations: Animation[] = (window as any).historyAnimations;
        const time = Math.max(...animations.map(animation => Number(animation.effect!.getTiming().duration))) * fraction;
        for (const animation of animations) { animation.pause(); animation.currentTime = Math.min(Number(animation.effect!.getTiming().duration), time); }
      }, fraction);
      await page.screenshot({ path: `${captures}/history-frame-${fraction}-${info.project.name}.png` });
    }
    await page.evaluate(() => { for (const animation of (window as any).historyAnimations) animation.finish(); });
    await page.screenshot({ path: `${captures}/history-${info.project.name}.png` });
    await dialog.getByRole("checkbox", { name: "Сохранённый вариант устройства" }).check();
    await expect(dialog.getByRole("textbox", { name: "Текст заметки" })).toHaveText("Общий текст");
    await dialog.getByRole("button", { name: "Восстановить версию" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(left).toHaveText("Общий текст"); await expect(right).toHaveText("Общий текст");
    expect(server.notes.filter(item => !item.deletedAt)).toHaveLength(1);
    expect(server.versions.get(note.id)?.id).toBe(note.id);
    expect(server.versions.get(note.id)!.revision).toBeGreaterThan(mergedRevision);
    expect(server.versions.version(note.id, mergedRevision)?.plainText).toBe("Первое Общий текст второе");
    await page.screenshot({ path: `${captures}/restored-${info.project.name}.png` });
  } finally { await context.close(); }
});
