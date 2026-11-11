import { test, expect, type Locator, type Page } from "@playwright/test";
test("unknown blocks show a local error and survive editing and reload", async ({
  page,
}) => {
  await page.goto("/");
  const future = { type: "futureWidget", attrs: { value: { answer: 42 } } };
  await page.evaluate(
    (future) =>
      (window as any).controller.setDocument(
        {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Before" }] },
            future,
            { type: "paragraph", content: [{ type: "text", text: "After" }] },
          ],
        },
        false,
      ),
    future,
  );
  await expect(page.locator(".editor-render-error")).toHaveText(
    "Ошибка отрисовки",
  );
  await page.locator(".tiptap > p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  const body = await page.evaluate(() => (window as any).testEditor.getJSON());
  expect(
    body.content.find((node: any) => node.type === "futureWidget"),
  ).toEqual(future);
  expect(JSON.stringify(body)).toContain("Before");
  expect(JSON.stringify(body)).toContain("After");
  await page.evaluate(
    (body) => (window as any).controller.setDocument(body, false),
    body,
  );
  await expect(page.locator(".editor-render-error")).toHaveCount(1);
});
const paragraph = (text = "") => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const doc = (...content: unknown[]) => ({ type: "doc", content });
async function setDoc(page: Page, content: unknown) {
  await page.evaluate((content) => {
    (window as any).controller.setDocument(content);
    (window as any).testEditor.commands.focus("end");
  }, content);
}
async function json(page: Page) {
  return page.evaluate(() => (window as any).testEditor.getJSON());
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").click();
});

test("list immediately after text, Enter continues, empty Enter exits", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- пункт");
  await page.keyboard.press("Enter");
  await page.keyboard.type("второй");
  await expect(page.locator(".tiptap > ul > li")).toHaveCount(2);
  expect(
    await page
      .locator(".tiptap > ul")
      .evaluate((ul) => ul.previousElementSibling?.textContent),
  ).toBe("Текст");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("После");
  await expect(page.locator(".tiptap > p").last()).toHaveText("После");
});
test("ordered list after text and Shift+Enter preserves multiline item", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. Первый");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("продолжение");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Второй");
  await expect(page.locator("ol > li")).toHaveCount(2);
  await expect(page.locator("ol > li").first().locator("br")).toHaveCount(1);
});
test("list marker after a hard break does not require an empty line", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("- пункт");
  await expect(page.locator("ul > li")).toHaveCount(1);
  await expect(page.locator(".tiptap > p").first()).toHaveText("Текст");
});
test("media stays in a list item and Enter creates the next item; undo restores", async ({
  page,
}) => {
  await page.keyboard.type("- голос");
  await page.evaluate(() =>
    (window as any).controller.insertAttachment({
      url: "/api/attachments/test",
      name: "Voice.m4a",
      mimeType: "audio/mp4",
    }),
  );
  await expect(page.locator("ul > li audio")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Следующий");
  await expect(page.locator("ul > li")).toHaveCount(2);
  await expect(page.locator("ul > li").last()).toHaveText("Следующий");
  const result = await json(page);
  expect(
    result.content[0].content[0].content[0].content.some(
      (n: any) => n.type === "attachment",
    ),
  ).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("ul > li audio")).toHaveCount(1);
});
test("nested bullet list inside ordered list keeps outer numbering", async ({
  page,
}) => {
  await page.keyboard.type("1. Первый");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/nested");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Вложенный");
  await expect(page.locator(".tiptap > ol > li > ul > li")).toHaveText(
    "Вложенный",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("Второй");
  await expect(page.locator(".tiptap > ol > li")).toHaveCount(2);
});
test("slash filters, keyboard selection, Escape and action callback", async ({
  page,
}) => {
  await page.keyboard.type("/h2");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Глава");
  await expect(page.locator(".tiptap h2")).toHaveText("Глава");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/file");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.locator(".tiptap")).toContainText("/file");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("e");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).actions)).toEqual(["file"]);
  await expect(page.locator(".tiptap")).not.toContainText("/file");
});
test("slash menu wheel and keyboard scroll only its own list without recreating options", async ({
  page,
}) => {
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const pageScroll = await page.evaluate(() => window.scrollY);
  await menu
    .getByRole("option")
    .first()
    .evaluate((element) => {
      (window as any).firstOption = element;
    });
  await menu.hover();
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);
  await menu.evaluate(async (element) => {
    element.dispatchEvent(new Event("scroll"));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    100,
  );
  expect(
    await menu.evaluate(
      (element) => element.firstElementChild === (window as any).firstOption,
    ),
  ).toBe(true);
  await page.keyboard.press("ArrowUp");
  const selected = menu.getByRole("option", { selected: true });
  await expect(selected).toHaveText("Настройки команд");
  const bounds = (await menu.boundingBox())!,
    option = (await selected.boundingBox())!;
  expect(option.y).toBeGreaterThanOrEqual(bounds.y);
  expect(option.y + option.height).toBeLessThanOrEqual(
    bounds.y + bounds.height,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("option", { selected: true })).toHaveText(
    "Текст",
  );
  expect(await menu.evaluate((element) => element.scrollTop)).toBeLessThan(10);
});

