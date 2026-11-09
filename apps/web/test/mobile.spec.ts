import { createNote } from "../../../packages/core/src/index";
import {
  test,
  expect,
  type Page,
} from "../../../packages/editor/test/web-test";
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
  await dispatchTouch(page, selector, "start", 250, 250);
  await dispatchTouch(page, selector, "move", 250 + dx, 250 + dy);
  await dispatchTouch(page, selector, "end", 250 + dx, 250 + dy);
}
function sidebarTouch(page: Page, type: "start" | "move" | "end" | "cancel", x: number, y = 300) {
  return dispatchTouch(page, ".app-shell", type, x, y);
}
async function dispatchTouch(
  page: Page,
  selector: string,
  type: "start" | "move" | "end" | "cancel",
  x: number,
  y: number,
) {
  return page.locator(selector).first().evaluate((target, { type, x, y }) => {
    const touch = { identifier: 1, clientX: x, clientY: y };
    const event = new Event(`touch${type}`, { bubbles: true, cancelable: true });
    Object.assign(event, {
      touches: type === "end" || type === "cancel" ? [] : [touch],
      changedTouches: [touch],
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, { type, x, y });
}

test("mobile feed keeps text and timestamps inside swipe wrappers at narrow widths", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  await setup(page);
  await expect(page.locator(".mobile-note-row")).toHaveCount(1);
  for (const width of [320, 390, 430, 740]) {
    await page.setViewportSize({ width, height: 740 });
    const bounds = await page.locator(".mobile-note-row").evaluate((row) => {
      const clip = row.getBoundingClientRect();
      return [
        ...row.querySelectorAll(".note-row, .note-preview-text, .row-time"),
      ].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left - clip.left, right: clip.right - rect.right };
      });
    });
    expect(bounds).toHaveLength(3);
    for (const bound of bounds) {
      expect(bound.left).toBeGreaterThanOrEqual(0);
      expect(bound.right).toBeGreaterThanOrEqual(0);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-web/iphone-feed-edges.png",
  });
});

test("sidebar follows the finger, reverses, cancels and settles using release momentum", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  await setup(page);
  const panel = page.locator(".sidebar");
  const surface = page.locator(".main-column");
  const left = () => surface.evaluate((e) => e.getBoundingClientRect().left);
  await expect.poll(left).toBe(0);
  await sidebarTouch(page, "start", 8);
  expect(await sidebarTouch(page, "move", 88)).toBe(true);
  expect(await left()).toBeCloseTo(80, 0);
  expect((await panel.boundingBox())?.x).toBe(0);
  const firstOpacity = await page
    .locator(".sidebar-scrim")
    .evaluate((e) => Number(getComputedStyle(e).opacity));
  expect(await sidebarTouch(page, "move", 138, 442)).toBe(true);
  expect(await left()).toBeCloseTo(130, 0);
  expect(
    await page
      .locator(".sidebar-scrim")
      .evaluate((e) => Number(getComputedStyle(e).opacity)),
  ).toBeGreaterThan(firstOpacity);
  await sidebarTouch(page, "move", 58);
  expect(await left()).toBeCloseTo(50, 0);
  await sidebarTouch(page, "cancel", 58);
  await expect.poll(left).toBe(0);
  await expect(panel).not.toHaveClass(/open/);

  // A vertical edge gesture stays a scroll, even with substantial horizontal drift.
  await sidebarTouch(page, "start", 8);
  expect(await sidebarTouch(page, "move", 120, 470)).toBe(false);
  expect(await sidebarTouch(page, "move", 248, 470)).toBe(false);
  expect(await left()).toBe(0);
  await sidebarTouch(page, "end", 120, 470);
  await expect(panel).not.toHaveClass(/open/);

  // A short fast flick opens even before half the panel has been exposed.
  await page.locator(".app-shell").evaluate((root) => {
    for (const [type, x] of [
      ["start", 8],
      ["move", 53],
      ["end", 53],
    ] as const) {
      const touch = { identifier: 1, clientX: x, clientY: 300 };
      // Linux WebKit does not expose a constructible Touch class.
      const event = new Event(`touch${type}`, { bubbles: true, cancelable: true });
      Object.assign(event, {
        touches: type === "end" ? [] : [touch],
        changedTouches: [touch],
      });
      root.dispatchEvent(event);
    }
  });
  await expect(panel).toHaveClass(/open/);
  await expect.poll(left).toBe(310);
  await expect(surface).toHaveAttribute("inert", "");
  await expect(surface).toHaveCSS("border-top-left-radius", "28px");
  await expect(surface).toHaveCSS("overflow", "clip");
  await sidebarTouch(page, "start", 250);
  await sidebarTouch(page, "move", 190);
  expect(await left()).toBeCloseTo(250, 0);
  await sidebarTouch(page, "cancel", 190);
  await expect.poll(left).toBe(310);

  await sidebarTouch(page, "start", 250);
  await sidebarTouch(page, "move", 50);
  await sidebarTouch(page, "end", 50);
  await expect.poll(left).toBe(0);
  await expect(surface).not.toHaveAttribute("inert", "");
  await expect(page.locator(".sidebar-scrim")).toBeHidden();

  // Respect reduced motion while keeping direct manipulation available.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sidebarTouch(page, "start", 8);
  await sidebarTouch(page, "move", 248);
  expect(await left()).toBeCloseTo(240, 0);
  await sidebarTouch(page, "end", 248);
  expect(await left()).toBe(310);
  await page
    .getByRole("button", { name: "Закрыть навигацию" })
    .click();
  expect(await left()).toBe(0);

  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  expect(await left()).toBe(310);
  await expect(page.getByRole("textbox", { name: "Поиск заметок" })).toBeVisible();
});

