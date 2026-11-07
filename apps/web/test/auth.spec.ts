import { test, expect } from "@playwright/test";
import { createNote, type Note } from "../../../packages/core/src/index";
const a = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Alice",
  email: "alice@example.test",
  provider: "google",
  admin: false,
};
const b = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Bob",
  email: "bob@example.test",
  provider: "google",
  admin: false,
};
const configuration = {
  providers: [
    { id: "yandex", enabled: true },
    { id: "google", enabled: false },
  ],
  development: false,
};
test("typing across a save acknowledgement keeps one note through repeated autosaves", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const initial = createNote({
    title: "Original",
    plainText: "Original",
    revision: 1,
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Original" }] },
      ],
    },
  });
  const notes = new Map<string, Note>([[initial.id, initial]]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false,
    requests = 0,
    conflicts = 0;
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { ...configuration, authenticated: true, user: a } }),
  );
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [...notes.values()] } }),
  );
  await page.route("**/api/notes/*", async (route) => {
    const { note, baseRevision } = route.request().postDataJSON();
    if (++requests === 1) {
      started = true;
      await held;
    }
    const current = notes.get(note.id);
    if ((current?.revision ?? 0) !== baseRevision) {
      conflicts++;
      await route.fulfill({ status: 409, json: { current } });
      return;
    }
    const saved = { ...note, revision: baseRevision + 1 };
    notes.set(saved.id, saved);
    await route.fulfill({ json: { note: saved } });
  });
  await page.goto("/");
  await page.locator(".note-row").first().click();
  const editor = page.getByRole("textbox", { name: "Текст заметки" });
  await editor.fill("First edit");
  await expect.poll(() => started).toBe(true);
  await editor.fill("Typing while the first save is in flight");
  release();
  await expect
    .poll(() => notes.get(initial.id)?.plainText)
    .toBe("Typing while the first save is in flight");
  for (const text of ["Third edit", "Fourth edit", "Final edit"]) {
    await editor.fill(text);
    await expect.poll(() => notes.get(initial.id)?.plainText).toBe(text);
    await expect(page.locator(".note-row")).toHaveCount(1);
  }
  expect(conflicts).toBe(0);
  expect(notes.size).toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toContainText("Final edit");
});
test("the public landing offers cloud sign-in, self-hosting, and source code", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { ...configuration, authenticated: false, user: null },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("ОТКРЫТЫЙ КОД · MIT", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Заходи. Сохраняй." }),
  ).toBeVisible();
  const repositoryUrl = "https://github.com/hammersmithg1/doompile";
  const quickStartUrl = `${repositoryUrl}/blob/main/docs/get-started.md`;
  await expect(
    page.getByRole("link", { name: "Код на GitHub" }),
  ).toHaveAttribute("href", repositoryUrl);
  await expect(
    page.getByRole("link", { name: "Быстрый старт" }),
  ).toHaveAttribute("href", quickStartUrl);
  await expect(
    page.getByRole("link", { name: "Развернуть у себя" }),
  ).toHaveAttribute("href", `${quickStartUrl}#свой-сервер`);
  await page.getByRole("link", { name: "Начать в браузере" }).click();
  await expect(page).toHaveURL(/#sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Заходи. Сохраняй." }),
  ).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Войти через Яндекс" }),
  ).toHaveAttribute("href", /\/api\/auth\/yandex\?returnTo=/);
  await expect(page.getByRole("button", { name: /Google/ })).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("account switches isolate IndexedDB, drafts and old tabs before any queued writes", async ({
  page,
  context,
}) => {
  let current = a;
  const sent: string[] = [];
  await context.route("**/api/session", (route) =>
    route.fulfill({
      json: { ...configuration, authenticated: true, user: current },
    }),
  );
  await context.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [] } }),
  );
  await context.route("**/api/notes/*", async (route) => {
    const owner = route.request().headers()["x-doompile-user-id"];
    if (owner !== current.id) {
      await route.fulfill({ status: 401, json: { error: "Account changed" } });
      return;
    }
    sent.push(owner);
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { note: { ...body.note, revision: 1 } } });
  });
  await page.goto("/");
  const quick = page.getByRole("textbox", { name: "Быстрая заметка" });
  await quick.fill("Личная мысль Алисы");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.locator(".note-row")).toContainText("Личная мысль Алисы");
  await expect.poll(() => sent.length).toBe(1);
  await quick.fill("Черновик Алисы");
  const other = await context.newPage();
  current = b;
  await other.goto("/");
  await expect(
    other.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toHaveValue("");
  await expect(other.locator(".note-row")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toHaveValue("");
  await expect(page.locator(".note-row")).toHaveCount(0);
  expect(sent).toEqual([a.id]);
  await other.close();
  current = a;
  await page.reload();
  await expect(quick).toHaveValue("Черновик Алисы");
  await expect(page.locator(".note-row")).toContainText("Личная мысль Алисы");
});
test("unowned legacy local notes are never assigned to the next person who signs in", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { ...configuration, authenticated: true, user: b } }),
  );
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [] } }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("doompile-draft", "Старый личный черновик"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Быстрая заметка" }),
  ).toHaveValue("");
  await expect(page.locator(".note-row")).toHaveCount(0);
});
test("the compact admin shows usage and never substitutes zero when S3 is unavailable", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        ...configuration,
        authenticated: true,
        user: { ...a, admin: true },
      },
    }),
  );
  await page.route("**/api/admin/users?*", (route) =>
    route.fulfill({
      json: {
        total: 2,
        nextOffset: null,
        users: [
          {
            ...a,
            lastLoginAt: "2026-11-01T00:00:00Z",
            lastSeenAt: "2026-11-01T00:05:00Z",
            bucket: "doompile-" + a.id,
            usage: { bytes: 1572864, objects: 2 },
          },
          {
            ...b,
            lastLoginAt: "2026-11-01T00:00:00Z",
            lastSeenAt: "2026-11-01T00:05:00Z",
            bucket: "doompile-" + b.id,
            usage: null,
          },
        ],
      },
    }),
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Пользователи" }),
  ).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("cell", { name: /1,5 МиБ/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Недоступно" })).toBeVisible();
});
