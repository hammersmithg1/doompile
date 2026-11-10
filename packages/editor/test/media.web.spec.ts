import { test, expect, mockMicrophone, type Page } from "./web-test";
const firstID = "a6ad6431-ad38-4533-92a0-c337487ef00b";
const file = (
  name: string,
  mimeType = "text/plain",
  id = "d8e1a8cd-60a1-4a1c-b3fa-e76f79646ee7",
) => ({ id, url: `/api/attachments/${id}`, name, mimeType, size: 400 });
const findNode = (body: any, type: string): any =>
  body?.type === type
    ? body
    : body?.content?.map((node: any) => findNode(node, type)).find(Boolean);
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
async function setup(
  page: Page,
  content?: any[],
  attachments: any[] = [],
  source?: any,
) {
  const notes: any[] = content
    ? [
        {
          id: firstID,
          title: "Медиа",
          body: { type: "doc", content },
          plainText: "Медиа",
          tags: ["Идеи"],
          pinned: false,
          urgent: false,
          kind: "note",
          attachments,
          source,
          createdAt: "2026-10-30T00:00:00.000Z",
          updatedAt: "2026-10-30T00:00:00.000Z",
          revision: 0,
          deletedAt: null,
        },
      ]
    : [];
  const writes: any[] = [],
    uploads: any[] = [];
  let failUpload = false;
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: notes.filter((note) => !note.deletedAt) } }),
  );
  await page.route("**/api/notes/*", async (route) => {
    const { note } = route.request().postDataJSON();
    const saved = {
      ...note,
      revision: (notes.find((item) => item.id === note.id)?.revision || 0) + 1,
    };
    const index = notes.findIndex((item) => item.id === saved.id);
    if (index < 0) notes.push(saved);
    else notes[index] = saved;
    writes.push(saved);
    await route.fulfill({ json: { note: saved } });
  });
  await page.route("**/api/attachments", async (route) => {
    uploads.push(route.request().postDataBuffer());
    if (failUpload)
      await route.fulfill({ status: 503, json: { error: "offline" } });
    else
      await route.fulfill({
        json: { attachment: file("Голосовая заметка.wav", "audio/wav",
          route.request().headers()["x-doompile-upload-id"]) },
      });
  });
  await page.goto("/");
  if (content) {
    await page
      .locator(".note-main")
      .first()
      .click({ position: { x: 10, y: 10 } });
    await expect(
      page.getByRole("textbox", { name: "Текст заметки" }),
    ).toBeVisible();
  }
  return {
    writes,
    notes,
    uploads,
    fail(value: boolean) {
      failUpload = value;
    },
  };
}

