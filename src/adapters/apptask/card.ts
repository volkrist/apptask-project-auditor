import type { Locator, Page } from "@playwright/test";
import { expandAllCategories } from "./collect.js";
import {
  loadCardOpenStrategy,
  loadCardOpenTimeouts,
  resolveOpenAttempts,
} from "./card-open-config.js";
import { saveCardOpenFailureArtifacts } from "./card-open-debug.js";
import { createLogger } from "./logger.js";
import { saveParseFailureArtifacts } from "./parse-debug.js";
import { BOARD_SELECTORS, TASK_MODAL_SELECTORS } from "./selectors.js";
import type { TaskRef } from "./task-ref.js";
import { emptyRawTask, type RawTask, type TaskAssigneeRef } from "./types.js";
import {
  boardUrlPattern,
  parseTaskIdFromUrl,
  taskUrlPattern,
} from "./urls.js";

const log = createLogger("card");

const PARSE_UI_WAIT_MS = 12_000;
const GET_TASK_DETAILS_RE = /\/board\/get_task_details/i;

/** Селекторы готовности UI карточки (строгие первыми). */
const TASK_UI_CANDIDATES: Array<{ selector: string; name: string }> = [
  {
    selector: TASK_MODAL_SELECTORS.root,
    name: TASK_MODAL_SELECTORS.root,
  },
  { selector: ".modal.detailed-task", name: ".modal.detailed-task" },
  {
    selector:
      ".modal-card-header__number, .modal-card-content__title, .modal-card-body__aside.js-asideSettings",
    name: "modal-card markers",
  },
  { selector: ".modal-card-header", name: ".modal-card-header" },
  { selector: ".modal-card.task-details", name: ".modal-card.task-details" },
  { selector: ".modal-card", name: ".modal-card" },
  { selector: '[class*="detailed-task"]', name: '[class*="detailed-task"]' },
  { selector: '[class*="modal-card"]', name: '[class*="modal-card"]' },
];

export type OpenTaskCardResult =
  | { ok: true; method: "direct" | "click"; matchedSelector: string }
  | { ok: false; reason: string };

export function buildPartialRawTask(ref: TaskRef, boardUrl: string): RawTask {
  const task = emptyRawTask();
  const base = boardUrl.replace(/\/$/, "");
  task.id = ref.taskId;
  task.url = ref.taskId ? `${base}/${ref.taskId}` : boardUrl;
  task.title = ref.titlePreview;
  task.category = ref.categoryName;
  return task;
}