test("selection toolbar waits for pointer release, animates once and respects reduced motion", async ({
  page,
}) => {
  await page.keyboard.type("Выделяем несколько слов мышью");
  const text = (await page.locator(".tiptap > p").boundingBox())!;
  await page.mouse.move(text.x + 2, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + 160, text.y + text.height / 2, { steps: 8 });
  expect(
    await page.evaluate(() => window.getSelection()?.toString().length),
  ).toBeGreaterThan(0);
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeHidden();
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("editor-toolbar-appear");
  await page.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(page.locator("strong")).not.toBeEmpty();
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");
});

test("first-line selection toolbar flips below the text instead of clamping onto it", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.getElementById("editor")!.style.marginTop = "140px";
  });
  const text = "Текст первой строки для проверки панели форматирования";
  await page.keyboard.type(text);
  const selection = await page.evaluate(() => {
    const editor = (window as any).testEditor;
    editor.commands.setTextSelection({ from: 30, to: 48 });
    return editor.view.coordsAtPos(48);
  });
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  const bounds = (await toolbar.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(selection.bottom + 6);
  await page.screenshot({ path: info.outputPath("first-line-toolbar.png") });
  await toolbar.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(page.locator("strong")).toHaveText(text.slice(29, 47));
});

test("toolbar flips below the whole multiline selection at the top of the editor", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setDoc(
    page,
    doc(
      paragraph("Первая строка"),
      paragraph("Вторая строка"),
      paragraph("После выделения"),
    ),
  );
  const end = await page.evaluate(() => {
    const editor = (window as any).testEditor;
    const to =
      editor.state.doc.child(0).nodeSize +
      editor.state.doc.child(1).nodeSize -
      1;
    editor.commands.setTextSelection({ from: 1, to });
    return editor.view.coordsAtPos(to);
  });
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(
    end.bottom + 6,
  );
});

test("toolbar respects the visible top and bottom of a nested scroll container", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const wrapper = document.createElement("div");
    wrapper.id = "scroll-container";
    wrapper.style.cssText = "height:240px;overflow:auto;margin-top:80px";
    const root = document.getElementById("editor")!;
    root.before(wrapper);
    wrapper.append(root);
  });
  await setDoc(
    page,
    doc(...Array.from({ length: 30 }, (_, i) => paragraph(`Строка ${i}`))),
  );
  const topLine = await page.evaluate(() => {
    const editor = (window as any).testEditor;
    let from = 1;
    for (let i = 0; i < 10; i++) from += editor.state.doc.child(i).nodeSize;
    editor.commands.setTextSelection({ from, to: from + 6 });
    const wrapper = document.getElementById("scroll-container")!;
    wrapper.scrollTop +=
      editor.view.coordsAtPos(from).top -
      wrapper.getBoundingClientRect().top -
      4;
    return editor.view.coordsAtPos(from);
  });
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeGreaterThanOrEqual(topLine.bottom + 6);
  const bottomLine = await page.evaluate(() => {
    const editor = (window as any).testEditor;
    const wrapper = document.getElementById("scroll-container")!;
    wrapper.scrollTop +=
      editor.view.coordsAtPos(editor.state.selection.from).bottom -
      wrapper.getBoundingClientRect().bottom +
      4;
    return editor.view.coordsAtPos(editor.state.selection.from);
  });
  await expect
    .poll(async () => {
      const box = (await toolbar.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(bottomLine.top - 6);
});

test("wrapped toolbar in a narrow editor does not overlap the first line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 500 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.getElementById("editor")!.style.marginTop = "100px";
  });
  await page.keyboard.type("Первая строка");
  await page.keyboard.press("ControlOrMeta+a");
  const line = await page.evaluate(() =>
    (window as any).testEditor.view.coordsAtPos(1),
  );
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  const box = (await toolbar.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(line.bottom + 6);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(280);
});

