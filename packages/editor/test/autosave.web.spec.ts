import { test, expect, type Page } from "./web-test";
async function mockServer(page: Page) {
  const saved: any[] = [];
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: saved.slice(-1) } }),
  );
  await page.route("**/api/notes/*", async (route) => {
    const { note } = route.request().postDataJSON();
    saved.push({ ...note, revision: saved.length + 1 });
    await route.fulfill({ json: { note: saved.at(-1) } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Развернуть редактор", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
  return saved;
}
test("autosave keeps focus, flushes on close, and persists full content across reload", async ({
  page,
}) => {
  const saved = await mockServer(page);
  const editor = page.getByRole("region", { name: "Редактор заметки" });
  await expect(
    editor.getByRole("button", { name: "Сохранить", exact: true }),
  ).toHaveCount(0);
  await expect(
    editor.locator(".editor-title, .format-toolbar, .block-toolbar"),
  ).toHaveCount(0);
  const textbox = page.getByRole("textbox", { name: "Текст заметки" });
  await textbox.click();
  await page.keyboard.type("Мысль");
  await editor.getByRole("button", { name: "Отправить заметку", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  await page.locator(".note-main").filter({ hasText: "Мысль" }).click();
  await textbox.press("End");
  await page.keyboard.type("!");
  await expect.poll(() => saved.at(-1)?.plainText).toBe("Мысль!");
  await expect(textbox).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("- пункт");
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => saved.at(-1)?.plainText).toBe("Мысль!\nпункт");
  await page.reload();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toContainText("Мысль");
});
test("a failed local send keeps the draft and the editor open for retry", async ({
  page,
}) => {
  await mockServer(page);
  await page.evaluate(() => {
    (window as any).originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Disk full", "QuotaExceededError");
    };
  });
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.type("Не потерять");
  const send = page.getByRole("button", { name: "Отправить заметку", exact: true });
  await send.click();
  await expect(page.getByRole("status").filter({ hasText: "Disk full" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("doompile-collapsed-capture:user:11111111-1111-4111-8111-111111111111")!)
          .plainText,
    ),
  ).toBe("Не потерять");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).originalPut;
  });
  await send.click();
  await expect(
    page.getByRole("region", { name: "Редактор заметки" }),
  ).toHaveCount(0);
});

test("quick input survives expand, immediate collapse, and reload without sending", async ({ page }) => {
  const saved: any[] = [];
  await page.route("**/api/notes", route => route.fulfill({json:{notes:saved.slice(-1)}}));
  await page.route("**/api/notes/*", async route => {
    const {note} = route.request().postDataJSON();
    saved.push({...note,revision:saved.length+1});
    await route.fulfill({json:{note:saved.at(-1)}});
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Быстрая заметка" });
  await input.fill("До раскрытия");
  await page.getByRole("button",{name:"Развернуть редактор",exact:true}).click();
  await page.getByRole("button", { name: "Свернуть редактор", exact: true }).click();
  await expect(input).toHaveValue("До раскрытия");
  expect(saved).toHaveLength(0);
  await page.reload();
  await expect(input).toHaveValue("До раскрытия");
  expect(saved).toHaveLength(0);
});