export class ParseTaskCardError extends Error {
  constructor(
    message: string,
    readonly taskRef: TaskRef,
    readonly artifacts: Awaited<ReturnType<typeof saveParseFailureArtifacts>>,
  ) {
    super(message);
    this.name = "ParseTaskCardError";
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boardBaseUrl(boardUrl: string, page: Page, boardId: string): string {
  const match = page.url().match(/^(https?:\/\/[^/]+\/c\/\d+\/board\/\d+)/);
  return match?.[1] ?? boardUrl.replace(/\/$/, "");
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function waitForBoardReady(page: Page, timeoutMs: number): Promise<void> {
  await page
    .locator(BOARD_SELECTORS.category)
    .first()
    .waitFor({ state: "attached", timeout: timeoutMs });
  await expandAllCategories(page);
}

async function gotoBoard(page: Page, boardUrl: string, gotoMs: number): Promise<void> {
  await page.goto(boardUrl, {
    waitUntil: "domcontentloaded",
    timeout: gotoMs,
  });
  await waitForBoardReady(page, Math.min(gotoMs, 60_000));
}

async function ensureOnBoard(
  page: Page,
  boardUrl: string,
  boardId: string,
  gotoMs: number,
): Promise<void> {
  const onTaskDeepLink = /\/board\/\d+\/\d+/.test(page.url());
  const onBoard =
    boardUrlPattern(boardId).test(page.url()) && !onTaskDeepLink;
  if (!onBoard) {
    await gotoBoard(page, boardUrl, gotoMs);
  }
}

async function findTaskCardOnBoard(page: Page, ref: TaskRef, boardId: string): Promise<Locator | null> {
  const category = page.locator(`[id="${ref.categoryId}"]`);

  if (ref.taskId) {
    const byId = page.locator(`[id="${ref.taskId}"].project-card`);
    if (await byId.count()) return byId.first();

    const byHref = page.locator(
      `a[href*="/board/${boardId}/${ref.taskId}"], [data-id="${ref.taskId}"]`,
    );
    if (await byHref.count()) {
      const card = byHref.locator(BOARD_SELECTORS.taskCard).first();
      if (await card.count()) return card;
      return byHref.first();
    }
  }

  if (ref.titlePreview) {
    const exact = category
      .locator(BOARD_SELECTORS.taskCard)
      .filter({ hasText: ref.titlePreview })
      .first();
    if (await exact.count()) return exact;

    const loose = page
      .locator(BOARD_SELECTORS.taskCard)
      .filter({ hasText: ref.titlePreview })
      .first();
    if (await loose.count()) return loose;
  }

  if (await category.locator(BOARD_SELECTORS.taskCard).count()) {
    return category.locator(BOARD_SELECTORS.taskCard).first();
  }

  return null;
}

async function waitForTaskCardUi(
  page: Page,
  timeoutMs: number,
): Promise<{ locator: Locator; matchedSelector: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const cand of TASK_UI_CANDIDATES) {
      const loc = page.locator(cand.selector).first();
      if (!(await loc.count())) continue;
      try {
        await loc.waitFor({ state: "visible", timeout: 2_000 });
        return { locator: loc, matchedSelector: cand.name };
      } catch {
        try {
          await loc.waitFor({ state: "attached", timeout: 1_500 });
          return { locator: loc, matchedSelector: cand.name };
        } catch {
          // next candidate
        }
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function tryOpenDirect(
  page: Page,
  ref: TaskRef,
  boardUrl: string,
  boardId: string,
  uiTimeoutMs: number,
  gotoMs: number,
): Promise<{ ok: true; matchedSelector: string } | null> {
  if (!ref.taskId) return null;

  const taskUrl = `${boardBaseUrl(boardUrl, page, boardId)}/${ref.taskId}`;
  log.info(`[card] try direct url=${taskUrl}`);

  const detailsPromise = page
    .waitForResponse(
      (r) =>
        GET_TASK_DETAILS_RE.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: uiTimeoutMs },
    )
    .catch(() => null);

  await page.goto(taskUrl, {
    waitUntil: "domcontentloaded",
    timeout: gotoMs,
  });
  await detailsPromise;
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const ui = await waitForTaskCardUi(page, uiTimeoutMs);
  if (ui) return { ok: true, matchedSelector: ui.matchedSelector };

  log.info(`[card] direct url UI timeout taskId=${ref.taskId}`);
  await saveCardOpenFailureArtifacts(
    page,
    ref,
    "direct-fail",
    `direct url UI timeout (${uiTimeoutMs}ms)`,
  );
  return null;
}

async function tryOpenClick(
  page: Page,
  ref: TaskRef,
  boardUrl: string,
  boardId: string,
  uiTimeoutMs: number,
  gotoMs: number,
): Promise<{ ok: true; matchedSelector: string } | null> {
  log.info(`[card] try click fallback taskId=${ref.taskId ?? "?"}`);

  await gotoBoard(page, boardUrl, gotoMs);

  const card = await findTaskCardOnBoard(page, ref, boardId);
  if (!card) {
    log.info(`[card] click fallback: card not found on board taskId=${ref.taskId ?? "?"}`);
    return null;
  }

  const detailsPromise = page
    .waitForResponse(
      (r) =>
        GET_TASK_DETAILS_RE.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: uiTimeoutMs },
    )
    .catch(() => null);

  await card.scrollIntoViewIfNeeded();
  await card.click({ timeout: 10_000 });
  await page
    .waitForURL(taskUrlPattern(boardId), { timeout: Math.min(gotoMs, 15_000) })
    .catch(() => undefined);
  await detailsPromise;
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const ui = await waitForTaskCardUi(page, uiTimeoutMs);
  if (ui) {
    log.info(
      `[card] click fallback opened taskId=${ref.taskId ?? "?"} selector=${ui.matchedSelector}`,
    );
    return { ok: true, matchedSelector: ui.matchedSelector };
  }

  await saveCardOpenFailureArtifacts(
    page,
    ref,
    "click-fail",
    `click fallback UI timeout (${uiTimeoutMs}ms)`,
  );
  return null;
}

export async function openTaskCard(
  page: Page,
  ref: TaskRef,
  boardUrl: string,
  boardId: string,
): Promise<OpenTaskCardResult> {
  const strategy = loadCardOpenStrategy();
  const timeouts = loadCardOpenTimeouts();
  const attempts = resolveOpenAttempts(strategy, ref.taskId);
  const deadline = Date.now() + timeouts.totalMs;

  log.info(
    `[card] strategy=${strategy} taskId=${ref.taskId ?? "?"} title="${ref.titlePreview ?? ""}"`,
  );

  await ensureOnBoard(
    page,
    boardUrl,
    boardId,
    Math.min(timeouts.gotoMs, remainingMs(deadline) || timeouts.gotoMs),
  );

  let directFailed = false;

  for (const method of attempts) {
    if (remainingMs(deadline) <= 0) break;

    const uiTimeout = Math.min(
      method === "direct" ? timeouts.directUiMs : timeouts.clickUiMs,
      remainingMs(deadline),
    );
    const gotoMs = Math.min(timeouts.gotoMs, remainingMs(deadline));

    if (method === "direct") {
      const direct = await tryOpenDirect(
        page,
        ref,
        boardUrl,
        boardId,
        uiTimeout,
        gotoMs,
      );
      if (direct) {
        log.info(`[card] direct url opened taskId=${ref.taskId ?? "?"}`);
        return { ok: true, method: "direct", matchedSelector: direct.matchedSelector };
      }
      directFailed = true;
      continue;
    }

    if (directFailed) {
      log.info(
        `[card] direct URL failed, trying click fallback taskId=${ref.taskId ?? "?"}`,
      );
    }

    const clicked = await tryOpenClick(
      page,
      ref,
      boardUrl,
      boardId,
      uiTimeout,
      gotoMs,
    );
    if (clicked) {
      if (directFailed && ref.taskId) {
        log.info(
          `[card] direct URL failed, click fallback succeeded taskId=${ref.taskId}`,
        );
      }
      return { ok: true, method: "click", matchedSelector: clicked.matchedSelector };
    }
  }

  if (directFailed && ref.taskId) {
    log.info(
      `[card] direct URL failed, click fallback failed taskId=${ref.taskId}, using partial task`,
    );
  }

  return {
    ok: false,
    reason: `card UI not ready (taskId=${ref.taskId ?? "?"})`,
  };
}

export async function closeTaskCard(page: Page): Promise<void> {
  const closeBtn = page.locator(TASK_MODAL_SELECTORS.closeButton).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => undefined);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function requireTaskCardModal(page: Page): Promise<Locator> {
  const ui = await waitForTaskCardUi(page, PARSE_UI_WAIT_MS);
  if (!ui) {
    throw new Error(
      `task card UI not ready (url=${page.url()}, selectors=${TASK_MODAL_SELECTORS.root})`,
    );
  }
  const detailed = page.locator(TASK_MODAL_SELECTORS.root).first();
  if (await detailed.count()) {
    try {
      await detailed.waitFor({ state: "visible", timeout: 5_000 });
      return detailed;
    } catch {
      try {
        await detailed.waitFor({ state: "attached", timeout: 3_000 });
        return detailed;
      } catch {
        // fall through
      }
    }
  }
  return ui.locator;
}

function asideScope(modal: Locator): Locator {
  return modal.locator(TASK_MODAL_SELECTORS.aside);
}

async function readMemberName(overlay: Locator): Promise<string | null> {
  const link = overlay.locator(".user-tooltip__name");
  if (await link.count()) {
    return normalizeText(await link.textContent({ timeout: 3_000 }).catch(() => null));
  }
  const raw = await overlay
    .evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("ul, button").forEach((node) => node.remove());
      return clone.textContent?.trim() ?? "";
    })
    .catch(() => "");
  return normalizeText(raw);
}

async function readAsideSelect(modal: Locator, caption: string): Promise<string | null> {
  const aside = asideScope(modal);
  const field = aside.locator(".form-field").filter({
    has: modal.page().locator(".form-field__caption", { hasText: caption }),
  });
  if (!(await field.count())) return null;
  const value = field.locator("p.select__value, .select__value").first();
  return normalizeText(
    await value.textContent({ timeout: 5_000 }).catch(() => null),
  );
}

const EMPTY_DATE_LABELS = new Set([
  "поставить срок",
  "указать срок",
  "не указано",
  "—",
  "-",
]);

const RU_DATE_RE = /(\d{1,2}\.\d{1,2}\.\d{4})/;

function parseDateFromFieldText(text: string | null): string | null {
  if (!text) return null;
  const normalized = text.trim();
  if (!normalized) return null;
  if (EMPTY_DATE_LABELS.has(normalized.toLowerCase())) return null;
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(normalized)) return normalized;
  const match = normalized.match(RU_DATE_RE);
  return match?.[1] ?? null;
}