test("source snippet can be added from slash commands, validates links and remains undoable", async ({
  page,
}) => {
  await page.keyboard.type("До");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/source");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Источник с цитатой" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Ссылка", { exact: true })
    .fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Добавить источник" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".source-snippet")).toHaveCount(0);
  await dialog
    .getByLabel("Ссылка", { exact: true })
    .fill("https://example.com/article");
  await dialog
    .getByLabel("Название (необязательно)", { exact: true })
    .fill("Статья");
  await dialog
    .getByLabel("Цитата (необязательно)", { exact: true })
    .fill("Точный фрагмент <b>текстом</b>");
  await dialog.getByRole("button", { name: "Добавить источник" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".source-snippet a")).toHaveAttribute(
    "href",
    /https:\/\/example.com\/article#:~:text=/,
  );
  await expect(page.locator(".source-snippet .source-quote")).toHaveText(
    "Точный фрагмент <b>текстом</b>",
  );
  await expect(page.locator(".source-snippet")).toHaveAttribute(
    "data-title",
    "Статья",
  );
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".source-snippet")).toHaveCount(0);
  await expect(page.locator(".tiptap")).toContainText("До");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".source-snippet")).toHaveCount(1);
});

test("source dialog cancels back to the editor without inserting a card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.keyboard.type("/источник");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("Продолжаем");
  await expect(page.locator(".tiptap")).toHaveText("Продолжаем");
  await expect(page.locator(".source-snippet")).toHaveCount(0);
});

test("mention filters notes, inserts an atom, and opens its target", async ({
  page,
}) => {
  await page.keyboard.type("Смотри @Вторая");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-note-reference]")).toHaveText(
    "↗ Вторая мысль",
  );
  await page.locator("[data-note-reference]").click();
  expect(await page.evaluate(() => (window as any).references)).toEqual([
    "note-two",
  ]);
  expect(
    (await json(page)).content[0].content.some(
      (n: any) => n.type === "noteReference",
    ),
  ).toBe(true);
});
test("selection toolbar preserves selection and applies bold, undo keeps focus", async ({
  page,
}) => {
  await page.keyboard.type("Слова");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("toolbar")).toBeVisible();
  await page.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(page.locator("strong")).toHaveText("Слова");
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("strong")).toHaveCount(0);
});
test("paragraph, hard break and list line heights use the same rhythm", async ({
  page,
}) => {
  await setDoc(
    page,
    doc(
      paragraph("один"),
      paragraph("два"),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "три" },
          { type: "hardBreak" },
          { type: "text", text: "четыре" },
        ],
      },
      {
        type: "orderedList",
        content: [
          { type: "listItem", content: [paragraph("пять")] },
          { type: "listItem", content: [paragraph("шесть")] },
        ],
      },
    ),
  );
  const sizes = await page
    .locator(".tiptap p")
    .evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().height));
  expect(Math.abs(sizes[0] - sizes[1])).toBeLessThan(1);
  expect(Math.abs(sizes[2] - sizes[0] * 2)).toBeLessThan(1);
  expect(Math.abs(sizes[3] - sizes[0])).toBeLessThan(1);
  const gaps = await page
    .locator(".tiptap > p")
    .evaluateAll(
      (ps) =>
        ps[1].getBoundingClientRect().top -
        ps[0].getBoundingClientRect().bottom,
    );
  expect(gaps).toBe(0);
});
test("outline expands on hover and jumps to headings", async ({ page }) => {
  await setDoc(
    page,
    doc(
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Начало" }],
      },
      ...Array.from({ length: 40 }, () => paragraph("Текст")),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Конец" }],
      },
    ),
  );
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(nav.locator("span").first()).toBeHidden();
  await nav.hover();
  await expect(nav.locator("span").first()).toBeVisible();
  await nav.getByRole("button", { name: "Конец" }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
});
test("source snippet and paragraphs can be reordered by drag handle", async ({
  page,
}) => {
  await setDoc(
    page,
    doc(
      {
        type: "sourceSnippet",
        attrs: {
          url: "https://example.com/article",
          title: "Статья",
          quote: "Цитата",
        },
      },
      paragraph("Первый"),
      paragraph("Второй"),
    ),
  );
  await page.locator(".source-snippet").hover();
  const handle = page.getByRole("button", {
    name: "Перетащить блок",
    exact: true,
    includeHidden: true,
  });
  await expect(handle).toBeVisible();
  const target = page.locator(".tiptap > p").last();
  await handle.hover();
  await page.mouse.down();
  const rect = (await target.boundingBox())!;
  await page.mouse.move(rect.x + 30, rect.y + 24, { steps: 10 });
  await page.mouse.up();
  expect(
    (await json(page)).content
      .slice(0, 3)
      .map((n: any) =>
        n.content?.[0]?.type === "sourceSnippet"
          ? "sourceSnippet"
          : n.content?.[0]?.text,
      ),
  ).toEqual(["Первый", "Второй", "sourceSnippet"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await json(page)).content[0].content[0].type).toBe("sourceSnippet");
});
test("document roundtrip preserves nested lists, checked tasks, media, links and snippets", async ({
  page,
}) => {
  const body = doc(
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            paragraph("Пункт"),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [paragraph("Вложенный")] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [paragraph("Готово")],
        },
      ],
    },
    {
      type: "sourceSnippet",
      attrs: { url: "https://example.com", title: "Сайт", quote: "Цитата" },
    },
    {
      type: "attachment",
      attrs: {
        url: "/api/attachments/a",
        name: "file.txt",
        mimeType: "text/plain",
      },
    },
  );
  await setDoc(page, body);
  const before = await json(page);
  await setDoc(page, before);
  expect(await json(page)).toEqual(before);
});

