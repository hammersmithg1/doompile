import { test, expect, type Page } from "./web-test";
const note = (id: string, text: string, tags: string[]) => ({
  id,
  title: text,
  plainText: text,
  body: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
  tags,
  pinned: false,
  urgent: false,
  kind: "note",
  attachments: [],
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
  revision: 0,
  deletedAt: null,
});
async function setup(page: Page) {
  const notes = [
    note("d3d0daa0-cc18-4bbf-b8c2-2837b3324ef3", "Тестовая мысль", ["Идеи"]),
    note("79e6e26a-a30c-4b57-8653-ee9ba8d94c6f", "Вторая мысль", [
      "Работа",
      "Проекты",
    ]),
  ];
  const writes: any[] = [];
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: notes.filter((note) => !note.deletedAt) } }),
  );
  await page.route("**/api/notes/*", async (route) => {
    const { note } = route.request().postDataJSON();
    const saved = {
      ...note,
      revision: (notes.find((item) => item.id === note.id)?.revision || 0) + 1,
    };
    writes.push(saved);
    const index = notes.findIndex((item) => item.id === note.id);
    if (index < 0) notes.push(saved);
    else notes[index] = saved;
    await route.fulfill({ json: { note: saved } });
  });
  await page.goto("/");
  await expect(page.locator(".note-main")).toHaveCount(2);
  return { notes, writes };
}
async function openNote(page: Page) {
  await page
    .locator(".note-main")
    .filter({ hasText: "Тестовая мысль" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
}

test("new composer has collapse and send in the header, with folders below it", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Развернуть редактор", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Редактор заметки" });
  await expect(editor.locator("header button:visible")).toHaveCount(2);
  await expect(editor.locator("header")).not.toContainText("ЗАМЕТКА");
  await expect(
    editor.getByRole("button", { name: "Свернуть редактор" }),
  ).toBeVisible();
  await expect(editor.getByRole("button", { name: "Отправить заметку" })).toBeDisabled();
  const header = (await editor.locator("header").boundingBox())!,
    tags = (await editor.locator(".note-tags-editor").boundingBox())!;
  expect(tags.y).toBeGreaterThanOrEqual(header.y + header.height);
});
test("an opened note is immediately editable; expand and collapse keep the editor and caret", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await openNote(page);
  const editor = page.getByRole("region", { name: "Редактор заметки" });
  await expect(editor.locator("header button:visible")).toHaveCount(6);
  await expect(page.locator(".detail-footer")).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Редактировать", exact: true }),
  ).toHaveCount(0);
  const textbox = editor.getByRole("textbox", { name: "Текст заметки" });
  await textbox.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await textbox.evaluate((element) =>
    element.setAttribute("data-instance", "same"),
  );
  await editor
    .getByRole("button", { name: "Развернуть заметку", exact: true })
    .click();
  await expect(textbox).toHaveAttribute("data-instance", "same");
  await expect(textbox).toBeFocused();
  await editor
    .getByRole("button", { name: "Свернуть заметку", exact: true })
    .click();
  await expect(textbox).toHaveAttribute("data-instance", "same");
  await expect
    .poll(
      () => writes.findLast((note) => note.id.startsWith("d3d0"))?.plainText,
    )
    .toBe("Тестовая мысль!");
});
test("folder suggestions filter existing folders, create new ones, and show removable tags", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await openNote(page);
  await page.getByRole("button", { name: "Добавить тег", exact: true }).click();
  const search = page.getByRole("combobox", {
    name: "Найти или создать тег",
  });
  await search.fill("Раб");
  await expect(
    page.getByRole("option", { name: "Работа", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Убрать тег Работа" }),
  ).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("Личное");
  await page
    .getByRole("option", { name: "Создать «Личное»", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "Убрать тег Личное" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Убрать тег Идеи" }).click();
  await expect
    .poll(() => writes.findLast((note) => note.id.startsWith("d3d0"))?.tags)
    .toEqual(["Работа", "Личное"]);
});
test("Escape closes folder suggestions without closing the note; selected folders are not duplicated", async ({
  page,
}) => {
  await setup(page);
  await openNote(page);
  await page.getByRole("button", { name: "Добавить тег", exact: true }).click();
  await page.getByRole("combobox").fill("идеи");
  await expect(
    page.getByRole("listbox", { name: "Подсказки тегов" }),
  ).toContainText("Эта тег уже добавлена");
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-tag")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
});
test("switching notes flushes the last edit and keeps the quick composer draft", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page
    .getByRole("textbox", { name: "Быстрая заметка" })
    .fill("Быстрый черновик");
  await openNote(page);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" сразу");
  await expect(page.getByRole("textbox", { name: "Текст заметки" })).toHaveText("Тестовая мысль сразу");
  await page.locator(".note-main").filter({ hasText: "Вторая мысль" }).click();
  await expect(page.getByRole("textbox", { name: "Текст заметки" })).toHaveText(
    "Вторая мысль",
  );
  await expect.poll(() => writes.findLast((note) => note.id.startsWith("d3d0"))?.plainText).toBe("Тестовая мысль сразу");
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expect(
    page.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toHaveValue("Быстрый черновик");
});
test("delete in the header flushes edits and does not resurrect the note", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await openNote(page);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" последняя правка");
  await page
    .getByRole("button", { name: "Удалить заметку", exact: true })
    .click();
  await expect(page.locator(".note-main")).toHaveCount(1);
  await expect
    .poll(
      () => !!writes.findLast((note) => note.id.startsWith("d3d0"))?.deletedAt,
    )
    .toBe(true);
  await page.waitForTimeout(750);
  expect(
    writes.findLast((note) => note.id.startsWith("d3d0"))?.deletedAt,
  ).toBeTruthy();
});
test("header and folder suggestions fit narrow and wide layouts", async ({
  page,
}, testInfo) => {
  await setup(page);
  await openNote(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator(".note-editor-header"),
      buttons = page.locator(".note-editor-actions");
    const bounds = (await header.boundingBox())!,
      controls = (await buttons.boundingBox())!;
    expect(controls.y).toBeGreaterThanOrEqual(bounds.y);
    expect(controls.y + controls.height).toBeLessThanOrEqual(
      bounds.y + bounds.height,
    );
    await page
      .getByRole("button", { name: "Добавить тег", exact: true })
      .click();
    const popup = (await page
      .getByRole("listbox", { name: "Подсказки тегов" })
      .boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
    await page.keyboard.press("Escape");
  }
});

test("a mention in the new composer opens the same editable note surface after closing", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Развернуть редактор", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.type("@Тестовая");
  await page.keyboard.press("Enter");
  await page.locator("[data-note-reference]").click();
  await expect(page.getByRole("textbox", { name: "Текст заметки" })).toHaveText(
    "Тестовая мысль",
  );
  await expect(
    page.getByRole("button", { name: "Развернуть заметку", exact: true }),
  ).toBeVisible();
});
test("new composer keeps the header and tags while collapsing a draft", async ({
  page,
}, testInfo) => {
  const { writes } = await setup(page);
  await page
    .getByRole("button", { name: "Развернуть редактор", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.type("Новая мысль");
  await expect(page.locator(".note-editor-header button:visible")).toHaveCount(2);
  await page.getByRole("button", { name: "Добавить тег", exact: true }).click();
  await page.getByRole("combobox").fill("Идеи");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Добавить тег", exact: true }),
  ).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: testInfo.outputPath("new-editor-dark.png") });
  await page.getByRole("button", { name: "Свернуть редактор", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Быстрая заметка" })).toHaveValue("Новая мысль");
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Развернуть редактор", exact: true }).click();
  await expect(page.locator(".note-tags-editor")).toContainText("Идеи");
  await page.getByRole("button", { name: "Отправить заметку", exact: true }).click();
  await expect.poll(() => writes.at(-1)?.tags).toEqual(["Идеи"]);
});

test("file insertion retains metadata and deleting the block does not recreate it on reopening", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await openNote(page);
  const attachment = {
    id: "63f6433e-67b6-4c25-8852-11f3bb1c12df",
    url: "/api/attachments/63f6433e-67b6-4c25-8852-11f3bb1c12df",
    name: "test-file.txt",
    mimeType: "text/plain",
    size: 4,
  };
  await page.route("**/api/attachments", (route) =>
    route.fulfill({ json: { attachment } }),
  );
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/file");
  const file = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await file
  ).setFiles({
    name: attachment.name,
    mimeType: attachment.mimeType,
    buffer: Buffer.from("text"),
  });
  await expect(page.locator(".attachment")).toContainText(attachment.name);
  await expect
    .poll(() =>
      writes
        .findLast((note) => note.id.startsWith("d3d0"))
        ?.attachments.map((file: any) => file.id),
    )
    .toEqual([attachment.id]);
  await page.locator(".attachment").hover();
  await page
    .getByRole("button", { name: "Перетащить блок", exact: true })
    .click();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".attachment")).toHaveCount(0);
  await expect
    .poll(
      () => writes.findLast((note) => note.id.startsWith("d3d0"))?.attachments,
    )
    .toEqual([]);
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await openNote(page);
  await expect(page.locator(".attachment")).toHaveCount(0);
});