async function readDateField(modal: Locator, caption: string): Promise<string | null> {
  const aside = asideScope(modal);
  const captionLocator = modal.page().locator(
    ".form-field__caption, .modal-card-term__caption",
    { hasText: caption },
  );
  const block = aside.locator(".modal-card-body__wrapper").filter({ has: captionLocator });
  if (!(await block.count())) return null;

  const valueLocators = [
    block.locator(".modal-card-term__text").first(),
    block.locator(".modal-card-term a").first(),
    block.locator(".modal-card-term span").first(),
    block.locator("time").first(),
  ];

  for (const locator of valueLocators) {
    if (!(await locator.count())) continue;
    const parsed = parseDateFromFieldText(
      normalizeText(await locator.textContent({ timeout: 5_000 }).catch(() => null)),
    );
    if (parsed) return parsed;
  }

  const blockText = normalizeText(
    await block.textContent({ timeout: 5_000 }).catch(() => null),
  );
  return parseDateFromFieldText(blockText);
}

async function readTimeValue(modal: Locator, label: string): Promise<string | null> {
  const timeSection = asideScope(modal).locator(".modal-card-settings__time");
  const item = timeSection.locator(TASK_MODAL_SELECTORS.timeBlock).filter({
    has: modal.page().locator(".modal-card-time__title", { hasText: label }),
  });
  if (!(await item.count())) return null;
  const value = item.locator(TASK_MODAL_SELECTORS.timeValue).first();
  const text = normalizeText(
    await value
      .locator("span")
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null),
  );
  return text ?? normalizeText(await value.textContent({ timeout: 5_000 }).catch(() => null));
}

