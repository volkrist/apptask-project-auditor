import { test as base } from "@playwright/test";
import { launchApptaskContext } from "../../src/adapters/apptask/auth.js";

/** Headed persistent Chromium profile — no storageState. */
export const test = base.extend({
  context: async ({}, use) => {
    const context = await launchApptaskContext();
    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect } from "@playwright/test";
