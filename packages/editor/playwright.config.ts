import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  outputDir: "../../test-results/editor",
  testMatch: ["editor.spec.ts", "review.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:4175", trace: "retain-on-failure" },
  projects: [
    {
      name: "web-chromium",
      testMatch: "*.web.spec.ts",
      use: {
        browserName: "chromium",
        baseURL: "http://127.0.0.1:4176",
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    {
      name: "web-webkit",
      testMatch: "*.web.spec.ts",
      use: { browserName: "webkit", baseURL: "http://127.0.0.1:4176" },
    },
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: "node scripts/test-web-server.mjs editor 4176",
      cwd: "../..",
      url: "http://127.0.0.1:4176",
      reuseExistingServer: false,
    },
    {
      command: "npm run editor:build && node packages/editor/test/serve.mjs",
      cwd: "../..",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: false,
    },
  ],
});