async function readTags(modal: Locator): Promise<string[]> {
  const tagsField = asideScope(modal).locator(".form-field--tags");
  const chips = tagsField.locator(TASK_MODAL_SELECTORS.tagChip);
  const count = await chips.count();
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = normalizeText(await chips.nth(i).textContent());
    if (text) tags.push(text);
  }
  return tags;
}

async function readAssigneeRefs(modal: Locator): Promise<TaskAssigneeRef[]> {
  const section = modal.locator(".modal-card-settings__item--executors");
  const userCards = section.locator(".project-user--modal-card");
  const count = await userCards.count();
  const refs: TaskAssigneeRef[] = [];

  for (let i = 0; i < count; i++) {
    const card = userCards.nth(i);
    if (await card.locator(".project-user--add").count()) continue;

    const rawId = await card.getAttribute("id");
    const userId =
      rawId && /^\d+$/.test(rawId) ? rawId : null;
    const overlay = card.locator(".parent-overlay").first();
    const name = await readMemberName(overlay);
    if (name && !name.includes("Добавить")) {
      refs.push({ name, userId });
    }
  }

  return refs;
}

async function readCreator(modal: Locator): Promise<string | null> {
  const creatorBlock = modal
    .locator(".modal-card-settings__executors > .modal-card-settings__item")
    .first();
  const overlay = creatorBlock.locator(".parent-overlay").first();
  if (!(await overlay.count())) return null;
  return readMemberName(overlay);
}

