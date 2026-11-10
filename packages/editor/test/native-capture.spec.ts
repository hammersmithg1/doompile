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

test("capture mode preserves an active recording and its text until explicit stop", async ({ page }) => {
  const recordingId = "00000000-0000-0000-0000-000000000001";
  const input = page.getByRole("textbox");
  await input.fill("Текст до записи");
  await page.evaluate(id => {
    window.doompileEditor.insertRecording(id);
    window.doompileEditor.setRecordingState({ id, seconds: 3, status: "recording" });
    window.doompileEditor.setCaptureMode(true);
  }, recordingId);
  const snippet = page.locator(".recording-block");
  await expect(snippet).toHaveCount(1);
  await expect(snippet).toBeHidden();
  await page.evaluate(() => window.doompileEditor.setCaptureMode(false));
  await expect(snippet).toBeVisible();
  await page.keyboard.type(" Продолжение");
  await page.evaluate(() => window.doompileEditor.setCaptureMode(true));
  await expect(snippet).toBeHidden();
  await page.evaluate(() => window.doompileEditor.setCaptureMode(false));
  await snippet.locator("button.recording-stop").click();
  expect(await page.evaluate(() => (window as any).nativeMessages.filter((m: any) => ["stopVoice", "sendCapture"].includes(m.action)).map((m: any) => m.action))).toEqual(["stopVoice"]);
  await page.evaluate(id => window.doompileEditor.completeRecording(id, {
    id, url: `local:${id}`, name: "Голосовая заметка.m4a", mimeType: "audio/mp4", size: 512,
  }), recordingId);
  await expect(snippet).toHaveCount(0);
  const audio = page.locator("[data-attachment] .attachment-audio");
  await expect(audio).toBeVisible();
  await page.evaluate(() => window.doompileEditor.setCaptureMode(true));
  await expect(audio).toBeHidden();
  const state = await page.evaluate(() => window.doompileEditor.getState());
  expect(state.plainText).toContain("Текст до записи");
  expect(state.plainText).toContain("Продолжение");
  expect(JSON.stringify(state.body)).toContain(`"recordingId":"${recordingId}"`);
});

test("removing a compact attachment removes each instance and remains undoable", async ({ page }) => {
  const attachment = { id: "00000000-0000-0000-0000-000000000001", url: "local:00000000-0000-0000-0000-000000000001", name: "archive.zip", mimeType: "application/zip", size: 22 };
  const other = { ...attachment, id: "00000000-0000-0000-0000-000000000002", url: "local:00000000-0000-0000-0000-000000000002", name: "another.zip" };
  await page.evaluate(({ attachment, other }) => {
    const editor = window.doompileEditor;
    editor.setDocument({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Черновик" },
      { type: "attachment", attrs: attachment },
      { type: "attachment", attrs: other },
      { type: "attachment", attrs: attachment },
    ] }] });
    editor.setCaptureMode(true);
    editor.focus();
  }, { attachment, other });
  const original = await page.evaluate(() => window.doompileEditor.getState().body);
  await page.evaluate(url => window.doompileEditor.removeAttachment(url), attachment.url);
  const after = await page.evaluate(() => window.doompileEditor.getState());
  expect(JSON.stringify(after.body)).not.toContain(attachment.url);
  expect(JSON.stringify(after.body)).toContain(other.url);
  expect(after.plainText).toContain("Черновик");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.doompileEditor.getState().body)).toEqual(original);
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
