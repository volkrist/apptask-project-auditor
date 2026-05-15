import fs from "node:fs";
import path from "node:path";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import {
  closeTaskCard,
  openTaskCard,
  parseTaskCard,
  ParseTaskCardError,
} from "../src/adapters/apptask/card.js";
import { collectTaskRefsFromBoard } from "../src/adapters/apptask/collect.js";
import { parseBoardId } from "../src/adapters/apptask/urls.js";

const BOARD_URL =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";

const SAMPLE_PATH = path.join("output", "samples", "task-sample.json");

async function main(): Promise<void> {
  assertProfileExists();

  const boardId = parseBoardId(BOARD_URL);
  if (!boardId) throw new Error(`Invalid board URL: ${BOARD_URL}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await openBoardWithReadiness(page, BOARD_URL);
    const refs = await collectTaskRefsFromBoard(page);

    if (refs.length === 0) {
      throw new Error("No task cards found on board after expanding categories");
    }

    const ref = refs[0]!;
    console.log(`Sample card: ${JSON.stringify(ref)}`);

    await openTaskCard(page, ref, boardId);
    const task = await parseTaskCard(page, ref);
    await closeTaskCard(page);

    fs.mkdirSync(path.dirname(SAMPLE_PATH), { recursive: true });
    fs.writeFileSync(SAMPLE_PATH, JSON.stringify(task, null, 2), "utf8");
    console.log(`Saved: ${SAMPLE_PATH}`);
  } catch (err) {
    if (err instanceof ParseTaskCardError) {
      console.error(err.message);
      console.error(JSON.stringify(err.artifacts, null, 2));
    }
    throw err;
  } finally {
    await context.close();
  }
}

await main();