test("opening a cached note follows the newer server copy without autosaving the old document", async ({
  page,
}) => {
  const image = file("Preview.svg", "image/svg+xml");
  await page.route(`**${image.url}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"/>',
    }),
  );
  const app = await setup(
    page,
    [
      paragraph("Локальная копия"),
      { type: "image", attrs: { src: image.url } },
    ],
    [image],
  );
  await page.waitForTimeout(800);
  expect(app.writes).toHaveLength(0);
  app.notes[0] = {
    ...app.notes[0],
    revision: 4,
    body: {
      type: "doc",
      content: [paragraph("Сохранено на другом устройстве")],
    },
    plainText: "Сохранено на другом устройстве",
  };
  let release!: () => void;
  const remote = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/notes", async (route) => {
    await remote;
    await route.fulfill({ json: { notes: app.notes } });
  });
  const editor = page.getByRole("textbox", { name: "Текст заметки" });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toContainText("Локальная копия");
  } finally {
    release();
  }
  await expect(editor).toContainText("Сохранено на другом устройстве");
  await page.waitForTimeout(800);
  expect(app.writes).toHaveLength(0);
  await editor.press("ControlOrMeta+End");
  await page.keyboard.type(" + новая правка");
  await expect
    .poll(() => app.writes.at(-1)?.plainText)
    .toContain("новая правка");
  expect(app.writes.at(-1).plainText).toContain(
    "Сохранено на другом устройстве",
  );
});
async function expand(page: Page) {
  await page
    .getByRole("button", { name: "Развернуть редактор", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
}
async function drop(page: Page, selector: string, name: string) {
  await page.locator(selector).evaluate((element, name) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["file data"], name, { type: "text/plain" }),
    );
    element.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    element.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  }, name);
}

test("rich HTML copies media into another note without upload hints or missing attachment metadata", async ({
  page,
}) => {
  const image = file("Photo.svg", "image/svg+xml"),
    attachment = file(
      "report.pdf",
      "application/pdf",
      "d8e1a8cd-60a1-4a1c-b3fa-e76f79646ee8",
    );
  await page.route(`**${image.url}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="80"><rect width="140" height="80" fill="skyblue"/></svg>',
    }),
  );
  const app = await setup(
    page,
    [
      paragraph("Медиа"),
      {
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              ...image,
              src: image.url,
              alt: image.name,
              width: 140,
              height: 80,
            },
          },
          { type: "attachment", attrs: attachment },
        ],
      },
    ],
    [image, attachment],
  );
  await page.keyboard.press("ControlOrMeta+a");
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector(".tiptap")!.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      html: data.getData("text/html"),
      text: data.getData("text/plain"),
    };
  });
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expand(page);
  await page.evaluate(({ html, text }) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", text);
    document.querySelector(".tiptap")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copied);
  await expect(
    page.locator(".tiptap img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
  await expect(page.locator(".tiptap .attachment-card")).toContainText(
    "report.pdf",
  );
  await expect(page.locator(".editor-feedback")).toHaveCount(0);
  await expect
    .poll(
      () => app.writes.find((note) => note.id !== firstID)?.attachments.length,
    )
    .toBe(2);
});

test("pasting an embedded image saves a readable attachment and feed preview", async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const file = init?.body instanceof FormData ? init.body.get("file") : null;
      if (file instanceof File) {
        const reader = new FileReader();
        reader.onload = () => { (window as any).uploadedImage = reader.result; };
        reader.readAsDataURL(file);
      }
      return fetch(input, init);
    };
  });
  const app = await setup(page);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV4sAAAAASUVORK5CYII=";
  const image = file("Изображение.png", "image/png");
  await page.route("**/api/attachments", (route) => route.fulfill({ json: { attachment: image } }));
  await page.route(`**${image.url}`, (route) => route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") }));
  await expand(page);
  const editor = page.getByRole("textbox", { name: "Текст заметки" });
  await editor.evaluate((element, png) => {
    const data = new DataTransfer();
    data.setData("text/html", `<img src=data:image/png;base64,${png}>`);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
  await expect.poll(() => editor.getByRole("img", { name: image.name }).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).uploadedImage)).toBe(`data:image/png;base64,${png}`);
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expect.poll(() => app.writes.at(-1)?.attachments).toEqual([image]);
  await expect(page.locator(".snippet-attachments").getByRole("img", { name: image.name })).toBeVisible();
});

test("command aliases are reachable from application settings and work in a fresh composer", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Команды и алиасы редактора", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Настройки команд редактора",
  });
  await settings.getByLabel("Чеклист", { exact: false }).fill("дела");
  await settings.getByRole("button", { name: "Сохранить настройки" }).click();
  await expand(page);
  await page.keyboard.type("/дела");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Проверка");
  await expect(
    page.locator('.tiptap ul[data-type="taskList"] > li > div p'),
  ).toHaveText("Проверка");
});

