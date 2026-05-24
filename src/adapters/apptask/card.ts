import type { Locator, Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import { saveParseFailureArtifacts } from "./parse-debug.js";
import { BOARD_SELECTORS, TASK_MODAL_SELECTORS } from "./selectors.js";
import type { TaskRef } from "./task-ref.js";
import { emptyRawTask, type RawTask, type TaskAssigneeRef } from "./types.js";
import { parseTaskIdFromUrl, taskUrlPattern } from "./urls.js";

const log = createLogger("card");

const OPEN_CARD_TIMEOUT_MS = 30_000;
const MODAL_WAIT_MS = 60_000;
const GET_TASK_DETAILS_RE = /\/board\/get_task_details/i;

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

async function taskCardLocator(page: Page, ref: TaskRef): Promise<Locator> {
  const category = page.locator(`[id="${ref.categoryId}"]`);

  if (ref.taskId) {
    return page.locator(`[id="${ref.taskId}"].project-card`);
  }

  if (ref.titlePreview) {
    return category
      .locator(BOARD_SELECTORS.taskCard)
      .filter({ hasText: ref.titlePreview })
      .first();
  }

  return category.locator(BOARD_SELECTORS.taskCard).first();
}

function boardBaseUrlFromPage(page: Page, boardId: string): string {
  const match = page.url().match(/^(https?:\/\/[^/]+\/c\/\d+\/board\/\d+)/);
  return match?.[1] ?? `https://apptask.ru/c/7/board/${boardId}`;
}

export async function openTaskCard(
  page: Page,
  ref: TaskRef,
  boardId: string,
): Promise<void> {
  log.info(
    `open card: category=${ref.categoryId} taskId=${ref.taskId ?? "?"} title="${ref.titlePreview ?? ""}"`,
  );

  const detailsPromise = page.waitForResponse(
    (r) =>
      GET_TASK_DETAILS_RE.test(r.url()) &&
      r.request().method() === "POST" &&
      r.status() === 200,
    { timeout: MODAL_WAIT_MS },
  );

  if (ref.taskId) {
    const taskUrl = `${boardBaseUrlFromPage(page, boardId)}/${ref.taskId}`;
    await page.goto(taskUrl, {
      waitUntil: "domcontentloaded",
      timeout: OPEN_CARD_TIMEOUT_MS,
    });
  } else {
    const card = await taskCardLocator(page, ref);
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForURL(taskUrlPattern(boardId), {
      timeout: OPEN_CARD_TIMEOUT_MS,
    });
  }

  await detailsPromise.catch(() => undefined);
  await waitForTaskModal(page);
  log.info(`card open: ${page.url()}`);
}

export async function closeTaskCard(page: Page): Promise<void> {
  const closeBtn = page.locator(
    '.modal.detailed-task button, .modal-card-action__button',
  ).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(300);
}

async function waitForTaskModal(page: Page): Promise<Locator> {
  const modal = page.locator(TASK_MODAL_SELECTORS.root).first();
  try {
    await modal.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    await modal.waitFor({ state: "attached", timeout: 10_000 });
  }
  return modal;
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
    const modal = await waitForTaskModal(page);
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

    log.info(`parsed task id=${task.id ?? "?"} title="${task.title ?? ""}"`);
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
