import type { RawTask } from "../adapters/apptask/types.js";
import type { AuditProfile } from "../config/audit-profiles.js";
import { CONTRACT_TURBOWEAVE_V1 } from "../config/audit-profiles.js";
import { isUiRelatedTask } from "../rules/task-ui.js";
import { isFlowOrServiceTask, partitionTasksForAudit } from "./task-classification.js";

export type TaskTypeBucket = "flow" | "ui" | "regular" | "unknown";

const REGULAR_TYPE_RE =
  /\(3d\)|\(front\)|\(ui\/ux\)|backend|gamedesign|аналитик|unity|тестирован/i;

/** Классификация задачи для отчёта «Разделение на типы задач». */
export function classifyTaskType(
  task: RawTask,
  profile: AuditProfile = CONTRACT_TURBOWEAVE_V1,
): TaskTypeBucket {
  if (isFlowOrServiceTask(task, profile)) {
    return "flow";
  }
  if (isUiRelatedTask(task)) {
    return "ui";
  }

  const text = [
    task.title,
    task.category,
    task.stage,
    ...(task.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  if (REGULAR_TYPE_RE.test(text)) {
    return "regular";
  }
  if (task.category?.trim() || task.stage?.trim()) {
    return "regular";
  }
  if (!task.title?.trim()) {
    return "unknown";
  }
  return "regular";
}

export type TaskTypeClassificationSummary = {
  total: number;
  flow: number;
  ui: number;
  regular: number;
  unknown: number;
  unknownExamples: Array<{ id: string; title: string }>;
};

export function summarizeTaskTypes(
  tasks: RawTask[],
  profile: AuditProfile = CONTRACT_TURBOWEAVE_V1,
): TaskTypeClassificationSummary {
  const summary: TaskTypeClassificationSummary = {
    total: tasks.length,
    flow: 0,
    ui: 0,
    regular: 0,
    unknown: 0,
    unknownExamples: [],
  };

  for (const task of tasks) {
    const bucket = classifyTaskType(task, profile);
    summary[bucket]++;
    if (
      bucket === "unknown" &&
      summary.unknownExamples.length < 10 &&
      task.id
    ) {
      summary.unknownExamples.push({
        id: task.id,
        title: task.title ?? "(без названия)",
      });
    }
  }

  return summary;
}

const UI_RULE_IDS =
  "ui_has_mockup_link, ui_mockup_approved, ui_adaptive_requirements, ui_browser_device_requirements";

function flowMatchReason(
  task: RawTask,
  profile: AuditProfile,
): string | null {
  const title = task.title?.trim() ?? "";
  if (title && profile.flowTaskPatterns.some((p) => p.test(title))) {
    return `название совпало с потоковым шаблоном: «${title}»`;
  }
  const category = task.category?.trim() ?? "";
  if (category && profile.flowCategoryPatterns.some((p) => p.test(category))) {
    return `категория «${category}» — потоковая/сервисная`;
  }
  for (const tag of task.tags ?? []) {
    if (tag && profile.flowTagPatterns.some((p) => p.test(tag))) {
      return `тег «${tag}» — потоковая/сервисная`;
    }
  }
  return null;
}

/** Пояснение, почему задача попала в тип. */
export function explainTaskClassification(
  task: RawTask,
  profile: AuditProfile = CONTRACT_TURBOWEAVE_V1,
): { bucket: TaskTypeBucket; reason: string; appliedRules: string } {
  const flowReason = flowMatchReason(task, profile);
  if (flowReason) {
    return {
      bucket: "flow",
      reason: flowReason,
      appliedRules: "исключена из карточного аудита (потоковая/сервисная)",
    };
  }

  if (isUiRelatedTask(task)) {
    const title = task.title ?? "";
    let reason = "маркер UI/front в названии, категории или тегах";
    if (/\(ui\/ux\)|\(ui\)|\(ux\)/i.test(title)) {
      reason = "суффикс (UI/UX) или (UI) в названии";
    } else if (/(^|\s)ui(\s|:)/i.test(title)) {
      reason = "префикс UI: в названии";
    }
    return {
      bucket: "ui",
      reason,
      appliedRules: UI_RULE_IDS,
    };
  }

  const text = [
    task.title,
    task.category,
    task.stage,
    ...(task.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  if (REGULAR_TYPE_RE.test(text)) {
    const m = text.match(/\((3d|front|ui\/ux)\)/i);
    return {
      bucket: "regular",
      reason: m ? `тип «${m[0]}» в названии/полях` : "распознан тип задачи в полях",
      appliedRules: "стандартный набор task-level правил",
    };
  }
  if (task.category?.trim() || task.stage?.trim()) {
    return {
      bucket: "regular",
      reason: `заполнены category/stage: ${[task.category, task.stage].filter(Boolean).join(", ")}`,
      appliedRules: "стандартный набор task-level правил",
    };
  }
  if (!task.title?.trim()) {
    return {
      bucket: "unknown",
      reason: "пустое название, тип не определён",
      appliedRules: "—",
    };
  }
  return {
    bucket: "regular",
    reason: "обычная задача без явного UI/front маркера",
    appliedRules: "стандартный набор task-level правил",
  };
}

export type TaskClassificationRow = {
  id: string;
  title: string;
  bucket: TaskTypeBucket;
  reason: string;
  appliedRules: string;
  auditable: boolean;
};

export function buildTaskClassificationRows(
  tasks: RawTask[],
  profile: AuditProfile = CONTRACT_TURBOWEAVE_V1,
): TaskClassificationRow[] {
  const { auditable } = partitionTasksForAudit(tasks, profile);
  const auditableIds = new Set(auditable.map((t) => t.id).filter(Boolean));

  return tasks
    .filter((t) => t.id)
    .map((task) => {
      const { bucket, reason, appliedRules } = explainTaskClassification(task, profile);
      return {
        id: task.id!,
        title: task.title ?? "(без названия)",
        bucket,
        reason,
        appliedRules,
        auditable: auditableIds.has(task.id),
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}