test("image inside a numbered item continues numbering and can be undone separately", async ({
  page,
}) => {
  await page.keyboard.type("1. Фото");
  await page.evaluate(() =>
    (window as any).controller.insertAttachment({
      url: "https://example.com/image.png",
      name: "Фото",
      mimeType: "image/png",
    }),
  );
  await expect(
    page.locator("ol > li img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Дальше");
  await expect(page.locator("ol > li")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.locator("ol > li img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
});
test("multiple paragraphs belong to one item; Enter after the continuation creates a sibling", async ({
  page,
}) => {
  await page.keyboard.type("- Начало");
  await page.keyboard.press("Alt+Enter");
  await page.keyboard.type("Абзац");
  await expect(page.locator("ul > li")).toHaveCount(1);
  await expect(page.locator("ul > li > p")).toHaveCount(2);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Следующий");
  await expect(page.locator("ul > li")).toHaveCount(2);
});
test("task item with an attachment creates a new unchecked task", async ({
  page,
}) => {
  await page.keyboard.type("/todo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Задача");
  await page.evaluate(() =>
    (window as any).controller.insertAttachment({
      url: "/api/attachments/file",
      name: "file.pdf",
      mimeType: "application/pdf",
    }),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("Следующая");
  await expect(page.locator('[data-type="taskList"] > li')).toHaveCount(2);
  await expect(
    page.locator('[data-type="taskList"] > li').last(),
  ).toHaveAttribute("data-checked", "false");
});
test("Tab nests, Shift+Tab restores, and Backspace merges list content", async ({
  page,
}) => {
  await page.keyboard.type("- Один");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Два");
  await page.keyboard.press("Tab");
  await expect(page.locator("ul > li > ul > li")).toHaveText("Два");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".tiptap > ul > li")).toHaveCount(2);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".tiptap")).toContainText("Один");
  await expect(page.locator(".tiptap")).toContainText("Два");
});
test("keyboard block movement reorders list items and paragraphs without losing marks", async ({
  page,
}) => {
  await page.keyboard.type("- Один");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Два");
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(page.locator(".tiptap > ul > li").first()).toHaveText("Два");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".tiptap > ul > li").first()).toHaveText("Один");
});
test("slash never opens inside code or a URL, mentions ignore emails", async ({
  page,
}) => {
  await page.keyboard.type("https://example.com @");
  await page.keyboard.press("Escape");
  await page.keyboard.type("user@example.com");
  await expect(page.getByRole("listbox")).toBeHidden();
  await setDoc(
    page,
    doc({ type: "codeBlock", content: [{ type: "text", text: "/h2" }] }),
  );
  await page.keyboard.type(" ");
  await expect(page.getByRole("listbox")).toBeHidden();
});
test("read-only editor hides editing controls and remains navigable", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("toolbar")).toBeVisible();
  await page.evaluate(() => (window as any).testEditor.setEditable(false));
  await expect(page.getByRole("toolbar")).toBeHidden();
  await page.keyboard.type("Не добавится");
  await expect(page.locator(".tiptap")).toHaveText("Текст");
});
test("native bridge document roundtrip does not emit saves or steal focus on snapshot", async ({
  page,
}) => {
  await page.goto("/editor.html");
  await page.evaluate(() =>
    (window as any).doompileEditor.setDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Текст" }] },
      ],
    }),
  );
  await page.getByRole("textbox").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  const snapshot = await page.evaluate(() =>
    (window as any).doompileEditor.getState(),
  );
  expect(snapshot.plainText).toBe("Текст!");
  await expect(page.getByRole("textbox")).toBeFocused();
});
test("source quotes stay in metadata and are not duplicated in the plain text excerpt", async ({
  page,
}) => {
  await setDoc(
    page,
    doc(
      {
        type: "sourceSnippet",
        attrs: { url: "https://example.com", quote: "Exact quote" },
      },
      paragraph("My annotation"),
    ),
  );
  await page.keyboard.type("!");
  const changes = await page.evaluate(() => (window as any).changes);
  expect(changes.at(-1).text).toBe("My annotation!");
});

