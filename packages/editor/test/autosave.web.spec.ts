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
test("autsave keeps focus, flushes on close, and persists full content across reload", async ({
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
  await expect.poll(() => saved.length).toBe(1);
  await expect(textbox).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("- пункт");
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => saved.at(-1)?.plainText).toBe("Мысль\nпункт");
  await page.reload();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toContainText("Мысль");
});
test("a failed local write keeps the draft and the editor open; retry flushes it", async ({
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
  await expect(
    page.getByRole("status").filter({ hasText: "Не удалось сохранить" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("doompile-editor-draft:user:11111111-1111-4111-8111-111111111111")!).note
          .plainText,
    ),
  ).toBe("Не потерять");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).originalPut;
  });
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Редактор заметки" }),
  ).toHaveCount(0);
});

test("quick input survives expand and immediate close without further typing", async ({ page }) => {
  const saved: any[] = [];
  await page.route("**/api/notes", route => route.fulfill({json:{notes:saved.slice(-1)}}));
  await page.route("**/api/notes/*", async route => {
    const {note} = route.request().postDataJSON();
    saved.push({...note,revision:saved.length+1});
    await route.fulfill({json:{note:saved.at(-1)}});
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Быстрая заметка" }).fill("До раскрытия");
  await page.getByRole("button",{name:"Развернуть редактор",exact:true}).click();
  await page.getByRole("button",{name:"Закрыть редактор",exact:true}).click();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toContainText("До раскрытия");
  await page.reload();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toContainText("До раскрытия");
});