test("first-line toolbar stays clear of text in sidebar and expanded note", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page, [paragraph("Медиа")]);
  await page.keyboard.press("ControlOrMeta+a");
  const toolbar = page.getByRole("toolbar");
  const checkPlacement = async () => {
    await expect(toolbar).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await toolbar.boundingBox())!;
        const text = (await page.locator(".tiptap > p").first().boundingBox())!;
        return box.y - (text.y + text.height);
      })
      .toBeGreaterThanOrEqual(4);
  };
  await checkPlacement();
  await page
    .getByRole("button", { name: "Развернуть заметку", exact: true })
    .click();
  await checkPlacement();
  await page.screenshot({ path: info.outputPath("first-line-toolbar.png") });
  await toolbar.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(page.locator(".tiptap strong")).toHaveText("Медиа");
  await page
    .getByRole("button", { name: "Свернуть заметку", exact: true })
    .click();
  await checkPlacement();
});

test("a source-only note autosaves and reopens with its card and metadata", async ({
  page,
}, info) => {
  const app = await setup(page);
  await expand(page);
  await page.keyboard.type("/источник");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Источник с цитатой" });
  await dialog
    .getByLabel("Ссылка", { exact: true })
    .fill("https://example.com/article");
  await dialog
    .getByLabel("Название (необязательно)", { exact: true })
    .fill("Источник");
  await dialog
    .getByLabel("Цитата (необязательно)", { exact: true })
    .fill("Сохранённая цитата");
  await page.screenshot({ path: info.outputPath("source-dialog.png") });
  await dialog.getByRole("button", { name: "Добавить источник" }).click();
  await expect
    .poll(() => app.writes.at(-1)?.source?.quote)
    .toBe("Сохранённая цитата");
  expect(app.notes).toHaveLength(1);
  expect(app.writes.at(-1).title).toBe("Источник");
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expect(page.locator(".note-row .source-snippet")).toHaveCount(1);
  await page
    .locator(".note-main")
    .first()
    .click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".tiptap .source-snippet")).toHaveCount(1);
  await expect(
    page.locator(".tiptap .source-snippet .source-quote"),
  ).toHaveText("Сохранённая цитата");
});

test("slash menu scrolling in a sidebar does not move the surrounding note", async ({
  page,
}) => {
  await setup(page, [
    ...Array.from({ length: 30 }, (_, i) => paragraph(`Строка ${i}`)),
    paragraph(""),
  ]);
  await page.getByRole("textbox", { name: "Текст заметки" }).locator("p").last().click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const note = page.locator(".note-editor-scroll");
  const before = await note.evaluate((element) => element.scrollTop);
  await menu.hover();
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("option", { selected: true })).toHaveText(
    "Настройки команд",
  );
  expect(await note.evaluate((element) => element.scrollTop)).toBe(before);
});