test("horizontal drawer and row gestures keep a long feed still while vertical swipes scroll", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const notes = await setup(page);
  for (let i = 0; i < 25; i++) notes.push(createNote({ plainText: `Длинная лента ${i}`, revision: 1 }));
  await page.reload();
  await expect(page.locator(".mobile-note-row")).toHaveCount(26);
  const feed = page.locator(".main-scroll");
  const scroll = () => feed.evaluate((element) => element.scrollTop);
  async function drag(points: [number, number][]) {
    const [[x, y], ...moves] = points;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const [x, y] of moves) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  await drag([[8, 310], [24, 308], [95, 251], [160, 170]]);
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  expect(await scroll()).toBe(0);
  await page.getByRole("button", { name: "Закрыть меню", exact: true }).click();
  await expect(page.locator(".sidebar-scrim")).toBeHidden();

  const row = page.locator(".mobile-note-row").first();
  const rect = (await row.boundingBox())!;
  const y = Math.round(rect.y + rect.height / 2);
  await drag([[270, y], [254, y - 2], [194, y - 61], [140, y - 100]]);
  await expect(row).toHaveAttribute("data-revealed", "true");
  expect(await scroll()).toBe(0);
  await drag([[115, y], [135, y], [212, y], [265, y]]);
  await expect(row).toHaveAttribute("data-revealed", "false");

  await drag([[235, 505], [231, 481], [202, 414], [170, 330]]);
  await expect.poll(scroll).toBeGreaterThan(50);
  await expect(page.locator(".mobile-note-row[data-revealed=true]")).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await expect(page.getByRole("button", { name: "Открыть меню", exact: true })).toBeInViewport();
});

test("Safari keyboard geometry updates in the same frame and restores after dismissal", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  await page.addInitScript(() => {
    const viewport = window.visualViewport!;
    const geometry = { height: innerHeight, offsetTop: 0, scale: 1 };
    for (const key of ["height", "offsetTop", "scale"] as const)
      Object.defineProperty(viewport, key, { get: () => geometry[key] });
    (window as any).setTestViewport = (next: Partial<typeof geometry>) => {
      Object.assign(geometry, next);
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    };
  });
  await setup(page);
  const input = page.getByRole("textbox", { name: "Быстрая заметка" });
  await input.fill("Черновик остаётся на месте");
  expect(
    await page.locator("body").evaluate((e) => getComputedStyle(e).position),
  ).toBe("fixed");
  const fullHeight = await page.evaluate(() => innerHeight);
  for (const [height, top] of [
    [fullHeight - 180, 90],
    [fullHeight - 260, 65],
    [fullHeight - 320, 0],
    [fullHeight - 260, 65],
    [fullHeight - 180, 90],
  ]) {
    // Measure immediately after the event, before the next animation frame.
    const bounds = await page.evaluate(
      ({ height, top }) => {
        (window as any).setTestViewport({ height, offsetTop: top });
        const shell = document
          .querySelector(".app-shell")!
          .getBoundingClientRect();
        const composer = document
          .querySelector(".quick-composer")!
          .getBoundingClientRect();
        return {
          top: shell.top,
          bottom: shell.bottom,
          gap: shell.bottom - composer.bottom,
          keyboard: document.documentElement.dataset.keyboard,
        };
      },
      { height, top },
    );
    expect(bounds.keyboard).toBe("true");
    expect(bounds.top).toBe(top);
    expect(bounds.bottom).toBe(height + top);
    expect(bounds.gap).toBe(6);
  }
  await input.blur();
  await page.evaluate(
    (height) => (window as any).setTestViewport({ height, offsetTop: 85 }),
    fullHeight,
  );
  await expect(page.locator("html")).toHaveAttribute("data-keyboard", "false");
  expect(
    await page
      .locator(".app-shell")
      .evaluate((e) => e.getBoundingClientRect().top),
  ).toBe(0);
  await expect(input).toHaveValue("Черновик остаётся на месте");
  // Pinching must not resize the app or chase the zoomed viewport's offset.
  await page.evaluate(() =>
    (window as any).setTestViewport({ height: 200, offsetTop: 120, scale: 2 }),
  );
  expect(
    await page
      .locator(".app-shell")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(fullHeight);
  await page.evaluate(
    (height) =>
      (window as any).setTestViewport({ height, offsetTop: 0, scale: 1 }),
    fullHeight,
  );
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toBeFocused();
  await page.evaluate(() =>
    (window as any).setTestViewport({ height: 430, offsetTop: 65 }),
  );
  const tools = await page.locator(".mobile-editor-tools").boundingBox();
  expect(tools!.y + tools!.height).toBe(495);
  await expect(page.locator(".mobile-editor-tools")).toHaveCSS(
    "padding-bottom",
    "4px",
  );
  await page.screenshot({
    path: "test-results/mobile-web/iphone-keyboard-geometry.png",
  });
});

test("mobile capture, document tools, keyboard viewport and save on close", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  const notes = await setup(page, false);
  await expect(page.locator(".mobile-welcome")).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть меню", exact: true })).toBeVisible();
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
    changedTouches: [{ clientX: 250, clientY: 300 }],
  });
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "none",
  );
  await expect.poll(() => page.locator(".main-column").evaluate((surface) => surface.getBoundingClientRect().left)).toBe(310);
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
      changedTouches: [{ clientX: 250, clientY: 300 }],
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