test("plain text uses one newline between list items and paragraphs", async ({
  page,
}) => {
  await page.keyboard.type("Текст");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- один");
  await page.keyboard.press("Enter");
  await page.keyboard.type("два");
  expect(await page.evaluate(() => (window as any).changes.at(-1).text)).toBe(
    "Текст\nодин\nдва",
  );
});

test("pasting plain text creates lists without a blank line and preserves mixed nesting", async ({
  page,
}) => {
  await page.getByRole("textbox").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "Текст\n1. Первый\n   - Вложенный\n2. Второй",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".tiptap > p").first()).toHaveText("Текст");
  await expect(page.locator(".tiptap > ol > li")).toHaveCount(2);
  await expect(page.locator("ol > li > ul > li")).toHaveText("Вложенный");
});

test("menus stay within a narrow viewport and light theme", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.keyboard.type("/h2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Идеи на неделю");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Первая мысль");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/file");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const rect = (await menu.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  expect(rect.y + rect.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: testInfo.outputPath("editor-light.png") });
});

test("Enter while an attachment is selected creates a sibling list item", async ({
  page,
}) => {
  await page.keyboard.type("- Файл");
  await page.evaluate(() => {
    const app = (window as any).controller;
    app.insertAttachment({
      url: "/api/attachments/file",
      name: "file.pdf",
      mimeType: "application/pdf",
    });
    app.editor.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === "attachment")
        app.editor.commands.setNodeSelection(pos);
    });
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Следующий");
  await expect(page.locator(".tiptap > ul > li")).toHaveCount(2);
  await expect(page.locator("ul > li").last()).toHaveText("Следующий");
});

test("HTML copy and paste retains reference targets, source quotes and attachment metadata", async ({
  page,
}) => {
  await setDoc(
    page,
    doc(
      {
        type: "sourceSnippet",
        attrs: {
          url: "https://example.com",
          quote: "Exact quote",
          title: "Source",
          timestampSeconds: 0,
        },
      },
      {
        type: "paragraph",
        content: [
          {
            type: "noteReference",
            attrs: { id: "note-one", title: "Первая заметка" },
          },
        ],
      },
      {
        type: "attachment",
        attrs: {
          url: "/api/attachments/file",
          name: "report.pdf",
          mimeType: "application/pdf",
        },
      },
    ),
  );
  const before = await json(page);
  await page.evaluate(() => {
    const editor = (window as any).testEditor;
    editor.commands.setContent(editor.getHTML());
  });
  expect(await json(page)).toEqual(before);
});

test("native touch commands preserve the caret, support lists and report selected formats", async ({
  page,
}) => {
  await page.goto("/editor.html");
  await page.evaluate(() => {
    const api = (window as any).doompileEditor;
    api.setTheme("light");
    api.setTouchMode(true);
    api.setDocument({ type: "doc", content: [{ type: "paragraph" }] });
    api.focus();
  });
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("Before ");
  await page.evaluate(() => (window as any).doompileEditor.command("bold"));
  await page.keyboard.type("bold");
  await expect(page.locator("strong")).toHaveText("bold");
  await page.evaluate(() => (window as any).doompileEditor.command("bold"));
  await page.keyboard.press("Enter");
  await page.evaluate(() =>
    (window as any).doompileEditor.command("checklist"),
  );
  await page.keyboard.type("Task");
  await expect(page.locator('[data-type="taskList"] li p')).toHaveText("Task");
  await page.evaluate(() => (window as any).doompileEditor.blur());
  await expect(page.getByRole("textbox")).not.toBeFocused();
  await page.evaluate(() => (window as any).doompileEditor.command("italic"));
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(" italic");
  await expect(page.locator("em")).toHaveText(" italic");
  await expect(page.getByRole("textbox")).toBeFocused();
  const snapshot = await page.evaluate(() =>
    (window as any).doompileEditor.getState(),
  );
  expect(snapshot.plainText).toBe("Before bold\nTask italic");
  await expect(page.getByRole("textbox")).toBeFocused();
});

async function openTouchDocument(page: Page, body: unknown, width = 390) {
  await page.setViewportSize({ width, height: 720 });
  await page.goto("/editor.html");
  await page.evaluate((body) => {
    const api = window.doompileEditor;
    api.setTouchMode(true);
    api.setDocument(body);
  }, body);
}

