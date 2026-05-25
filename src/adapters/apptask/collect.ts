import type { Locator, Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import { BOARD_SELECTORS } from "./selectors.js";
import type { TaskRef } from "./task-ref.js";

const log = createLogger("collect");

const EXPAND_WAIT_MS = 500;
const CATEGORY_WAIT_MS = 60_000;

async function waitForCategories(page: Page): Promise<void> {
  const categories = page.locator(BOARD_SELECTORS.category);
  await categories.first().waitFor({ state: "attached", timeout: CATEGORY_WAIT_MS });
  log.info(`categories attached: ${await categories.count()}`);
}

/** Expand all collapsed category sections on the board. */
export async function expandAllCategories(page: Page): Promise<void> {
  const categories = page.locator(BOARD_SELECTORS.category);
  const count = await categories.count();
  log.info(`categories on board: ${count}`);

  for (let i = 0; i < count; i++) {
    const category = categories.nth(i);
    const body = category.locator(BOARD_SELECTORS.categoryBody);
    const hidden = await body.isHidden().catch(() => true);

    if (hidden) {
      await category.locator(BOARD_SELECTORS.categoryHeader).first().click();
      await page.waitForTimeout(EXPAND_WAIT_MS);
      await body
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => undefined);
    }
  }
}

function parseColumnStateId(wrapperId: string | null): string | null {
  if (!wrapperId) return null;
  const parts = wrapperId.split(":");
  return parts.length === 2 ? parts[1]! : null;
}

async function readCardTitle(card: Locator): Promise<string | null> {
  const titleLoc = card.locator(BOARD_SELECTORS.taskCardTitle).first();
  if (await titleLoc.count()) {
    const text = (await titleLoc.textContent())?.trim();
    if (text) return text;
  }
  const text = (await card.textContent())?.trim();
  return text || null;
}

/**
 * Collect task card references from an open board page.
 * Call after board readiness; expands categories first.
 */
export async function collectTaskRefsFromBoard(page: Page): Promise<TaskRef[]> {
  await waitForCategories(page);
  await expandAllCategories(page);

  const refs: TaskRef[] = [];
  const categories = page.locator(BOARD_SELECTORS.category);
  const categoryCount = await categories.count();

  for (let c = 0; c < categoryCount; c++) {
    const category = categories.nth(c);
    const categoryId = (await category.getAttribute("id")) ?? String(c);
    const categoryName =
      (await category.locator(BOARD_SELECTORS.categoryName).first().textContent())
        ?.trim() ?? null;

    const columns = category.locator(".project-category-body__column");
    const columnCount = await columns.count();

    if (columnCount === 0) {
      await collectCardsInContainer(
        category,
        categoryId,
        categoryName,
        null,
        refs,
      );
      continue;
    }

    for (let col = 0; col < columnCount; col++) {
      const column = columns.nth(col);
      const wrapperId =
        (await column.locator(".task-drop-container").first().getAttribute("id")) ??
        null;
      const columnStateId = parseColumnStateId(wrapperId);
      await collectCardsInContainer(
        column,
        categoryId,
        categoryName,
        columnStateId,
        refs,
      );
    }
  }

  log.info(`collected task refs: ${refs.length}`);
  return refs;
}

async function collectCardsInContainer(
  container: Locator,
  categoryId: string,
  categoryName: string | null,
  columnStateId: string | null,
  refs: TaskRef[],
): Promise<void> {
  const cards = container.locator(BOARD_SELECTORS.taskCard);
  const cardCount = await cards.count();

  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;

    const rawId = await card.getAttribute("id");
    const taskId = rawId && /^\d+$/.test(rawId) ? rawId : null;
    const titlePreview = await readCardTitle(card);

    refs.push({
      categoryId,
      categoryName,
      columnStateId,
      taskId,
      titlePreview,
    });
  }
}
