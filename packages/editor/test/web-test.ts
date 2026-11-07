import { test as base } from "@playwright/test";
export { expect, type Page } from "@playwright/test";
export const browserTestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "browser@example.test",
  name: "Browser test",
  provider: "google",
  admin: false,
};
/** UI editor tests mock their API; authentication is an explicit fixture too. */
export const test = base.extend({
  page: async ({ page, context }, use) => {
    await context.route("**/api/session", (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          user: browserTestUser,
          providers: [
            { id: "yandex", enabled: false },
            { id: "google", enabled: false },
          ],
          development: false,
        },
      }),
    );
    await context.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: [] } }),
    );
    await context.route("**/api/link-preview?**", (route) => {
      const url = new URL(route.request().url()).searchParams.get("url")!;
      return route.fulfill({
        json: { url, title: "", description: "", siteName: new URL(url).hostname, type: "website" },
      });
    });
    await use(page);
  },
});
