import type { RawTask } from "../adapters/apptask/types.js";
import type { AuditProfile } from "../config/audit-profiles.js";
import { CONTRACT_TURBOWEAVE_V1 } from "../config/audit-profiles.js";
import { isUiRelatedTask } from "../rules/task-ui.js";
import { isFlowOrServiceTask } from "./task-classification.js";

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
