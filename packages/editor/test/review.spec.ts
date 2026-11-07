import { test, expect, type Page } from "@playwright/test";

const imageID = "613e83a9-92e2-4cd7-8477-9b9395b503c0",
  fileID = "613e83a9-92e2-4cd7-8477-9b9395b503c1";
const p = (text = "") => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
async function doc(page: Page, content: unknown[]) {
  await page.evaluate((content) => {
    (window as any).controller.setDocument({ type: "doc", content });
    (window as any).testEditor.commands.focus("end");
  }, content);
}
async function json(page: Page) {
  return page.evaluate(() => (window as any).testEditor.getJSON());
}
async function selectAll(page: Page) {
  await page.getByRole("textbox", { name: "Текст заметки" }).focus();
  await page.keyboard.press("ControlOrMeta+a");
}
async function clipboard(page: Page, cut = false) {
  return page.evaluate((cut) => {
    const data = new DataTransfer();
    document.querySelector(".tiptap")!.dispatchEvent(
      new ClipboardEvent(cut ? "cut" : "copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    const payload = Object.fromEntries(
      [...data.types].map((type) => [type, data.getData(type)]),
    );
    (window as any).copied = payload;
    return payload;
  }, cut);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/attachments/*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" fill="#647b36"/></svg>',
    }),
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
});

test("a completed recording is not inserted again when its editor is reopened during delivery", async ({
  page,
}) => {
  await doc(page, [
    {
      type: "paragraph",
      content: [
        {
          type: "attachment",
          attrs: {
            id: fileID,
            url: `/api/attachments/${fileID}`,
            name: "Voice.webm",
            mimeType: "audio/webm",
            recordingId: "recovered-recording",
          },
        },
      ],
    },
  ]);
  await page.evaluate(() => {
    const controller = (window as any).controller;
    controller.insertRecording("recovered-recording");
    controller.insertRecording("recovered-recording");
  });
  await expect(page.locator(".tiptap .attachment-audio")).toHaveCount(1);
  await expect(page.locator(".tiptap .recording-block")).toHaveCount(0);
});

test("hydrating stored attachment metadata updates the image without emitting a user edit", async ({
  page,
}) => {
  await doc(page, [
    {
      type: "paragraph",
      content: [
        { type: "image", attrs: { src: `/api/attachments/${imageID}` } },
      ],
    },
  ]);
  const result = await page.evaluate((id) => {
    const w = window as any;
    const before = w.changes.length;
    w.controller.setAttachments([
      {
        id,
        url: `/api/attachments/${id}`,
        name: "Preview.svg",
        mimeType: "image/svg+xml",
        size: 400,
      },
    ]);
    return {
      before,
      after: w.changes.length,
      image: w.testEditor.getJSON().content[0].content[0],
    };
  }, imageID);
  expect(result.after).toBe(result.before);
  expect(result.image.attrs).toMatchObject({
    id: imageID,
    size: 400,
    name: "Preview.svg",
  });
});

test("Apple Notes shortcuts choose title, headings, paragraph and circular checklist", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  for (const [key, selector] of [
    ["T", "h1"],
    ["H", "h2"],
    ["J", "h3"],
    ["B", "p"],
  ]) {
    await page.keyboard.press(`ControlOrMeta+Shift+${key}`);
    await expect(page.locator(`.tiptap > ${selector}`)).toHaveText("Текст");
  }
  await page.keyboard.press("ControlOrMeta+Shift+L");
  const checkbox = page.locator('.tiptap input[type="checkbox"]');
  await expect(checkbox).toHaveCount(1);
  expect(
    await checkbox.evaluate((el) => getComputedStyle(el).borderRadius),
  ).toBe("50%");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test("slash commands have icons and Enter consumes one key without creating another paragraph", async ({
  page,
}) => {
  await page.keyboard.type("/");
  const options = page.getByRole("option");
  expect(await options.count()).toBeGreaterThan(12);
  expect(await options.locator("svg").count()).toBe(await options.count());
  await page.keyboard.type("туду");
  await expect(options).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(
    page.locator('.tiptap ul[data-type="taskList"] > li'),
  ).toHaveCount(1);
  await expect(page.locator(".tiptap > p")).toHaveCount(0);
  await page.keyboard.type("Задача");
  await expect(page.locator(".tiptap li p")).toHaveText("Задача");
});

test("custom slash aliases are configurable and persist after reopening the editor", async ({
  page,
}) => {
  await page.keyboard.type("/настройки");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", {
    name: "Настройки команд редактора",
  });
  await expect(settings).toBeVisible();
  await settings.getByLabel("Чеклист", { exact: false }).fill("дела, mytodo");
  await settings.getByRole("button", { name: "Сохранить настройки" }).click();
  await page.keyboard.type("/дела");
  await expect(page.getByRole("option")).toHaveText("Чеклист");
  await page.keyboard.press("Enter");
  await expect(page.locator('.tiptap ul[data-type="taskList"]')).toHaveCount(1);
  await page.reload();
  await page.getByRole("textbox").click();
  await page.keyboard.type("/mytodo");
  await page.keyboard.press("Enter");
  await expect(page.locator('.tiptap ul[data-type="taskList"]')).toHaveCount(1);
});

test("two images, a file and ordinary text share one line and keep the caret after media", async ({
  page,
}) => {
  await page.keyboard.type("До ");
  await page.evaluate(
    ({ imageID, fileID }) => {
      const controller = (window as any).controller,
        editor = controller.editor;
      controller.insertAttachment({
        id: imageID,
        url: `/api/attachments/${imageID}`,
        name: "photo.png",
        mimeType: "image/png",
        size: 123,
      });
      editor.commands.insertContent(" между ");
      controller.insertAttachment({
        id: imageID,
        url: `/api/attachments/${imageID}`,
        name: "photo.png",
        mimeType: "image/png",
        size: 123,
      });
      editor.commands.insertContent(" после ");
      controller.insertAttachment({
        id: fileID,
        url: `/api/attachments/${fileID}`,
        name: "report.pdf",
        mimeType: "application/pdf",
        size: 99,
      });
      editor.commands.insertContent(" хвост");
    },
    { imageID, fileID },
  );
  await expect(page.locator(".tiptap > p")).toHaveCount(1);
  await expect(
    page.locator(".tiptap > p img:not(.ProseMirror-separator)"),
  ).toHaveCount(2);
  await expect(page.locator(".tiptap > p")).toContainText("хвост");
  const first = page.locator("[data-resize-container]").first();
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.width).toBeLessThan(250);
  const content = (await json(page)).content[0].content;
  expect(content.map((node: any) => node.type)).toEqual([
    "text",
    "image",
    "text",
    "image",
    "text",
    "attachment",
    "text",
  ]);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");
  await expect(page.locator(".tiptap")).toContainText("хвос!т");
});

test("copy and cut carry full blocks, inline media, dimensions and formatting into a new document", async ({
  page,
}) => {
  await doc(page, [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Жирный", marks: [{ type: "bold" }] },
        {
          type: "image",
          attrs: {
            id: imageID,
            src: `/api/attachments/${imageID}`,
            alt: "photo.png",
            mimeType: "image/png",
            size: 123,
            width: 120,
            height: 70,
          },
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "attachment",
          attrs: {
            id: fileID,
            url: `/api/attachments/${fileID}`,
            name: "report.pdf",
            mimeType: "application/pdf",
            size: 99,
          },
        },
        {
          type: "sourceSnippet",
          attrs: {
            url: "https://example.com",
            title: "Страница",
            quote: "Цитата",
          },
        },
      ],
    },
  ]);
  await selectAll(page);
  const payload = await clipboard(page, true);
  expect(payload["text/html"]).toContain("<strong>Жирный</strong>");
  expect(payload["text/html"]).not.toMatch(/<button|<label|<input/);
  expect(payload["text/plain"]).not.toContain("\n\n");
  await expect(
    page.locator(".tiptap img:not(.ProseMirror-separator)"),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries((window as any).copied))
      data.setData(type, value as string);
    document.querySelector(".tiptap")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.locator(".tiptap strong").filter({ hasText: "Жирный" }),
  ).toHaveText("Жирный");
  await expect(
    page.locator(".tiptap img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
  await expect(page.locator(".attachment-card")).toContainText("report.pdf");
  await expect(page.locator(".source-quote")).toHaveText("Цитата");
  const image = (await json(page)).content[0].content.find(
    (node: any) => node.type === "image",
  );
  expect(image.attrs.width).toBe(120);
  expect(image.attrs.height).toBe(70);
});

test("clipboard HTML and plain text keep list formatting without UI labels or extra blank rows", async ({
  page,
}) => {
  await doc(page, [
    p("Первый"),
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p("Задача")] },
      ],
    },
    p("Последний"),
  ]);
  await selectAll(page);
  const payload = await clipboard(page);
  expect(payload["text/plain"]).toBe("Первый\n☑ Задача\nПоследний");
  expect(payload["text/html"]).toContain("<ul");
  expect(payload["text/html"]).not.toMatch(/Task item checkbox|<label|<input/);
});

test("text color, highlight, super/subscript, alignment and indentation round trip", async ({
  page,
}) => {
  await page.keyboard.type("Формат");
  await selectAll(page);
  const colors = page.getByRole("button", {
    name: "Цвет текста и выделения",
    exact: true,
  });
  await colors.click();
  await page
    .getByRole("menuitem", { name: "Цвет текста: Красный", exact: true })
    .click();
  await colors.click();
  await page
    .getByRole("menuitem", { name: "Цвет выделения: Жёлтый", exact: true })
    .click();
  await expect(page.locator(".tiptap mark")).toHaveText("Формат");
  const more = page.getByRole("button", { name: "Ещё форматирование" });
  await more.click();
  await page.getByRole("menuitem", { name: "Верхний индекс" }).click();
  await expect(page.locator(".tiptap sup")).toHaveText("Формат");
  await more.click();
  await page.getByRole("menuitem", { name: "Нижний индекс" }).click();
  await expect(page.locator(".tiptap sub")).toHaveText("Формат");
  await expect(page.locator(".tiptap sup")).toHaveCount(0);
  await more.click();
  await page.getByRole("menuitem", { name: "По центру", exact: true }).click();
  await more.click();
  await page
    .getByRole("menuitem", { name: "Увеличить отступ", exact: true })
    .click();
  const saved = await json(page);
  expect(saved.content[0].attrs).toMatchObject({
    textAlign: "center",
    indent: 1,
  });
  await page.evaluate(
    (body) => (window as any).controller.setDocument(body),
    saved,
  );
  await expect(page.locator(".tiptap mark sub, .tiptap sub mark")).toHaveText(
    "Формат",
  );
});

test("block type dropdown changes a list item into a working H2 heading", async ({
  page,
}) => {
  await page.keyboard.type("- Заголовок");
  await selectAll(page);
  await page.getByRole("button", { name: "Тип блока", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Заголовок 2", exact: true })
    .click();
  await expect(page.locator(".tiptap h2")).toHaveText("Заголовок");
  await expect(page.locator(".tiptap ul")).toHaveCount(0);
});

test("handle and right click open block actions; duplicate and delete preserve neighboring blocks", async ({
  page,
}) => {
  await doc(page, [p("Первый"), p("Второй")]);
  await page.locator(".tiptap p").first().hover();
  await page
    .getByRole("button", { name: "Перетащить блок", exact: true })
    .click();
  const menu = page.getByRole("menu", { name: "Действия с блоком" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Дублировать блок" }).click();
  await expect(page.locator(".tiptap > p")).toHaveText([
    "Первый",
    "Первый",
    "Второй",
  ]);
  await page.locator(".tiptap p").nth(1).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Удалить блок" }).click();
  await expect(page.locator(".tiptap > p")).toHaveText(["Первый", "Второй"]);
});

test("pointer block dragging shows a drop line and moves a whole block without losing text", async ({
  page,
}) => {
  await doc(page, [p("Один"), p("Два"), p("Три")]);
  await page.locator(".tiptap > p").first().hover();
  const handle = page.getByRole("button", {
    name: "Перетащить блок",
    exact: true,
  });
  await handle.hover();
  await page.mouse.down();
  const target = (await page.locator(".tiptap > p").nth(2).boundingBox())!;
  await page.mouse.move(target.x + 50, target.y + target.height - 1, {
    steps: 8,
  });
  await expect(page.locator(".block-drop-indicator")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".tiptap > p")).toHaveText(["Два", "Три", "Один"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".tiptap > p")).toHaveText(["Один", "Два", "Три"]);
});

test("every outline heading can be activated after scrolling without deferred focus jumping back", async ({
  page,
}) => {
  const content = [1, 2, 3].flatMap((n) => [
    {
      type: "heading",
      attrs: { level: n },
      content: [{ type: "text", text: `Глава ${n}` }],
    },
    ...Array.from({ length: 25 }, () => p("Длинный текст")),
  ]);
  await doc(page, content);
  const outline = page.getByRole("navigation", { name: "Главы заметки" });
  for (const n of [2, 3, 1]) {
    await outline.hover();
    await outline
      .getByRole("button", { name: `Глава ${n}`, exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).testEditor.state.selection.$from.parent.textContent,
        ),
      )
      .toBe(`Глава ${n}`);
    await expect(
      outline.getByRole("button", { name: `Глава ${n}`, exact: true }),
    ).toHaveAttribute("aria-current", "true");
  }
});

test("copy block anchor persists a stable ID and a duplicate receives a different anchor", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).controller.setNoteURL(
      "http://localhost:3000/notes/9773a298-701f-43c4-b687-e3bcdcc886ec",
    );
    document.addEventListener("copy", (event) => {
      (window as any).copiedAnchor = event.clipboardData?.getData("text/plain");
    });
  });
  await doc(page, [p("Якорь")]);
  await page.locator(".tiptap p").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Скопировать ссылку на блок" })
    .click();
  const anchor = await page.evaluate(() => (window as any).copiedAnchor);
  expect(anchor).toMatch(/#block-[\da-f-]{36}$/);
  const saved = await json(page);
  expect(anchor).toContain(saved.content[0].attrs.blockId);
  await page.locator(".tiptap p").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Дублировать блок" }).click();
  expect((await json(page)).content[1].attrs.blockId).toBeNull();
});

test("native touch adapters expose colors, block types and actions without a desktop toolbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 430 });
  await page.goto("/editor.html");
  await page.evaluate(() => {
    const api = (window as any).doompileEditor;
    api.setTheme("light");
    api.setTouchMode(true);
    api.setDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Touch format" }],
        },
      ],
    });
    api.focus();
  });
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => (window as any).doompileEditor.command("colors"));
  await expect(
    page.getByRole("menu", { name: "Цвет текста и выделения" }),
  ).toBeVisible();
  await expect(page.getByRole("toolbar")).toBeHidden();
  await page
    .getByRole("menuitem", { name: "Цвет текста: Красный", exact: true })
    .click();
  await page.evaluate(() =>
    (window as any).doompileEditor.command("blockType"),
  );
  await page
    .getByRole("menuitem", { name: "Заголовок 2", exact: true })
    .click();
  await expect(page.locator(".tiptap h2")).toHaveText("Touch format");
  await page.evaluate(() =>
    (window as any).doompileEditor.command("blockActions"),
  );
  await page
    .getByRole("menuitem", { name: "Дублировать блок", exact: true })
    .click();
  await expect(page.locator(".tiptap h2")).toHaveText([
    "Touch format",
    "Touch format",
  ]);
});
