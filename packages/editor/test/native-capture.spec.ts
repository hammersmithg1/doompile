import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).nativeMessages = [];
    (window as any).webkit = { messageHandlers: { doompile: { postMessage: (value: unknown) => (window as any).nativeMessages.push(value) } } };
  });
  await page.goto("/editor.html");
  await page.waitForFunction(() => !!(window as any).doompileEditor);
});

test("compact Enter sends once, Shift Enter keeps a line break", async ({ page }) => {
  await page.evaluate(() => (window as any).doompileEditor.setCaptureMode(true));
  const input = page.getByRole("textbox", { name: "Текст заметки" });
  await input.fill("Первая строка");
  await input.press("Shift+Enter");
  await page.keyboard.type("Вторая строка");
  await input.press("Enter");
  const result = await page.evaluate(() => ({ state: (window as any).doompileEditor.getState(), sends: (window as any).nativeMessages.filter((m: any) => m.action === "sendCapture") }));
  expect(result.sends).toHaveLength(1);
  expect(result.state.plainText).toContain("Первая строка\nВторая строка");
});

test("compact Enter selects a slash command before sending", async ({ page }) => {
  await page.evaluate(() => (window as any).doompileEditor.setCaptureMode(true));
  await page.getByRole("textbox").click();
  await page.keyboard.type("/h2");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tiptap h2")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).nativeMessages.filter((m: any) => m.action === "sendCapture"))).toHaveLength(0);
});

test("expanding and collapsing preserves rich blocks, selection and undo", async ({ page }) => {
  const original = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Планы" }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Купить молоко" }] }] }] },
    { type: "paragraph", content: [{ type: "noteReference", attrs: { id: "00000000-0000-0000-0000-000000000001", title: "Идеи" } }, { type: "attachment", attrs: { url: "local:00000000-0000-0000-0000-000000000002", name: "file.pdf", mimeType: "application/pdf", size: 25 } }] },
    { type: "paragraph", content: [{ type: "text", text: "Финал" }] }
  ] };
  await page.evaluate((body) => { (window as any).doompileEditor.setDocument(body); (window as any).doompileEditor.focus(); }, original);
  const before = await page.evaluate(() => (window as any).doompileEditor.getState().body);
  await page.evaluate(() => { (window as any).doompileEditor.setCaptureMode(true); (window as any).doompileEditor.setCaptureMode(false); });
  expect(await page.evaluate(() => (window as any).doompileEditor.getState().body)).toEqual(before);
  await page.keyboard.type("!");
  await expect(page.locator(".tiptap > p").last()).toHaveText("Финал!");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => (window as any).doompileEditor.getState().body)).toEqual(before);
});

test("expanded Enter edits rather than submitting and composition never submits", async ({ page }) => {
  await page.evaluate(() => (window as any).doompileEditor.setCaptureMode(false));
  const input = page.getByRole("textbox");
  await input.fill("Новая заметка");
  await input.press("Enter");
  expect(await page.locator(".tiptap > p").count()).toBe(2);
  await page.evaluate(() => {
    (window as any).doompileEditor.setCaptureMode(true);
    document.querySelector(".tiptap")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
  });
  expect(await page.evaluate(() => (window as any).nativeMessages.filter((m: any) => m.action === "sendCapture"))).toHaveLength(0);
});
