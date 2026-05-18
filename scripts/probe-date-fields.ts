import "dotenv/config";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import {
  closeTaskCard,
  openTaskCard,
  parseTaskCard,
} from "../src/adapters/apptask/card.js";
import { collectTaskRefsFromBoard } from "../src/adapters/apptask/collect.js";
import { parseBoardId } from "../src/adapters/apptask/urls.js";

const BOARD_URL = process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";
const PROBE_TITLES = ["ПМ от 18.11", "Маркетолог", "Менторинг"];

async function probeCard(
  page: Awaited<ReturnType<typeof launchApptaskContext>> extends infer C
    ? C extends { newPage(): Promise<infer P> }
      ? P
      : never
    : never,
  boardId: string,
  title: string,
): Promise<void> {
  const refs = await collectTaskRefsFromBoard(page);
  const ref = refs.find((r) => r.titlePreview?.includes(title));
  if (!ref) {
    console.log(`--- ${title}: not found ---`);
    return;
  }

  await openTaskCard(page, ref, boardId);
  const modal = page.locator(".modal-card.task-details");
  const aside = modal.locator(".modal-card-body__aside.js-asideSettings");
  const wrappers = await aside.locator(".modal-card-body__wrapper").evaluateAll((els) =>
    els.map((el) => ({
      caption: el
        .querySelector(".form-field__caption, .modal-card-term__caption")
        ?.textContent?.trim(),
      termText: el.querySelector(".modal-card-term__text")?.textContent?.trim(),
    })),
  );

  const task = await parseTaskCard(page, ref);
  console.log(`--- ${title} (id=${task.id}) ---`);
  console.log("wrappers:", JSON.stringify(wrappers.filter((w) => w.caption || w.termText), null, 2));
  console.log("parsed:", {
    title: task.title,
    startDate: task.startDate,
    dueDate: task.dueDate,
    priority: task.priority,
  });
  await closeTaskCard(page);
}

async function main(): Promise<void> {
  assertProfileExists();
  const boardId = parseBoardId(BOARD_URL);
  if (!boardId) throw new Error("Invalid board URL");

  const ctx = await launchApptaskContext();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await openBoardWithReadiness(page, BOARD_URL);

  for (const title of PROBE_TITLES) {
    await probeCard(page, boardId, title);
  }

  await ctx.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
