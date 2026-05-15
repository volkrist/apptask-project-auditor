import { defineConfig } from "@playwright/test";
import { CHROMIUM_LAUNCH_ARGS } from "./src/adapters/apptask/auth.js";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
    actionTimeout: 30_000,
    launchOptions: {
      args: [...CHROMIUM_LAUNCH_ARGS],
    },
  },
});
