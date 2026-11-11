import { createNote, type Note } from "../../../packages/core/src/index";
import {
  test,
  expect,
  mockMicrophone,
  microphoneWAV,
  type Page,
} from "../../../packages/editor/test/web-test";
const id = "d3d0daa0-cc18-4bbf-b8c2-2837b3324ef3";
async function setup(page: Page, populated = true, additionalNotes: Note[] = []) {
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
  notes.push(...additionalNotes);
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
  ).toBeVisible({ timeout: 15_000 });
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

test("feed previews preserve the full short note and open source links separately", async ({ page, context }, info) => {
  test.skip(info.project.name !== "iphone-webkit");
  test.setTimeout(120_000);
  const samples = [
    "Первая строка остаётся частью текста\nВторая строка\nТретья строка\nЧетвёртая строка\nПятая строка\nШестая строка тоже видна",
    "Ссылка в тексте\nhttps://example.com/?doompile=inline",
    "Мой комментарий к сохранённой цитате",
    Array.from({ length: 24 }, (_, index) => `Строка длинной заметки ${index + 1}`).join("\n"),
  ];
  const notes = samples.map((plainText, index) => createNote({
    plainText,
    createdAt: `2026-10-30T10:0${4 - index}:00.000Z`,
    ...(index === 2 ? { source: { url: "https://example.com/?doompile=source", title: "Сохранённая статья", quote: "Цитата отделена от комментария, как в вебе." } } : {}),
  }));
  await context.route("https://example.com/**", route => route.fulfill({ contentType: "text/html", body: "<p>Источник</p>" }));
  await setup(page, false, notes);
  await expect(page.locator(".note-preview-text").first()).toHaveText(samples[0]);
  await expect(page.locator(".note-copy h3")).toHaveCount(0);
  await expect(page.locator(".note-preview--long")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.locator(".main-scroll").evaluate(node => node.scrollTop = 0);
    await page.screenshot({ path: `test-results/mobile-web/feed-preview-${colorScheme}.png` });
    await page.locator(".note-preview--long").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/mobile-web/feed-preview-${colorScheme}-long.png` });
  }
  for (const link of [page.locator(".note-preview-text a"), page.locator(".source-snippet a")]) {
    const opened = page.waitForEvent("popup");
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toMatch(/^https:\/\/example\.com\//);
    await expect(page.getByRole("textbox", { name: "Текст заметки" })).toHaveCount(0);
    await popup.close();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`swiped notes cross the feed inset and clip only at the viewport edge (${colorScheme})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "iphone-webkit");
    test.setTimeout(120_000);
    await setup(page);
    const row = page.locator(".mobile-note-row");
    const content = ".mobile-row-content";
    const pin = page.getByRole("button", {
      name: "Закрепить заметку",
      exact: true,
    });
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 390, 740]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = (await row.boundingBox())!;
      const y = bounds.y + bounds.height / 2;
      expect(bounds.x).toBeGreaterThan(10);
      if (width === 390)
        await page.screenshot({
          path: `test-results/mobile-web/feed-${colorScheme}-${width}-closed.png`,
        });
      await dispatchTouch(page, content, "start", 250, y);
      await dispatchTouch(page, content, "move", 190, y);
      const paintsToEdge = () =>
        row.evaluate((row, y) => {
          const hit = document.elementFromPoint(4, y);
          return row.querySelector(".mobile-row-content")!.contains(hit);
        }, y);
      await page.screenshot({
        path: `test-results/mobile-web/feed-${colorScheme}-${width}-drag.png`,
      });
      expect(await paintsToEdge()).toBe(true);
      await expect(pin).toHaveCount(0);
      await dispatchTouch(page, content, "move", 120, y);
      await dispatchTouch(page, content, "end", 120, y);
      await expect(row).toHaveAttribute("data-revealed", "true");
      await expect(pin).toBeVisible();
      await expect
        .poll(() =>
          row.evaluate((node) =>
            parseFloat(node.style.getPropertyValue("--row-position")),
          ),
        )
        .toBe(-156);
      expect(await paintsToEdge()).toBe(true);
      if (width === 390)
        await page.screenshot({
          path: `test-results/mobile-web/feed-${colorScheme}-${width}-open.png`,
        });
      await dispatchTouch(page, content, "start", 100, y);
      await dispatchTouch(page, content, "move", 140, y);
      if (width === 390)
        await page.screenshot({
          path: `test-results/mobile-web/feed-${colorScheme}-${width}-reverse.png`,
        });
      await dispatchTouch(page, content, "cancel", 140, y);
      await expect
        .poll(() =>
          row.evaluate((node) =>
            parseFloat(node.style.getPropertyValue("--row-position")),
          ),
        )
        .toBe(-156);
      await swipe(page, content, 170);
      await expect
        .poll(() =>
          row.evaluate((node) =>
            parseFloat(node.style.getPropertyValue("--row-position")),
          ),
        )
        .toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await swipe(page, content, -130);
    await expect(pin).toBeVisible();
    await page.screenshot({
      path: `test-results/mobile-web/feed-${colorScheme}-reduced-motion-open.png`,
    });
    await swipe(page, content, 170);
    await expect(pin).toHaveCount(0);
    await page.locator(".note-main").click();
    await expect(
      page.getByRole("textbox", { name: "Текст заметки" }),
    ).toBeVisible();
  });
}

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
  await setup(page, true, Array.from({ length: 25 }, (_, index) =>
    createNote({ plainText: `Длинная лента ${index}`, revision: 1 }),
  ));
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
    .getByRole("button", { name: "Развернуть редактор", exact: true })
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

