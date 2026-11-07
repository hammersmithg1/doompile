import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: "native-capture.spec.ts",
  outputDir: "../../test-results/macos-editor",
  fullyParallel: true,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:4192", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: { command: "DOOMPILE_EDITOR_TEST_PORT=4192 node packages/editor/test/serve.mjs", cwd: "../..", url: "http://127.0.0.1:4192", reuseExistingServer: false },
});
