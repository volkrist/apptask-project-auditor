import type { RawTask } from "../adapters/apptask/types.js";
import type { AuditProfile } from "../config/audit-profiles.js";
import { CONTRACT_TURBOWEAVE_V1 } from "../config/audit-profiles.js";

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function isFlowOrServiceTask(
  task: RawTask,
  profile: AuditProfile = CONTRACT_TURBOWEAVE_V1,
): boolean {
  const title = task.title?.trim() ?? "";
  if (title && matchesAny(title, profile.flowTaskPatterns)) {
    return true;
  }

  const category = task.category?.trim() ?? "";
  if (category && matchesAny(category, profile.flowCategoryPatterns)) {
    return true;
  }

  for (const tag of task.tags ?? []) {
    if (tag && matchesAny(tag, profile.flowTagPatterns)) {
      return true;
    }
  }

  return false;
}

export function partitionTasksForAudit(
  tasks: RawTask[],
  profile: AuditProfile,
): {
  auditable: RawTask[];
  excludedFlow: RawTask[];
} {
  const auditable: RawTask[] = [];
  const excludedFlow: RawTask[] = [];
  for (const task of tasks) {
    if (isFlowOrServiceTask(task, profile)) {
      excludedFlow.push(task);
    } else {
      auditable.push(task);
    }
  }
  return { auditable, excludedFlow };
}