test("mobile capture, document tools, keyboard viewport and explicit send", async ({
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
    .getByRole("button", { name: "Развернуть редактор", exact: true })
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
    .getByRole("button", { name: "Отправить заметку", exact: true })
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
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeVisible();
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
      const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111");
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
      const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111");
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

test("quick composer grows through fifteen lines and scrolls additional content", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const mobile = info.project.name === "iphone-webkit";
  await page.emulateMedia({ colorScheme: mobile ? "dark" : "light" });
  await setup(page);
  const quick = page.locator(".quick-composer");
  const dock = page.locator(".composer-dock");
  const input = quick.getByRole("textbox");
  const capture = (state: string) => page.screenshot({ path: info.outputPath(`${state}.png`) });
  const measure = () => input.evaluate((element: HTMLTextAreaElement) => {
    const style = getComputedStyle(element);
    return {
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      line: Number.parseFloat(style.lineHeight),
      padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
    };
  });
  if (mobile) {
    await expect(dock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(dock).toHaveCSS("background-image", "none");
    await expect(quick).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 820, height: 844 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expect(dock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.setViewportSize(originalViewport);
  }
  const resting = await measure();
  expect(resting.height).toBe(42);
  await capture("01-quick-empty");
  await input.fill("Короткая мысль");
  expect((await measure()).height).toBe(resting.height);
  await input.fill("Текст переносится по ширине ".repeat(15));
  expect((await measure()).height).toBeGreaterThan(resting.height);
  const lines = Array.from({ length: 20 }, (_, index) => `Строка ${index + 1}`);
  await input.fill(lines.slice(0, 5).join("\n"));
  expect((await measure()).height).toBe(resting.line * 5 + resting.padding);
  await capture("02-quick-five-lines");
  await input.fill(lines.slice(0, 15).join("\n"));
  const full = resting.line * 15 + resting.padding;
  expect((await measure()).height).toBe(full);
  expect((await measure()).contentHeight).toBe(full);
  await input.fill(lines.join("\n"));
  const capped = await measure();
  expect(capped.height).toBe(full);
  expect(capped.contentHeight).toBeGreaterThan(full);
  expect(await input.evaluate((element: HTMLTextAreaElement) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);
  await capture("03-quick-fifteen-lines-scrolled");
  await input.fill("");
  expect((await measure()).height).toBe(resting.height);
});

test("expanded composer collapses text and formatting into a draft until sent", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.emulateMedia({
    colorScheme: info.project.name === "iphone-webkit" ? "dark" : "light",
    reducedMotion: "no-preference",
  });
  const notes = await setup(page);
  const quick = page.getByRole("textbox", { name: "Быстрая заметка" });
  const open = page.getByRole("button", { name: "Развернуть редактор", exact: true });
  const expanded = page.getByRole("region", { name: "Редактор заметки" });
  const collapse = expanded.getByRole("button", { name: "Свернуть редактор", exact: true });
  const send = expanded.getByRole("button", { name: "Отправить заметку", exact: true });
  const rich = expanded.getByRole("textbox", { name: "Текст заметки" });
  const dock = page.locator(".composer-expanded");
  const capture = (state: string) => page.screenshot({ path: info.outputPath(`${state}.png`) });
  const draftText = "План на неделю\nСледующие шаги\nЗаписать важную мысль\nДописать черновик";
  const pauseCollapse = () => dock.evaluate((element) => {
    const animate = element.animate.bind(element);
    element.animate = (...args) => {
      const animation = animate(...args);
      animation.pause();
      animation.currentTime = 120;
      element.setAttribute("data-collapse-paused", "");
      return animation;
    };
  });

  await open.click();
  await expect(collapse.locator('svg polyline[points="4 14 10 14 10 20"]')).toHaveCount(1);
  await expect(send).toBeDisabled();
  await collapse.click();
  await expect(quick).toHaveValue("");

  await quick.fill("План на неделю");
  await open.click();
  await expect(rich).toHaveText("План на неделю");
  await rich.press("End");
  await rich.press("Enter");
  await rich.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/html", "<p>Следующие шаги</p><h2>Записать <strong>важную мысль</strong></h2><p>Дописать черновик</p>");
    element.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }));
  });
  await expect(rich.locator("strong")).toHaveText("важную мысль");
  await expect(send).toBeEnabled();
  expect(notes).toHaveLength(1);
  await expect.poll(() => dock.evaluate((element) => element.getAnimations().length)).toBe(0);
  await capture("04-expanded-rich-draft");
  await pauseCollapse();
  await collapse.click();
  await expect(dock).toHaveAttribute("data-collapse-paused", "");
  const arrivingCard = page.locator(".quick-composer");
  const arrivingFrame = await arrivingCard.boundingBox();
  try {
    await expect(page.locator(".main-scroll")).toHaveCSS("visibility", "visible");
    expect(arrivingFrame!.height).toBeGreaterThan(100);
    await dock.evaluate((element) => { element.getAnimations()[0].currentTime = 65; });
    await capture("05a-collapse-early");
    await dock.evaluate((element) => { element.getAnimations()[0].currentTime = 120; });
    await capture("05-collapse-intermediate");
    await rich.locator("p").last().evaluate((element) => {
      element.closest<HTMLElement>("[contenteditable]")?.focus();
      const selection = window.getSelection();
      if (element.lastChild)
        selection?.collapse(element.lastChild, element.lastChild.textContent?.length || 0);
    });
    await page.keyboard.insertText("!");
    await expect(rich.locator("p").last()).toHaveText("Дописать черновик!");
  } finally {
    await dock.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  }
  const finalDraft = `${draftText}!`;
  await expect(quick).toHaveValue(finalDraft);
  expect(await arrivingCard.boundingBox()).toEqual(arrivingFrame);
  expect(notes).toHaveLength(1);
  await capture("06-collapsed-rich-draft");
  await page.reload();
  await expect(quick).toHaveValue(finalDraft);
  await open.click();
  await expect(rich.locator("h2")).toHaveText("Записать важную мысль");
  await expect(rich.locator("strong")).toHaveText("важную мысль");
  await pauseCollapse();
  await collapse.click();
  await expect(dock).toHaveAttribute("data-collapse-paused", "");
  await page.evaluate(() => history.back());
  await expect(expanded).toHaveCount(0);
  await expect(quick).toHaveValue(finalDraft);
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
    history.forward();
  }));
  await expect(page).toHaveURL(/\/$/);
  await expect(quick).toHaveValue(finalDraft);
  await open.click();
  await expect(rich.locator("strong")).toHaveText("важную мысль");
  await send.click();
  await expect(expanded).toHaveCount(0);
  await expect(quick).toHaveValue("");
  await expect.poll(() => notes.length).toBe(2);
  expect(notes.at(-1).plainText).toContain("Дописать черновик");
  await capture("07-sent-note");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await quick.fill("Черновик без анимации");
  await open.click();
  expect(await dock.evaluate((element) => element.getAnimations().length)).toBe(0);
  await collapse.click();
  await expect(expanded).toHaveCount(0);
  await expect(quick).toHaveValue("Черновик без анимации");
});

