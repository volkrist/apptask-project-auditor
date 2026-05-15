import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  openManualLogin,
  PERSISTENT_PROFILE_DIR,
} from "../src/adapters/apptask/auth.js";

const { context, page } = await openManualLogin({ devtools: true });

console.log("\n--- Manual login ---");
console.log(`Profile: ${PERSISTENT_PROFILE_DIR}`);
console.log("1. Log in in the Playwright window (captcha if shown).");
console.log("2. Press Enter here when done.\n");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter after login… ");
rl.close();

console.log(`Logged in at: ${page.url()}`);
await context.close();
console.log("Profile saved. Next: npm run board:headed");
