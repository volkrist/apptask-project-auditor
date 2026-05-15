import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  launchApptaskContext,
  PERSISTENT_PROFILE_DIR,
} from "../src/adapters/apptask/auth.js";
import {
  BOARD_READY_TIMEOUT_MS,
  openBoardWithReadiness,
  BoardNotReadyError,
} from "../src/adapters/apptask/board.js";

const BOARD_URL =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";

console.log(`Profile: ${PERSISTENT_PROFILE_DIR}`);
console.log("Launching headed Chromium + DevTools…\n");

const context = await launchApptaskContext({ devtools: true });
const page = context.pages()[0] ?? (await context.newPage());

const readiness = openBoardWithReadiness(page, BOARD_URL).then(
  (d) => {
    console.log(`\n✓ readiness PASS — columns: "${d.matchedColumn}"`);
    return d;
  },
  (err) => {
    if (err instanceof BoardNotReadyError) {
      const d = err.diagnostics;
      console.log("\n✗ readiness FAIL (180s)");
      console.log(`  screenshot: ${d.artifacts.screenshot ?? "n/a"}`);
      console.log(`  html:       ${d.artifacts.html ?? "n/a"}`);
      console.log(`  network:    ${d.artifacts.network ?? "n/a"}`);
      console.log(`  failed requests: ${d.failedRequests.length}`);
      for (const f of d.failedRequests) {
        console.log(`    ${f.method} ${f.url} — ${f.error ?? ""}`);
      }
      console.log(`  console errors: ${d.consoleErrors.length}`);
      for (const c of d.consoleErrors.slice(0, 20)) {
        console.log(`    ${c}`);
      }
    } else {
      console.error(err);
    }
  },
);

console.log(`Opened: ${BOARD_URL}`);
console.log(`Waiting up to ${BOARD_READY_TIMEOUT_MS / 1000}s for column text…`);
console.log("Browser stays open for manual diagnosis.\n");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter to close the browser… ");
rl.close();

await readiness.catch(() => undefined);
await context.close();
