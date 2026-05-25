import { assertProfileExists } from "../../src/adapters/apptask/auth.js";
import { openBoardWithReadiness, BOARD_READY_TIMEOUT_MS } from "../../src/adapters/apptask/board.js";
import {
  closeTaskCard,
  openTaskCard,
  parseTaskCard,
} from "../../src/adapters/apptask/card.js";
import { collectTaskRefsFromBoard } from "../../src/adapters/apptask/collect.js";
import { parseBoardId } from "../../src/adapters/apptask/urls.js";
import { test, expect } from "./apptask.fixture.js";

const BOARD_URL =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";

test.describe("AppTask task parser", () => {
  test.beforeAll(() => {
    assertProfileExists();
  });

  test.setTimeout(BOARD_READY_TIMEOUT_MS + 120_000);

  test("parse first task card", async ({ page }) => {
    const boardId = parseBoardId(BOARD_URL);
    expect(boardId).toBeTruthy();

    await openBoardWithReadiness(page, BOARD_URL);
    const refs = await collectTaskRefsFromBoard(page);
    expect(refs.length).toBeGreaterThan(0);

    const ref = refs[0]!;
    const opened = await openTaskCard(page, ref, BOARD_URL, boardId!);
    expect(opened.ok).toBe(true);
    const task = await parseTaskCard(page, ref);
    await closeTaskCard(page);

    expect(task.url).toMatch(/\/board\/\d+\/\d+/);
    expect(task.id).toBeTruthy();
  });
});