async function swipeParagraph(
  line: Locator,
  dx: number,
  options: {
    dy?: number;
    start?: "interior" | "text-edge" | "outside-gutter" | "viewport-edge";
    visualLine?: number;
    gutterInset?: number;
    hold?: boolean;
    cancel?: boolean;
    interrupt?: "selection" | "contextmenu" | "multitouch";
    verticalFirst?: boolean;
  } = {},
) {
  return line.evaluate(
    async (element, { dx, options }) => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const textLine = range.getClientRects()[options.visualLine || 0];
      const y = textLine
        ? (textLine.top + textLine.bottom) / 2
        : rect.top + rect.height / 2;
      const x =
        options.start === "interior"
          ? rect.left + Math.min(100, rect.width / 2)
          : options.start === "text-edge"
            ? rect.left + 2
            : options.start === "outside-gutter"
              ? rect.left - 27
              : options.start === "viewport-edge"
                ? 4
              : rect.left - (options.gutterInset ?? 4);
      const target = document.elementFromPoint(x, y);
      if (!target) throw new Error("Touch point must be in the viewport");
      const origin = { identifier: 0, clientX: x, clientY: y };
      const end = {
        ...origin,
        clientX: x + dx,
        clientY: y + (options.dy || 0),
      };
      function dispatch(
        type: string,
        touches: (typeof origin)[],
        changed = end,
      ) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { touches, changedTouches: [changed] });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      }
      dispatch("touchstart", [origin], origin);
      if (options.hold)
        await new Promise((resolve) => setTimeout(resolve, 320));
      if (options.interrupt === "selection") {
        const editor = (document.querySelector(".tiptap") as any).editor;
        editor.commands.setTextSelection({ from: 1, to: 4 });
        document.dispatchEvent(new Event("selectionchange"));
      }
      if (options.interrupt === "contextmenu")
        target.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      if (options.interrupt === "multitouch")
        dispatch("touchmove", [origin, { ...origin, identifier: 1 }]);
      if (options.verticalFirst)
        dispatch("touchmove", [{ ...origin, clientX: x + 2, clientY: y + 30 }]);
      const moved = dispatch("touchmove", [end]);
      const ended = dispatch(options.cancel ? "touchcancel" : "touchend", []);
      return {
        moved,
        ended,
        startsOutsideText: x < rect.left,
        targetInsideText: element.contains(target),
      };
    },
    { dx, options },
  );
}

test("touch pointer movement keeps the block handle hidden and mouse hover reveals it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/");
  await setDoc(page, doc(paragraph("Touch keeps this text unobstructed")));
  const line = page.locator(".tiptap > p");
  const handle = page.getByRole("button", {
    name: "Перетащить блок",
    exact: true,
  });
  const before = await json(page);
  await expect(handle).toBeHidden();
  await line.dispatchEvent("pointermove", { pointerType: "touch" });
  await expect(handle).toBeHidden();
  expect(await json(page)).toEqual(before);
  await line.hover();
  await expect(handle).toBeVisible();
  await line.dispatchEvent("pointermove", { pointerType: "touch" });
  await expect(handle).toBeHidden();
  await line.hover({ position: { x: 30, y: 8 } });
  await expect(handle).toBeVisible();
});

