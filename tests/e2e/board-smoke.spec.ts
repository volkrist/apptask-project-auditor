import {
  openBoardWithReadiness,
  BOARD_READY_TIMEOUT_MS,
} from "../../src/adapters/apptask/board.js";
import { assertProfileExists } from "../../src/adapters/apptask/auth.js";
import { boardUrlPattern } from "../../src/adapters/apptask/urls.js";
import { test, expect } from "./apptask.fixture.js";

const BOARD_URL =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";

test.describe("AppTask board (persistent profile)", () => {
  test.beforeAll(() => {
    assertProfileExists();
  });

  test.setTimeout(BOARD_READY_TIMEOUT_MS + 60_000);

  test("Kanban columns visible", async ({ page }) => {
    const result = await openBoardWithReadiness(page, BOARD_URL);

    expect(result.ready).toBe(true);
    expect(result.url).toMatch(boardUrlPattern("445"));
    expect(result.matchedColumn).toBeTruthy();
  });
});