test("compact composer sends a visible note before its file finishes uploading", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: info.project.name === "iphone-webkit" ? "dark" : "light" });
  const notes = await setup(page);
  const quick = page.locator(".quick-composer");
  const input = quick.getByRole("textbox");
  const clip = quick.getByRole("button", { name: "Прикрепить файл" });
  const expand = quick.getByRole("button", { name: "Развернуть редактор" });
  const mic = quick.getByRole("button", { name: "Записать голосовую заметку" });
  const send = quick.getByRole("button", { name: "Сохранить заметку" });
  const capture = (state: string) => page.screenshot({
    path: info.outputPath(`composer-${state}.png`),
  });
  await expect(mic).toBeVisible();
  await expect(send).toHaveCount(0);
  const bounds = await Promise.all([clip, input, expand, mic].map((item) => item.boundingBox()));
  expect(bounds.map((rect) => rect!.x)).toEqual([...bounds].map((rect) => rect!.x).sort((a, b) => a - b));
  expect(Math.max(...bounds.map((rect) => rect!.y)) - Math.min(...bounds.map((rect) => rect!.y))).toBeLessThan(3);
  await capture("empty");
  await input.fill("Отчёт по проекту");
  await expect(send).toBeVisible();
  await expect(mic).toHaveCount(0);
  await capture("text");
  const file = {
    name: "Материалы проекта.zip",
    mimeType: "application/zip",
    buffer: Buffer.alloc(186 * 1024, 65),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/attachments", async (route) => {
    const id = route.request().headers()["x-doompile-upload-id"];
    await gate;
    await route.fulfill({
      json: { attachment: { id, name: file.name, mimeType: file.mimeType, size: file.buffer.length, url: `/api/attachments/${id}` } },
    });
  });
  // Playwright buffers requests for interception. Supply a progress event
  // while the response is gated so the capture includes an intermediate frame.
  await page.evaluate(() => {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      if (args[0] instanceof FormData)
        Object.assign(window, { captureTestUpload: this });
      return send.apply(this, args);
    };
  });
  const chooser = page.waitForEvent("filechooser");
  await clip.click();
  await (await chooser).setFiles(file);
  try {
    const draft = quick.locator(".draft-attachment");
    await expect(draft).toContainText(file.name);
    await expect.poll(() => page.evaluate(() => {
      const request = (window as Window & { captureTestUpload?: XMLHttpRequest }).captureTestUpload;
      if (!request) return false;
      request.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded: 37, total: 100 }));
      return true;
    })).toBe(true);
    await expect(draft).toContainText("Загружается · 37%");
    expect(await draft.locator(".capture-attachment-status").evaluate((label) =>
      label.getBoundingClientRect().right <= label.parentElement!.getBoundingClientRect().right + 1,
    )).toBe(true);
    const height = (await draft.boundingBox())!.height;
    await capture("file-progress");
    await expect(send).toBeEnabled();
    await send.click();
    const row = page.locator(".note-row").filter({ hasText: "Отчёт по проекту" });
    await expect(row).toContainText(file.name);
    await expect(row).toContainText("Загружается · 37%");
    await expect(input).toHaveValue("");
    await expect(draft).toHaveCount(0);
    expect(notes).toHaveLength(1);
    await capture("optimistic-feed");
    release();
    const ready = row.getByRole("link", { name: `Открыть ${file.name}` });
    await expect(ready).toBeVisible();
    expect((await ready.boundingBox())!.height).toBeCloseTo(height, 1);
    await expect.poll(() => notes.length).toBe(2);
    await capture("ready-feed");
  } finally {
    release();
  }
});