test("touch caret changes keep passive block handles hidden and explicit block actions available", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 720 },
    hasTouch: true,
  });
  try {
    const touchPage = await context.newPage();
    await touchPage.goto(new URL("/", page.url()).href);
    expect(
      await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await setDoc(touchPage, doc(paragraph("Touch keeps this text unobstructed")));
    const handle = touchPage.getByRole("button", {
      name: "Перетащить блок",
      exact: true,
      includeHidden: true,
    });
    await expect(handle).toHaveJSProperty("hidden", true);
    await touchPage.evaluate(() =>
      (window as any).testEditor.commands.setTextSelection(3),
    );
    await expect(handle).toHaveJSProperty("hidden", true);
    await touchPage.evaluate(() => (window as any).controller.openBlockActions());
    await expect(
      touchPage.getByRole("menu", { name: "Действия с блоком", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("touch indentation starts in the paragraph gutter and keeps the typing caret", async ({
  page,
}) => {
  await openTouchDocument(page, doc(paragraph("Caret"), paragraph("Target")));
  const caret = page.locator(".tiptap > p").first();
  const target = page.getByText("Target", { exact: true });
  await caret.click();
  await page.keyboard.press("End");
  expect(await swipeParagraph(target, 60, { dy: 110 })).toMatchObject({
    moved: false,
    ended: false,
  });
  await swipeParagraph(target, 85, { cancel: true });
  await swipeParagraph(target, 20);
  await expect(target).not.toHaveAttribute("data-indent");
  expect(await swipeParagraph(target, 85)).toEqual({
    moved: true,
    ended: true,
    startsOutsideText: true,
    targetInsideText: false,
  });
  await expect(target).toHaveAttribute("data-indent", "1");
  await swipeParagraph(target, 85);
  await expect(target).toHaveAttribute("data-indent", "2");
  await swipeParagraph(target, -30);
  await expect(target).toHaveAttribute("data-indent", "1");
  await swipeParagraph(target, -30);
  await expect(target).not.toHaveAttribute("data-indent");
  await page.keyboard.type("!");
  await expect(caret).toHaveText("Caret!");
  await expect(caret).not.toHaveAttribute("data-indent");
});

test("touches inside text keep selection and caret gestures available", async ({
  page,
}) => {
  await openTouchDocument(page, doc(paragraph("Select these words")));
  const line = page.locator(".tiptap > p").first();
  const before = await page.evaluate(() => window.doompileEditor.getDocument());
  for (const start of ["text-edge", "interior"] as const) {
    expect(await swipeParagraph(line, 85, { start })).toMatchObject({
      moved: false,
      ended: false,
    });
    expect(
      await page.evaluate(() => window.doompileEditor.getDocument()),
    ).toEqual(before);
  }
  await line.dblclick({ position: { x: 24, y: 12 } });
  await expect
    .poll(() =>
      line.evaluate((element) => {
        const editor = (element.closest(".tiptap") as any).editor;
        return !editor.state.selection.empty && !getSelection()?.isCollapsed;
      }),
    )
    .toBe(true);
  const selected = await page.evaluate(() => {
    const editor = (document.querySelector(".tiptap") as any).editor;
    return {
      text: getSelection()?.toString(),
      selection: editor.state.selection.toJSON(),
    };
  });
  expect(selected.text?.length).toBeGreaterThan(0);
  expect(await swipeParagraph(line, 85)).toMatchObject({
    moved: false,
    ended: false,
  });
  expect(
    await page.evaluate(() =>
      (
        document.querySelector(".tiptap") as any
      ).editor.state.selection.toJSON(),
    ),
  ).toEqual(selected.selection);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    selected.text,
  );
  await line.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  await expect(line).toHaveText("Select these words!");
  await expect(line).not.toHaveAttribute("data-indent");
});

test("selection changes, long presses and interrupted or vertical gestures do not indent", async ({
  page,
}) => {
  for (const options of [
    { hold: true },
    { interrupt: "selection" },
    { interrupt: "contextmenu" },
    { interrupt: "multitouch" },
    { verticalFirst: true },
    { start: "viewport-edge" },
  ] as const) {
    await openTouchDocument(page, doc(paragraph("Preserve this paragraph")));
    const line = page.locator(".tiptap > p").first();
    expect(await swipeParagraph(line, 85, options)).toMatchObject({
      moved: false,
      ended: false,
    });
    await expect(line).not.toHaveAttribute("data-indent");
  }
});

test("the gutter follows wrapped and already indented paragraphs on phone and tablet", async ({
  page,
}) => {
  const text =
    "A wrapped paragraph keeps all its words while its leading gutter follows the current indentation.";
  for (const width of [390, 1024]) {
    await openTouchDocument(
      page,
      doc(paragraph("Caret"), { ...paragraph(text), attrs: { indent: 2 } }),
      width,
    );
    if (width > 390)
      await page.addStyleTag({
        content: ".tiptap { font-size: 30px !important; }",
      });
    const line = page.locator(".tiptap > p").nth(1);
    const visualLines = await line.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    });
    expect(visualLines).toBeGreaterThan(1);
    expect(
      await swipeParagraph(line, 85, { start: "outside-gutter" }),
    ).toMatchObject({ moved: false, ended: false });
    expect(await swipeParagraph(line, 85, { visualLine: 1 })).toMatchObject({
      moved: true,
      ended: true,
      startsOutsideText: true,
      targetInsideText: false,
    });
    await expect(line).toHaveAttribute("data-indent", "3");
    await swipeParagraph(line, -30, { visualLine: 1 });
    await expect(line).toHaveAttribute("data-indent", "2");
    await expect(line).toHaveText(text);
  }
});

test("gutter swipes nest and lift bullet, ordered and task list items", async ({
  page,
}) => {
  for (const type of ["bulletList", "orderedList", "taskList"]) {
    const itemType = type === "taskList" ? "taskItem" : "listItem";
    await openTouchDocument(
      page,
      doc(paragraph("Caret"), {
        type,
        content: ["First", "Second"].map((text) => ({
          type: itemType,
          content: [paragraph(text)],
        })),
      }),
    );
    const second = page.getByText("Second", { exact: true });
    expect(await swipeParagraph(second, 85)).toMatchObject({
      moved: true,
      ended: true,
      startsOutsideText: true,
      targetInsideText: false,
    });
    await expect(page.locator("li li p")).toHaveText("Second");
    await swipeParagraph(second, -30);
    await expect(page.locator("li li")).toHaveCount(0);
    await swipeParagraph(second, -30);
    await expect(page.locator(".tiptap > :is(ul, ol) > li")).toHaveCount(2);
  }
});

test("compact native capture accepts its narrow gutter and keeps the typing caret", async ({ page }) => {
  await openTouchDocument(page, doc(paragraph("Caret"), paragraph("Target")));
  await page.evaluate(() => {
    window.doompileEditor.setTouchMode(false);
    window.doompileEditor.setCaptureMode(true);
  });
  const caret = page.locator(".tiptap > p").first();
  const target = page.locator(".tiptap > p").nth(1);
  await caret.click();
  await page.keyboard.press("End");
  expect(await swipeParagraph(target, 85, { gutterInset: 2 })).toMatchObject({
    moved: true,
    ended: true,
    startsOutsideText: true,
    targetInsideText: false,
  });
  await expect(target).toHaveAttribute("data-indent", "1");
  await page.keyboard.type("!");
  await expect(caret).toHaveText("Caret!");
  await expect(caret).not.toHaveAttribute("data-indent");
});

test("native image paste stores the image bytes before inserting it", async ({ page }) => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV4sAAAAASUVORK5CYII=";
  await page.route("**/pasted.png", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from(png, "base64"),
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, "webkit", { configurable: true, value: {
      messageHandlers: {
        doompile: { postMessage: () => {} },
        storePastedImage: { postMessage: async (image: { name: string; mimeType: string; data: string }) => {
          (window as any).pastedImage = image;
          return { name: image.name, mimeType: image.mimeType, url: "http://localhost:4175/pasted.png" };
        } },
      },
    } });
  });
  await page.goto("/editor.html");
  const editor = page.getByRole("textbox");
  await editor.click();
  const paste = (withFile: boolean, src: string) => editor.evaluate((element, { withFile, src, png }) => {
    const data = new DataTransfer();
    data.setData("text/html", `<img src="${src}">`);
    if (withFile) data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, { withFile, src, png });

  await paste(false, "file:///missing.png");
  await expect(page.getByRole("alert")).toContainText("Не удалось прочитать изображение");
  await expect(editor.locator("[data-original-src]")).toHaveCount(0);

  await paste(true, "blob:https://example.com/copied-image");
  await expect.poll(() => page.evaluate(() => (window as any).pastedImage)).toEqual({ name: "pasted.png", mimeType: "image/png", data: png });
  const image = editor.getByRole("img", { name: "pasted.png" });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  await expect(page.getByRole("alert")).toBeHidden();

  await paste(false, `data:image/png;base64,${png}`);
  await expect(editor.locator('img[data-original-src]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).pastedImage.name)).toBe("Изображение.png");
});

test("native touch layout fits an iPhone and suppresses desktop formatting chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto("/editor.html");
  await page.evaluate(() => {
    const api = (window as any).doompileEditor;
    api.setTheme("light");
    api.setTouchMode(true);
    api.focus();
  });
  await page.keyboard.type("Touch text");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("toolbar")).toBeHidden();
  await expect(page.locator(".block-handle")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  const padding = await page
    .locator(".block-editor")
    .evaluate((node) => getComputedStyle(node).paddingLeft);
  expect(padding).toBe("22px");
});

test("native touch table tools edit structure and Tab enters the next cell", async ({
  page,
}) => {
  await page.goto("/editor.html");
  await page.evaluate(() => {
    const api = (window as any).doompileEditor;
    api.setTouchMode(true);
    api.focus();
  });
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.evaluate(() => (window as any).doompileEditor.command("table"));
  await expect(page.locator("table tr")).toHaveCount(3);
  await page.keyboard.type("Cell");
  await page.evaluate(() => (window as any).doompileEditor.command("tableRow"));
  await expect(page.locator("table tr")).toHaveCount(4);
  await page.evaluate(() =>
    (window as any).doompileEditor.command("tableColumn"),
  );
  await expect(page.locator("table tr").first().locator("th, td")).toHaveCount(
    4,
  );
  await page.evaluate(() => (window as any).doompileEditor.command("indent"));
  await page.keyboard.type("Next");
  await expect(page.locator("table")).toContainText("Next");
  await page.evaluate(() =>
    (window as any).doompileEditor.command("deleteTable"),
  );
  await expect(page.locator("table")).toHaveCount(0);
});

test("native short note fills the page and blank-page taps focus without touching text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/editor.html");
  await page.evaluate(() => {
    const api = (window as any).doompileEditor;
    api.setTouchMode(true);
    api.setTheme("light");
    api.setDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Short note" }] },
      ],
    });
  });
  const editor = page.getByRole("textbox");
  const bounds = (await editor.boundingBox())!;
  expect(bounds.y + bounds.height).toBeGreaterThan(680);
  await page.mouse.click(180, 610);
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" extended");
  await expect(editor).toContainText("Short note extended");
  await page.evaluate(() => (window as any).doompileEditor.setTheme("dark"));
  expect(
    await page
      .locator("html")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(22, 22, 23)");
});