test("quick voice survives expansion and collapse, and stopping only stages the audio", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockMicrophone(page);
  const app = await setup(page);
  const quick = page.locator(".quick-composer");
  const compactText = quick.getByRole("textbox", {
    name: "Быстрая заметка",
  });
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect(page.locator(".quick-recording .recording-live")).toBeVisible();
  await compactText.fill("Текст в инпуте");
  const id = await page
    .locator(".quick-recording [data-recording-id]")
    .getAttribute("data-recording-id");
  await expand(page);
  const inline = page.locator(`.recording-block [data-recording-id="${id}"]`);
  await expect(
    inline.getByRole("button", { name: "Остановить запись", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".header-recording")).toContainText("Запись");
  await expect(
    page.getByRole("button", { name: "Остановить запись в шапке" }),
  ).toHaveCount(0);
  const editorText = page.getByRole("textbox", { name: "Текст заметки" });
  await expect(editorText).toContainText("Текст в инпуте");
  await editorText.press("ControlOrMeta+End");
  await page.keyboard.insertText(" + текст в редакторе");
  await page.getByRole("button", { name: "Свернуть редактор" }).click();
  const snippet = quick.locator(`[data-recording-id="${id}"]`);
  const stop = snippet.getByRole("button", {
    name: "Остановить запись",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await expect(compactText).toHaveValue("Текст в инпуте + текст в редакторе");
  await compactText.fill(
    "Текст в инпуте + текст в редакторе\nТекст после сворачивания",
  );
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics),
  ).toMatchObject({ starts: 1, stops: 0 });
  await stop.click();
  await expect(snippet.locator("audio")).toHaveAttribute("src", /^blob:/);
  const send = quick.getByRole("button", { name: "Сохранить заметку" });
  await expect(send).toBeEnabled();
  expect(app.uploads).toHaveLength(0);
  expect(app.writes).toHaveLength(0);
  await send.click();
  await expect(page.locator(".note-main .attachment-audio")).toBeVisible();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  expect(app.writes.at(-1).plainText).toContain(
    "Текст в инпуте + текст в редакторе",
  );
  expect(app.writes.at(-1).plainText).toContain("Текст после сворачивания");
  expect(app.notes).toHaveLength(1);
  expect(app.uploads).toHaveLength(1);
  expect(JSON.stringify(app.writes.at(-1).body)).not.toContain(
    '"type":"recording"',
  );
});
test("quick send stops and saves a voice-only message", async ({ page }) => {
  await mockMicrophone(page);
  const app = await setup(page);
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect(page.locator(".quick-recording .recording-live")).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.locator(".note-main .attachment-audio")).toBeVisible();
  await expect.poll(() => app.notes.length).toBe(1);
  expect(app.notes[0]).toMatchObject({ kind: "audio", plainText: "" });
  expect(app.notes[0].attachments).toHaveLength(1);
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics),
  ).toMatchObject({ starts: 1, stops: 1 });
});
test("stopping an inline recording on an existing note attaches it to the same note", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page, [paragraph("Медиа")]);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voice");
  await page.keyboard.press("Enter");
  await expect(page.locator(".recording-block")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Остановить запись", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Остановить запись", exact: true })
    .click();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  expect(app.notes).toHaveLength(1);
  expect(app.notes[0].id).toBe(firstID);
  expect(app.notes[0].plainText).toContain("Медиа");
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics.stops),
  ).toBe(1);
});
test("reload restores checkpointed audio without sending and a failed upload can be retried in the feed", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page);
  app.fail(true);
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect(page.locator(".quick-recording .recording-live")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open(
          "doompile-recordings:user:11111111-1111-4111-8111-111111111111",
        );
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const read = db.transaction("drafts").objectStore("drafts").get("active");
          return await new Promise<number>((resolve, reject) => {
            read.onsuccess = () => resolve(read.result?.byteLength || 0);
            read.onerror = () => reject(read.error);
          });
        } finally {
          db.close();
        }
      }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator(".quick-recording audio")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  expect(app.uploads).toHaveLength(0);
  expect(app.writes).toHaveLength(0);
  const send = page.getByRole("button", {
    name: "Сохранить заметку",
    exact: true,
  });
  await send.click();
  const row = page.locator(".note-main");
  await expect(row).toContainText("Не удалось загрузить");
  const retry = row.getByRole("button", { name: /Повторить загрузку/ });
  await expect(retry).toBeVisible();
  expect(app.uploads).toHaveLength(1);
  expect(app.writes).toHaveLength(0);
  await expect(page.locator(".quick-recording")).toHaveCount(0);
  app.fail(false);
  await retry.click();
  await expect(page.locator(".note-main .attachment-audio")).toBeVisible();
  expect(app.uploads).toHaveLength(2);
  await expect.poll(() => app.notes.length).toBe(1);
});
test("audio and files use the same controls and styles in the feed and editor", async ({
  page,
}, info) => {
  const audio = file("Voice.wav", "audio/wav"),
    document = file(
      "Report.pdf",
      "application/pdf",
      "f9b18e74-bb1d-4918-8fd5-42f60eafc12c",
    );
  await setup(
    page,
    [
      paragraph("Медиа"),
      { type: "attachment", attrs: audio },
      { type: "attachment", attrs: document },
      { type: "paragraph" },
    ],
    [audio, document],
  );
  const feed = page.locator(".note-main"),
    editor = page.locator(".note-editor-surface");
  await expect(feed.locator(".attachment-audio .audio-play")).toHaveCount(1);
  await expect(editor.locator(".attachment-audio .audio-play")).toHaveCount(1);
  const cardStyle = (element: Element) => {
    const css = getComputedStyle(element);
    return {
      height: css.minHeight,
      border: css.borderRadius,
      font: css.fontFamily,
      color: css.color,
      background: css.backgroundColor,
    };
  };
  expect(await feed.locator(".attachment-card").evaluate(cardStyle)).toEqual(
    await editor.locator(".attachment-card").evaluate(cardStyle),
  );
  await expect(editor.locator(".attachment-info small")).toHaveText(
    (await feed.locator(".attachment-info small").textContent()) || "",
  );
  expect(await feed.locator(".audio-download").evaluate(cardStyle)).toEqual(
    await editor.locator(".audio-download").evaluate(cardStyle),
  );
  await page.screenshot({ path: info.outputPath("shared-media.png") });
});
test("image resize keeps aspect ratio, autosaves dimensions and survives reopening", async ({
  page,
}) => {
  const image = file("Photo.svg", "image/svg+xml");
  await page.route(`**${image.url}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="skyblue"/></svg>',
    }),
  );
  const app = await setup(
    page,
    [
      paragraph("Медиа"),
      {
        type: "image",
        attrs: { src: image.url, alt: image.name, width: 320, height: 213 },
      },
      { type: "paragraph" },
    ],
    [image],
  );
  await page.locator(".tiptap img:not(.ProseMirror-separator)").hover();
  const handle = page.locator('[data-resize-handle="bottom-right"]');
  await expect(handle).toBeVisible();
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 90, bounds.y - 60, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => findNode(app.writes.at(-1)?.body, "image")?.attrs.width)
    .toBeLessThan(320);
  const dimensions = findNode(app.writes.at(-1).body, "image").attrs;
  expect(Math.abs(dimensions.width / dimensions.height - 1.5)).toBeLessThan(
    0.05,
  );
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await page
    .locator(".note-main")
    .first()
    .click({ position: { x: 10, y: 10 } });
  await expect
    .poll(async () =>
      Math.round(
        (await page
          .locator(".tiptap img:not(.ProseMirror-separator)")
          .boundingBox())!.width,
      ),
    )
    .toBe(dimensions.width);
});
test("editor padding/header drops go to the note; quick drops stay in the quick composer", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const app = await setup(page, [paragraph("Медиа")]);
  await page.route("**/api/attachments", (route) => {
    const id = route.request().headers()["x-doompile-upload-id"];
    return route.fulfill({
      json: { attachment: file(id ? "quick.txt" : "note.txt", "text/plain", id) },
    });
  });
  await drop(page, ".note-editor-header", "note.txt");
  await expect(
    page.locator(".note-editor-surface .attachment-card"),
  ).toContainText("note.txt");
  await expect(page.locator(".draft-attachment")).toHaveCount(0);
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  const pane = page.getByRole("complementary", { name: "Просмотр заметки" });
  await pane.evaluate((element) => {
    const animate = element.animate.bind(element);
    element.animate = (...args) => {
      const animation = animate(...args);
      animation.pause();
      animation.currentTime = 120;
      element.setAttribute("data-close-paused", "");
      return animation;
    };
  });
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expect(pane).toHaveAttribute("data-close-paused", "");
  try {
    await drop(page, ".quick-composer", "quick.txt");
    await expect(page.locator(".draft-attachment")).toContainText("quick.txt");
    await page.screenshot({
      path: test.info().outputPath("drop-during-editor-close.png"),
    });
  } finally {
    await pane.evaluate((element) =>
      element.getAnimations().forEach((animation) => animation.finish()),
    );
  }
  await expect(pane).toHaveCount(0);
  await expect(page.locator(".draft-attachment")).toContainText("quick.txt");
});
test("a quick attachment finishing upload after expansion stays in the expanded document", async ({
  page,
}) => {
  const app = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/attachments", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({
      json: { attachment: file("pending.pdf", "application/pdf",
        route.request().headers()["x-doompile-upload-id"]) },
    });
  });
  await drop(page, ".quick-composer", "pending.pdf");
  await expect.poll(() => requested).toBe(true);
  await expand(page);
  release();
  await expect(
    page.locator(".note-editor-surface .attachment-card"),
  ).toContainText("pending.pdf");
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
});

test("expanded send saves text, a pending file and active voice in one note", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/attachments", async (route) => {
    const pendingFile = !requested;
    if (pendingFile) {
      requested = true;
      await gate;
    }
    await route.fulfill({
      json: {
        attachment: pendingFile
          ? file(
              "pending.pdf",
              "application/pdf",
              route.request().headers()["x-doompile-upload-id"],
            )
          : file("Голосовая заметка.wav", "audio/wav",
              route.request().headers()["x-doompile-upload-id"]),
      },
    });
  });
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect(page.locator(".quick-recording .recording-live")).toBeVisible();
  await drop(page, ".quick-composer", "pending.pdf");
  await expect.poll(() => requested).toBe(true);
  await expand(page);
  await expect(page.locator(".recording-block")).toBeVisible();
  release();
  await expect(
    page.locator(".note-editor-surface .attachment-card"),
  ).toContainText("pending.pdf");
  await expect(page.locator(".recording-block")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Текст заметки" })
    .press("ControlOrMeta+End");
  await page.keyboard.insertText("Текст при записи");
  expect(app.writes).toHaveLength(0);
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics.stops),
  ).toBe(0);
  await page
    .locator(".note-editor-surface")
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.locator(".note-main .attachment-audio")).toBeVisible();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(2);
  const body = JSON.stringify(app.writes.at(-1).body);
  expect(body).toContain("pending.pdf");
  expect(body).toContain("Голосовая заметка.wav");
  expect(body).not.toContain('"type":"recording"');
  expect(app.writes.at(-1).plainText).toContain("Текст при записи");
  expect(app.notes).toHaveLength(1);
});

test("an interrupted editor recording recovers in its original note without losing text", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page, [paragraph("Медиа")]);
  app.fail(true);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voice");
  await page.keyboard.press("Enter");
  await expect(page.locator(".recording-block")).toBeVisible();
  await expect
    .poll(() => JSON.stringify(app.writes.at(-1)?.body))
    .toContain('"type":"recording"');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const req = indexedDB.open("doompile-recordings:user:11111111-1111-4111-8111-111111111111");
        return new Promise<number>((resolve) => {
          req.onsuccess = () => {
            const read = req.result
              .transaction("drafts")
              .objectStore("drafts")
              .get("active");
            read.onsuccess = () => resolve(read.result?.byteLength || 0);
          };
        });
      }),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Повторить сохранение" }),
  ).toBeVisible();
  const reopen = page.getByRole("button", {
    name: "Открыть заметку с записью",
  });
  if (await reopen.isVisible()) await reopen.click();
  await expect(page.locator(".recording-block audio")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  app.fail(false);
  await page.getByRole("button", { name: "Повторить сохранение" }).click();
  await expect(page.locator(".tiptap .attachment-audio")).toBeVisible();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  expect(app.notes).toHaveLength(1);
  expect(app.writes.at(-1).plainText).toContain("Медиа");
});

for (const interrupted of [false, true])
  test(`native MediaRecorder produces playable ${interrupted ? "recovered checkpoints" : "stopped audio"}`, async ({
    page, browserName,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const context = new AudioContext();
            const oscillator = context.createOscillator(),
              output = context.createMediaStreamDestination();
            oscillator.frequency.value = 220;
            oscillator.connect(output);
            oscillator.start();
            await context.resume();
            for (const track of output.stream.getTracks()) {
              const stop = track.stop.bind(track);
              track.stop = () => {
                stop();
                void context.close();
              };
            }
            return output.stream;
          },
        },
      });
    });
    const app = await setup(page);
    const recorderAvailable = await page.evaluate(() => typeof MediaRecorder === "function");
    test.skip(browserName === "webkit" && process.platform === "linux" && !recorderAvailable,
      "This Linux WebKit build omits MediaRecorder; macOS CI requires and tests the real codec.");
    expect(recorderAvailable, "The native-codec test requires a real MediaRecorder").toBe(true);
    await page
      .getByRole("button", { name: "Записать голосовую заметку", exact: true })
      .click();
    await expect(page.locator(".recording-live")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const req = indexedDB.open("doompile-recordings:user:11111111-1111-4111-8111-111111111111");
          return new Promise<number>((resolve) => {
            req.onsuccess = () => {
              const read = req.result
                .transaction("drafts")
                .objectStore("drafts")
                .get("active");
              read.onsuccess = () => resolve(read.result?.byteLength || 0);
            };
          });
        }),
      )
      .toBeGreaterThan(500);
    if (interrupted) await page.reload();
    else
      await page
        .getByRole("button", { name: "Остановить запись", exact: true })
        .click();
    await expect(page.locator(".quick-recording audio")).toHaveAttribute(
      "src",
      /^blob:/,
    );
    expect(app.uploads).toHaveLength(0);
    expect(app.writes).toHaveLength(0);
    await page.locator(".quick-recording .audio-play").click();
    await expect
      .poll(() =>
        page
          .locator(".quick-recording audio")
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(0);
  });

test("all snippet types fit a narrow sidebar", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem("doompile-detail-width", "280"),
  );
  const audio = file("Voice.wav", "audio/wav"),
    document = file(
      "Long report filename.pdf",
      "application/pdf",
      "f9b18e74-bb1d-4918-8fd5-42f60eafc12c",
    ),
    image = file(
      "Photo.svg",
      "image/svg+xml",
      "d8ce13ed-9b6a-482c-97b3-aa867f3002ac",
    ),
    video = file(
      "Video.mp4",
      "video/mp4",
      "fdcf41c2-09f3-4b5f-baa1-d060ea42978c",
    );
  await page.route(`**${image.url}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="skyblue"/></svg>',
    }),
  );
  await setup(
    page,
    [
      paragraph("Медиа"),
      {
        type: "sourceSnippet",
        attrs: {
          url: "https://example.com/article",
          title: "Источник",
          quote: "Сохранённая цитата",
        },
      },
      { type: "image", attrs: { src: image.url, width: 320, height: 213 } },
      { type: "attachment", attrs: audio },
      { type: "attachment", attrs: document },
      { type: "attachment", attrs: video },
      { type: "paragraph" },
    ],
    [audio, document, image, video],
    {
      url: "https://example.com/article",
      title: "Источник",
      quote: "Сохранённая цитата",
    },
  );
  const pane = (await page.locator(".note-editor-surface").boundingBox())!;
  for (const selector of [
    ".source-snippet",
    "[data-resize-container]",
    ".attachment-audio",
    ".attachment-card",
    ".attachment-video",
    ".audio-download",
  ]) {
    const rect = (await page
      .locator(`.note-editor-surface ${selector}`)
      .boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(pane.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  }
  const sourceStyle = (element: Element) => {
    const css = getComputedStyle(element);
    return { background: css.backgroundColor, color: css.color };
  };
  expect(
    await page
      .locator(".note-editor-surface .source-snippet")
      .evaluate(sourceStyle),
  ).toEqual(
    await page.locator(".note-main .source-snippet").evaluate(sourceStyle),
  );
  await page.screenshot({ path: info.outputPath("all-snippets-narrow.png") });
});
test("recording controls stay inside a narrow sidebar header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem("doompile-detail-width", "280"),
  );
  await mockMicrophone(page);
  await setup(page, [paragraph("Медиа")]);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voice");
  await page.keyboard.press("Enter");
  await expect(page.locator(".header-recording")).toBeVisible();
  const header = (await page.locator(".note-editor-header").boundingBox())!;
  for (const selector of [".header-recording", ".note-editor-actions"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(header.x);
    expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
  }
  await page.getByRole("button", { name: "Остановить запись в шапке" }).click();
});
