import { createNote } from "../../../packages/core/src/index";
import { test, expect, type Page } from "../../../packages/editor/test/web-test";
const id = "d3d0daa0-cc18-4bbf-b8c2-2837b3324ef3";
async function setup(page: Page, populated = true) {
  const notes: any[] = populated
    ? [
        {
          id,
          title: "Мысль для мобильного веба",
          plainText: "Мысль для мобильного веба",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Мысль для мобильного веба" }],
              },
            ],
          },
          tags: ["Идеи"],
          pinned: false,
          urgent: false,
          kind: "note",
          attachments: [],
          createdAt: "2026-10-31T10:00:00.000Z",
          updatedAt: "2026-10-31T10:00:00.000Z",
          revision: 1,
          deletedAt: null,
        },
      ]
    : [];
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes } }),
  );
  await page.route("**/api/notes/*", async (route) => {
    const { note } = route.request().postDataJSON();
    const saved = { ...note, revision: note.revision + 1 };
    const i = notes.findIndex((n) => n.id === note.id);
    if (i < 0) notes.push(saved);
    else notes[i] = saved;
    await route.fulfill({ json: { note: saved } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toBeVisible();
  return notes;
}
async function swipe(page: Page, selector: string, dx: number, dy = 0) {
  const row = page.locator(selector).first();
  await row.dispatchEvent("touchstart", {
    touches: [{ clientX: 250, clientY: 250 }],
  });
  await row.dispatchEvent("touchmove", {
    touches: [{ clientX: 250 + dx, clientY: 250 + dy }],
  });
  await row.dispatchEvent("touchend", {
    touches: [],
    changedTouches: [{ clientX: 250 + dx, clientY: 250 + dy }],
  });
}
test("mobile capture, document tools, keyboard viewport and save on close", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  const notes = await setup(page, false);
  await expect(page.locator(".mobile-welcome")).toBeVisible();
  expect(
    await page
      .locator(".mobile-tools")
      .evaluate((e) => getComputedStyle(e).clipPath),
  ).toBe("inset(50%)");
  const input = page.getByRole("textbox", { name: "Быстрая заметка" });
  await input.fill("Непустой быстрый черновик");
  await input.press("Enter");
  await expect(input).toHaveValue("Непустой быстрый черновик\n");
  expect(notes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  const text = page.getByRole("textbox", { name: "Текст заметки" });
  await expect(text).toBeVisible();
  await expect(text).toBeFocused();
  await expect(
    page.getByRole("toolbar", { name: "Инструменты редактора" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Чеклист", exact: true }).click();
  await expect(page.locator("ul[data-type=taskList]")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 480 });
  await expect
    .poll(() =>
      page
        .locator(".mobile-editor-tools")
        .evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight + 1),
    )
    .toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: "test-results/mobile-web/iphone-editor.png",
  });
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(text).toHaveCount(0);
  await expect.poll(() => notes.length).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: "disabled",
    path: "test-results/mobile-web/iphone-home.png",
  });
});
test("mobile gestures, actions, sidebar search and reading without keyboard", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  await setup(page);
  await expect(page.locator(".note-main")).toHaveCount(1);
  await swipe(page, ".mobile-row-content", -120, 120);
  await expect(page.locator(".mobile-note-row")).toHaveAttribute(
    "data-revealed",
    "false",
  );
  await swipe(page, ".mobile-row-content", -120);
  await expect(
    page.getByRole("button", { name: "Закрепить заметку", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрепить заметку", exact: true })
    .click();
  await expect(page.locator(".feed-section")).toContainText("Закреплено");
  await page.locator(".note-main").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).not.toBeFocused();
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toHaveCount(0);
  const shell = page.locator(".app-shell");
  await shell.dispatchEvent("touchstart", {
    touches: [{ clientX: 8, clientY: 300 }],
  });
  await shell.dispatchEvent("touchend", {
    changedTouches: [{ clientX: 150, clientY: 300 }],
  });
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await expect(
    page.getByRole("textbox", { name: "Поиск заметок" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "test-results/mobile-web/iphone-sidebar.png",
  });
});
test("desktop retains its composer and side editor without mobile controls", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  await setup(page);
  await expect(page.locator(".mobile-compose-plus")).toBeHidden();
  await page.locator(".note-main").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeVisible();
  await expect(page.locator(".mobile-editor-tools")).toBeHidden();
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect(page.locator(".note-main")).toBeVisible();
});

test("mobile tags persist without a blank note and remain editable in the header", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  const notes = await setup(page);
  const reveal = async () => {
    const shell = page.locator(".app-shell");
    await shell.dispatchEvent("touchstart", {
      touches: [{ clientX: 8, clientY: 300 }],
    });
    await shell.dispatchEvent("touchend", {
      changedTouches: [{ clientX: 150, clientY: 300 }],
    });
    await expect(page.locator(".sidebar")).toHaveClass(/open/);
  };
  await reveal();
  await page.getByRole("button", { name: "Новый тег", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название тега", exact: true })
    .fill("На потом");
  await page.getByRole("button", { name: "Создать тег", exact: true }).click();
  expect(notes).toHaveLength(1);
  await expect(
    page.getByRole("region", { name: "Редактор заметки" }),
  ).toHaveCount(0);
  await page.reload();
  await reveal();
  await expect(
    page.getByRole("button", { name: "На потом 0", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Все заметки 1", exact: true })
    .click();
  await page.locator(".note-main").click();
  await page.getByRole("button", { name: "Добавить тег", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Убрать тег Идеи", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Найти или создать тег" })
    .fill("На потом");
  await page.getByRole("option", { name: "На потом", exact: true }).click();
  await page
    .getByRole("button", { name: "Убрать тег Идеи", exact: true })
    .click();
  await page.getByRole("button", { name: "Закрыть выбор тегов" }).click();
  await page.getByRole("textbox", { name: "Текст заметки" }).click();
  await page
    .getByRole("button", { name: "Закрыть редактор", exact: true })
    .click();
  await expect.poll(() => notes[0].tags).toEqual(["На потом"]);
});

test("mobile swipe can close, reopen, make important and delete with undo in dark appearance", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page);
  await swipe(page, ".mobile-row-content", -130);
  await swipe(page, ".mobile-row-content", 140);
  await expect(page.locator(".mobile-note-row")).toHaveAttribute(
    "data-revealed",
    "false",
  );
  await swipe(page, ".mobile-row-content", -130);
  await page
    .getByRole("button", { name: "Отметить заметку важной", exact: true })
    .click();
  await expect(page.locator(".urgent-card")).toBeVisible();
  await swipe(page, ".mobile-row-content", -130);
  await page
    .getByRole("button", { name: "Удалить заметку свайпом", exact: true })
    .click();
  await expect(page.locator(".urgent-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.locator(".urgent-card")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "test-results/mobile-web/iphone-dark.png",
  });
});

test("offline notes saved in separate tabs remain durable", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  await setup(page, false);
  const second = await context.newPage();
  await setup(second, false);
  await context.setOffline(true);
  for (const [tab, text] of [
    [page, "Offline A"],
    [second, "Offline B"],
  ] as const) {
    const input = tab.getByRole("textbox", { name: "Быстрая заметка" });
    await input.fill(text);
    await tab
      .getByRole("button", { name: "Сохранить заметку", exact: true })
      .click();
    await expect(input).toHaveValue("");
  }
  await page.close();
  const durable = await second.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const request = db
          .transaction("records")
          .objectStore("records")
          .getAll();
        request.onsuccess = () =>
          resolve(request.result.map((row) => row.note.plainText));
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
  expect(durable).toEqual(expect.arrayContaining(["Offline A", "Offline B"]));
});

test("legacy IndexedDB pending notes migrate atomically and only once", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  const legacy = createNote({ plainText: "Legacy offline note" });
  await page.route("**/seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/seed");
  await page.evaluate(async (note) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(
          { [note.id]: { note, baseRevision: 0, dirty: true } },
          "notes",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, legacy);
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [] } }),
  );
  await page.route("**/api/notes/*", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline fixture" } }),
  );
  await page.goto("/");
  await expect(
    page.locator(".note-row").filter({ hasText: "Legacy offline note" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".note-row").filter({ hasText: "Legacy offline note" }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const request = db
          .transaction("records")
          .objectStore("records")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
  expect(result).toHaveLength(1);
  expect(result[0].note.id).toBe(legacy.id);
  expect(result[0].dirty).toBe(true);
  expect(result[0].baseRevision).toBe(0);
});