test("a failed attachment remains on the same note after reload and can be retried or discarded", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const notes = await setup(page, false);
  const requestIDs: string[] = [];
  const bytes = "Данные тестового вложения";
  const fileName = "Список.txt";
  let fail = true;
  await page.route("**/api/attachments", async (route) => {
    const id = route.request().headers()["x-doompile-upload-id"];
    requestIDs.push(id);
    await route.fulfill(fail ? { status: 503, json: { error: "fixture" } } : {
      json: { attachment: { id, name: fileName, mimeType: "text/plain", size: Buffer.byteLength(bytes), url: `/api/attachments/${id}` } },
    });
  });
  const attach = () => page.locator('input[type=file]').setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(bytes),
  });
  const send = page.getByRole("button", { name: "Сохранить заметку" });
  const row = page.locator(".note-row").filter({ hasText: fileName });
  const retry = row.getByRole("button", { name: `Повторить загрузку ${fileName}` });
  await attach();
  await send.click();
  await expect(retry).toBeVisible();
  await expect(row).toContainText("Не удалось загрузить");
  await page.screenshot({ path: info.outputPath("composer-failed-feed.png") });
  expect(notes).toHaveLength(0);
  await page.reload();
  await expect(row).toContainText("Не удалось загрузить");
  await expect(retry).toBeVisible();
  expect(new Set(requestIDs).size).toBe(1);
  expect(await page.evaluate(async () => {
    const request = indexedDB.open("doompile-v1:user:11111111-1111-4111-8111-111111111111");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const request = db.transaction("uploadBytes").objectStore("uploadBytes").getAll();
      const files = await new Promise<ArrayBuffer[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new TextDecoder().decode(files[0]);
    } finally {
      db.close();
    }
  })).toBe(bytes);
  await row.getByRole("button", { name: `Удалить заметку ${fileName}` }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(row).toContainText("Не удалось загрузить");
  expect(new Set(requestIDs).size).toBe(1);
  fail = false;
  await retry.click();
  await expect(row.getByRole("link", { name: `Открыть ${fileName}` })).toBeVisible();
  await expect.poll(() => notes.length).toBe(1);
  expect(notes[0].attachments[0].id).toBe(requestIDs[0]);

  fail = true;
  await attach();
  await send.click();
  const queued = page.locator(".note-row").filter({ has: page.getByRole("button", { name: `Повторить загрузку ${fileName}` }) });
  await queued.getByRole("button", { name: `Удалить заметку ${fileName}` }).click();
  await expect(queued).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(1);
});

