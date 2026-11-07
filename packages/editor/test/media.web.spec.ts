import { test, expect, type Page } from "./web-test";
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
        json: { attachment: file("Голосовая заметка.wav", "audio/wav") },
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
async function mockMicrophone(page: Page) {
  await page.addInitScript(() => {
    const metrics = { starts: 0, stops: 0, tracksStopped: 0 };
    (window as any).microphoneMetrics = metrics;
    // A valid PCM WAV chunk makes local recovery/playback exercise real media elements.
    function wav() {
      const bytes = new ArrayBuffer(844),
        v = new DataView(bytes);
      const text = (offset: number, value: string) =>
        Array.from(value).forEach((c, i) =>
          v.setUint8(offset + i, c.charCodeAt(0)),
        );
      text(0, "RIFF");
      v.setUint32(4, 836, true);
      text(8, "WAVEfmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true);
      v.setUint32(28, 16000, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      text(36, "data");
      v.setUint32(40, 800, true);
      return new Blob([bytes], { type: "audio/wav" });
    }
    class Recorder {
      state = "inactive";
      mimeType = "audio/wav";
      timer: any;
      ondataavailable: any;
      onstop: any;
      onerror: any;
      start(slice: number) {
        this.state = "recording";
        metrics.starts++;
        this.timer = setInterval(() => this.requestData(), slice);
      }
      requestData() {
        this.ondataavailable?.({ data: wav() });
      }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        clearInterval(this.timer);
        metrics.stops++;
        this.requestData();
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                metrics.tracksStopped++;
              },
            },
          ],
        }),
      },
    });
    (window as any).MediaRecorder = Recorder;
  });
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

test("quick voice survives expansion and stops from the sticky header into the same note", async ({
  page,
}, info) => {
  await mockMicrophone(page);
  const app = await setup(page);
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect(page.locator(".quick-recording .recording-live")).toBeVisible();
  const id = await page
    .locator(".quick-recording [data-recording-id]")
    .getAttribute("data-recording-id");
  await expand(page);
  await expect(
    page.locator(`.recording-block [data-recording-id="${id}"]`),
  ).toBeVisible();
  await expect(page.locator(".header-recording")).toContainText("Запись");
  await page.screenshot({ path: info.outputPath("recording-inline.png") });
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics.starts),
  ).toBe(1);
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics.stops),
  ).toBe(0);
  await page.getByRole("button", { name: "Остановить запись в шапке" }).click();
  await expect(page.locator(".header-recording")).toHaveCount(0);
  await expect(page.locator(".tiptap .attachment-audio")).toBeVisible();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  expect(app.notes).toHaveLength(1);
  expect(JSON.stringify(app.writes.at(-1).body)).not.toContain(
    '"type":"recording"',
  );
});
test("slash voice shows an inline snippet and both stop buttons stop the same session", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page);
  await expand(page);
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
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
  expect(
    await page.evaluate(() => (window as any).microphoneMetrics.stops),
  ).toBe(1);
});
test("a reload restores checkpointed audio and a failed upload remains retryable", async ({
  page,
}) => {
  await mockMicrophone(page);
  const app = await setup(page);
  app.fail(true);
  await page
    .getByRole("button", { name: "Записать голосовую заметку", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("doompile-recordings:user:11111111-1111-4111-8111-111111111111");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const read = db
          .transaction("drafts")
          .objectStore("drafts")
          .get("active");
        return new Promise<number>((resolve) => {
          read.onsuccess = () =>
            resolve(read.result?.blob?.size || read.result?.byteLength || 0);
        });
      }),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Повторить сохранение" }),
  ).toBeVisible();
  await expect(page.locator(".quick-recording audio")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  app.fail(false);
  await page.getByRole("button", { name: "Повторить сохранение" }).click();
  await expect(page.locator(".note-main .attachment-audio")).toBeVisible();
  await expect(page.locator(".quick-recording")).toHaveCount(0);
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
  const app = await setup(page, [paragraph("Медиа")]);
  await drop(page, ".note-editor-header", "note.txt");
  await expect(
    page.locator(".note-editor-surface .attachment-audio"),
  ).toBeVisible();
  await expect(page.locator(".draft-attachment")).toHaveCount(0);
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(1);
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await drop(page, ".quick-composer", "quick.txt");
  await expect(page.locator(".draft-attachment")).toHaveCount(1);
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
      json: { attachment: file("pending.pdf", "application/pdf") },
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

test("a pending file and active voice both survive expansion into the same document", async ({
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
    const pendingFile = route
      .request()
      .postDataBuffer()
      ?.includes(Buffer.from("pending.pdf"));
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
              "d8e1a8cd-60a1-4a1c-b3fa-e76f79646ee8",
            )
          : file("Голосовая заметка.wav", "audio/wav"),
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
  await page.getByRole("button", { name: "Остановить запись в шапке" }).click();
  await expect(page.locator(".tiptap .attachment-audio")).toBeVisible();
  await expect.poll(() => app.writes.at(-1)?.attachments.length).toBe(2);
  const body = JSON.stringify(app.writes.at(-1).body);
  expect(body).toContain("pending.pdf");
  expect(body).toContain("Голосовая заметка.wav");
  expect(body).not.toContain('"type":"recording"');
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
    app.fail(true);
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
        .getByRole("button", { name: "Завершить запись голосовой заметки" })
        .click();
    await expect(
      page.getByRole("button", { name: "Повторить сохранение" }),
    ).toBeVisible();
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