async function readLinks(modal: Locator): Promise<string[]> {
  const links = await modal.locator("a[href]").evaluateAll((anchors) =>
    anchors
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => Boolean(href && href.startsWith("http"))),
  );
  return [...new Set(links)];
}

async function readAttachments(modal: Locator): Promise<RawTask["attachments"]> {
  const links = modal.locator(TASK_MODAL_SELECTORS.attachmentRow);
  const count = await links.count();
  const attachments: RawTask["attachments"] = [];
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    attachments.push({
      name: normalizeText(await link.textContent()) ?? "file",
      url: normalizeText(await link.getAttribute("href")),
    });
  }
  return attachments;
}

/** Read task fields from the open card modal. Parser only — no business rules. */
export async function parseTaskCard(
  page: Page,
  taskRef: TaskRef,
): Promise<RawTask> {
  const task = emptyRawTask();
  task.category = taskRef.categoryName;

  try {
    const modal = await requireTaskCardModal(page);
    const url = page.url();
    task.url = url;
    task.id = parseTaskIdFromUrl(url);

    if (!task.id) {
      const numberText = normalizeText(
        await modal.locator(TASK_MODAL_SELECTORS.taskNumber).textContent(),
      );
      task.id = numberText?.replace(/[^\d]/g, "") || null;
    }

    task.createdAt = normalizeText(
      await modal.locator(TASK_MODAL_SELECTORS.createdAt).textContent(),
    );
    task.title = normalizeText(
      await modal.locator(TASK_MODAL_SELECTORS.title).textContent(),
    );
    task.descriptionText = normalizeText(
      await modal.locator(TASK_MODAL_SELECTORS.description).textContent(),
    );

    task.startDate = await readDateField(modal, "Дата начала");
    task.dueDate = await readDateField(modal, "Дата окончания");
    task.priority = await readAsideSelect(modal, "Приоритет");
    task.status = await readAsideSelect(modal, "Статус");
    task.tags = await readTags(modal);
    task.creator = await readCreator(modal);
    task.assigneeRefs = await readAssigneeRefs(modal);
    task.assignees = task.assigneeRefs.map((r) => r.name);
    task.stage = await readAsideSelect(modal, "Этап");
    task.category = (await readAsideSelect(modal, "Категория")) ?? task.category;
    task.actualTime = await readTimeValue(modal, "Фактическое время");
    task.plannedTime = await readTimeValue(modal, "Примерное время");
    task.links = await readLinks(modal);
    task.attachments = await readAttachments(modal);

    log.info(
      `[card] parse success taskId=${task.id ?? "?"} title="${task.title ?? ""}"`,
    );
    return task;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const artifacts = await saveParseFailureArtifacts(
      page,
      taskRef,
      "parse",
      message,
    );
    throw new ParseTaskCardError(message, taskRef, artifacts);
  }
}
