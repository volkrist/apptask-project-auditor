import type { AuditResult } from "../rules/rule-types.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { explainTaskClassification } from "../tasks/task-type-classification.js";
import type { RawTask } from "../adapters/apptask/types.js";

export type BoardClassificationCounts = {
  total: number;
  flow: number;
  ui: number;
  regular: number;
  unknown: number;
};

export type BoardClassificationRow = {
  id: string;
  title: string;
  url: string | null;
  bucket: "flow" | "ui" | "regular" | "unknown";
  bucketLabel: string;
  reason: string;
  appliedRules: string;
  excludedFromCardAudit: boolean;
};

const BUCKET_LABEL: Record<BoardClassificationRow["bucket"], string> = {
  flow: "потоковая / сервисная",
  ui: "UI/front",
  regular: "обычная",
  unknown: "неизвестно",
};

function profileFor(result: AuditResult) {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  return getAuditProfile(profileId);
}

/** Все задачи на доске: auditable + excluded (для единого summarize). */
export function allBoardTasksFromResult(result: AuditResult): RawTask[] {
  const excluded = result.meta.excludedFlowCards ?? [];
  const excludedIds = new Set(excluded.map((e) => e.id));
  const tasks: RawTask[] = [];

  for (const card of result.cards) {
    if (card.task.id && !excludedIds.has(card.task.id)) {
      tasks.push(card.task);
    }
  }
  for (const ex of excluded) {
    if (!ex.id) continue;
    tasks.push({
      id: ex.id,
      url: ex.url,
      title: ex.title,
      status: ex.status,
      assignees: ex.assignee ? [ex.assignee] : [],
      descriptionText: null,
      createdAt: null,
      startDate: null,
      dueDate: null,
      priority: null,
      tags: [],
      creator: null,
      assigneeRefs: [],
      category: null,
      stage: null,
      plannedTime: null,
      actualTime: null,
      links: [],
      attachments: [],
      comments: [],
      boardId: null,
    });
  }
  return tasks;
}

/**
 * Единый источник классификации для registry №11, TOC, summary и HTML-таблицы.
 * Исключённые потоковые карточки всегда bucket=flow (совпадает с «Исключённые карточки»).
 */
export function buildBoardClassification(result: AuditResult): {
  counts: BoardClassificationCounts;
  rows: BoardClassificationRow[];
} {
  const profile = profileFor(result);
  const excluded = result.meta.excludedFlowCards ?? [];
  const excludedIds = new Set(excluded.map((e) => e.id).filter(Boolean));

  const rows: BoardClassificationRow[] = [];

  for (const ex of excluded) {
    if (!ex.id) continue;
    rows.push({
      id: ex.id,
      title: ex.title,
      url: ex.url,
      bucket: "flow",
      bucketLabel: BUCKET_LABEL.flow,
      reason: "исключена из карточного аудита (потоковая/сервисная)",
      appliedRules: "исключена из карточного аудита (потоковая/сервисная)",
      excludedFromCardAudit: true,
    });
  }

  for (const card of result.cards) {
    const task = card.task;
    if (!task.id || excludedIds.has(task.id)) continue;
    const explained = explainTaskClassification(task, profile);
    rows.push({
      id: task.id,
      title: task.title ?? "(без названия)",
      url: task.url,
      bucket: explained.bucket,
      bucketLabel: BUCKET_LABEL[explained.bucket],
      reason: explained.reason,
      appliedRules: explained.appliedRules,
      excludedFromCardAudit: false,
    });
  }

  rows.sort((a, b) => Number(a.id) - Number(b.id));

  const counts: BoardClassificationCounts = {
    total: rows.length,
    flow: 0,
    ui: 0,
    regular: 0,
    unknown: 0,
  };
  for (const row of rows) {
    counts[row.bucket]++;
  }

  return { counts, rows };
}

export function formatClassificationSummaryLine(
  counts: BoardClassificationCounts,
): string {
  return `потоковые ${counts.flow}, UI/front ${counts.ui}, обычные ${counts.regular}, неизвестно ${counts.unknown}`;
}
