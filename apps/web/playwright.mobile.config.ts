import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);
export default defineConfig({
  testDir: "./test",
  testMatch: ["mobile.spec.ts", "auth.spec.ts", "telemetry.spec.ts"],
  fullyParallel: false,
  outputDir: "../../test-results/mobile-web",
  use: { baseURL: "http://127.0.0.1:4191", trace: "retain-on-failure" },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath: chrome,
        },
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command:
      "node scripts/test-web-server.mjs mobile 4191",
    cwd: "../..",
    url: "http://127.0.0.1:4191",
    reuseExistingServer: false,
  },
});
