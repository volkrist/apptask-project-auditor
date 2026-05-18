import "dotenv/config";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import { BOARD_SELECTORS } from "../src/adapters/apptask/selectors.js";

const BOARD_URL = process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";
const DATE_RE = /\d{1,2}\.\d{1,2}\.\d{4}/;

async function main(): Promise<void> {
  assertProfileExists();
  const ctx = await launchApptaskContext();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await openBoardWithReadiness(page, BOARD_URL);

  const cards = await page.locator(BOARD_SELECTORS.taskCard).evaluateAll((els) =>
    els.map((el) => ({
      id: el.id,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    })),
  );

  const withDates = cards.filter((c) => DATE_RE.test(c.text));
  console.log(`cards total=${cards.length} with date on tile=${withDates.length}`);
  console.log("samples:", withDates.slice(0, 8));

  await ctx.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
