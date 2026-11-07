import { readFile } from "node:fs/promises";
import { test, expect } from "../../../packages/editor/test/web-test";

test("offline diagnostics survive reload, export from settings and omit authored content", async ({
  page,
  context,
}, info) => {
  const uploaded: any[] = [];
  await page.route("**/api/telemetry", (route) => {
    uploaded.push(...route.request().postDataJSON().events);
    return route.fulfill({ json: { accepted: 50 } });
  });
  await page.route("**/api/notes/*", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/");
  const quick = page.getByRole("textbox", { name: "Быстрая заметка" });
  await expect(quick).toBeVisible();
  await context.setOffline(true);
  await quick.fill("PRIVATE_CONTENT_MUST_STAY_IN_NOTES");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.locator(".note-row").first()).toContainText(
    "PRIVATE_CONTENT_MUST_STAY_IN_NOTES",
  );
  // Reopen the running app: reload navigations are fulfilled locally by Playwright.
  await context.setOffline(false);
  await page.reload();
  await expect(quick).toBeVisible();
  await context.setOffline(true);
  if (info.project.name === "iphone-webkit") {
    const shell = page.locator(".app-shell");
    await shell.dispatchEvent("touchstart", {
      touches: [{ clientX: 8, clientY: 300 }],
    });
    await shell.dispatchEvent("touchend", {
      changedTouches: [{ clientX: 160, clientY: 300 }],
    });
  }
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Поделиться диагностикой", exact: true }),
  ).toBeVisible();
  // Exercise the downloadable fallback even on a browser that implements the Share API.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
  });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Поделиться диагностикой", exact: true })
    .click();
  const file = await (await download).path();
  const text = await readFile(file!, "utf8"),
    dump = JSON.parse(text);
  expect(dump.format).toBe("doompile-diagnostics");
  expect(
    dump.events.some(
      (event: any) =>
        event.name === "note.saved" && event.properties.operation === "create",
    ),
  ).toBe(true);
  expect(
    dump.events.some(
      (event: any) =>
        event.name === "app.state" && event.properties.state === "offline",
    ),
  ).toBe(true);
  expect(text).not.toContain("PRIVATE_CONTENT_MUST_STAY_IN_NOTES");
  expect(JSON.stringify(uploaded)).not.toContain(
    "PRIVATE_CONTENT_MUST_STAY_IN_NOTES",
  );
  await page
    .getByRole("checkbox", {
      name: "Отправлять диагностику и события использования",
    })
    .uncheck();
  await expect(
    page.getByRole("checkbox", {
      name: "Отправлять диагностику и события использования",
    }),
  ).not.toBeChecked();
});