test("voice tap can stop or send and holding sends on release", async ({ page }, info) => {
  test.setTimeout(60_000);
  const mobile = info.project.name === "iphone-webkit";
  await page.emulateMedia({ colorScheme: mobile ? "light" : "dark" });
  await mockMicrophone(page, true);
  const wav = microphoneWAV(2);
  await page.route("**/api/attachments", (route) => {
    const id = route.request().headers()["x-doompile-upload-id"];
    return route.fulfill({
      json: { attachment: { id, name: "Голосовая заметка.wav", mimeType: "audio/wav", size: wav.length, url: `/api/attachments/${id}` } },
    });
  });
  await page.route("**/api/attachments/*", (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || "");
    const headers = { "content-type": "audio/wav", "accept-ranges": "bytes" };
    if (!range) return route.fulfill({ headers, body: wav });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${wav.length}` },
      body: wav.subarray(start, end + 1),
    });
  });
  const notes = await setup(page, false);
  const quick = page.locator(".quick-composer");
  const mic = quick.getByRole("button", { name: "Записать голосовую заметку" });
  const stop = quick.getByRole("button", { name: "Остановить запись" });
  const send = quick.getByRole("button", { name: "Сохранить заметку" });
  const capture = (state: string) => page.screenshot({ path: info.outputPath(`voice-${state}.png`) });
  const tapMic = () => mobile ? mic.tap() : mic.click();

  await tapMic();
  await expect(stop).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(quick.locator(".recording-waveform")).toHaveAttribute("data-signal", "audible");
  await capture("active");
  await stop.click();
  await expect(quick.locator("audio")).toBeAttached();
  expect(notes).toHaveLength(0);
  await capture("staged");
  await quick.getByRole("button", { name: "Убрать голосовую запись" }).click();
  await expect(mic).toBeVisible();

  await tapMic();
  await expect(stop).toBeVisible();
  await send.click();
  await expect(mic).toBeVisible();
  await expect.poll(() => notes.length).toBe(1);
  expect(notes[0]).toMatchObject({ kind: "audio", plainText: "" });
  await expect(page.locator(".note-row audio")).toHaveJSProperty("duration", 2);

  const center = (await mic.boundingBox())!;
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
  await page.mouse.down();
  await expect(stop).toBeVisible();
  await expect(quick.locator(".recording-waveform")).toHaveAttribute("data-signal", "audible");
  await page.waitForTimeout(400);
  expect(notes).toHaveLength(1);
  await expect(page.locator(".toast").filter({ hasText: "Заметка сохранена на устройстве" })).toHaveCount(0);
  await capture("hold-mid");
  await page.mouse.up();
  await expect(mic).toBeVisible();
  await expect.poll(() => notes.length).toBe(2);
  expect(notes[1]).toMatchObject({ kind: "audio", plainText: "" });
  await capture("hold-released");

  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
  await page.mouse.down();
  await expect(stop).toBeVisible();
  await page.waitForTimeout(400);
  await page.mouse.move(center.x - 80, center.y + center.height / 2);
  await page.mouse.up();
  await expect(quick.locator("audio")).toBeAttached();
  expect(notes).toHaveLength(2);
  await capture("hold-cancelled");
});
