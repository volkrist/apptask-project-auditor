import type { Locator, Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import { saveParseFailureArtifacts } from "./parse-debug.js";
import { BOARD_SELECTORS, TASK_MODAL_SELECTORS } from "./selectors.js";
import type { TaskRef } from "./task-ref.js";
import { emptyRawTask, type RawTask } from "./types.js";
import { parseTaskIdFromUrl, taskUrlPattern } from "./urls.js";

const log = createLogger("card");

const OPEN_CARD_TIMEOUT_MS = 30_000;
const MODAL_WAIT_MS = 30_000;

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

export async function openTaskCard(
  page: Page,
  ref: TaskRef,
  boardId: string,
): Promise<void> {
  log.info(
    `open card: category=${ref.categoryId} taskId=${ref.taskId ?? "?"} title="${ref.titlePreview ?? ""}"`,
  );

  const card = await taskCardLocator(page, ref);
  await card.scrollIntoViewIfNeeded();
  await card.click();

  await page.waitForURL(taskUrlPattern(boardId), {
    timeout: OPEN_CARD_TIMEOUT_MS,
  });

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
  const modal = page.locator(TASK_MODAL_SELECTORS.root);
  await modal.waitFor({ state: "visible", timeout: MODAL_WAIT_MS });
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

async function readDateField(modal: Locator, caption: string): Promise<string | null> {
  const aside = asideScope(modal);
  const block = aside.locator(".modal-card-body__wrapper").filter({
    has: modal.page().locator(".form-field__caption", { hasText: caption }),
  });
  if (!(await block.count())) return null;
  const text = normalizeText(
    await block
      .locator(".modal-card-term__text")
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null),
  );
  if (!text || text === "Поставить срок") return null;
  return text;
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

async function readAssignees(modal: Locator): Promise<string[]> {
  const section = modal.locator(".modal-card-settings__item--executors");
  const overlays = section.locator(".project-user--modal-card .parent-overlay");
  const count = await overlays.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = await readMemberName(overlays.nth(i));
    if (name && !name.includes("Добавить")) names.push(name);
  }
  return names;
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
    task.assignees = await readAssignees(modal);
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
