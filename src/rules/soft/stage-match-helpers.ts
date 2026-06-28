import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isStageSameAsStatus(task: RawTask): boolean {
  if (!task.stage?.trim() || !task.status?.trim()) return false;
  return normalizeLabel(task.stage) === normalizeLabel(task.status);
}

export function stageMatchesStatus(
  stage: string,
  status: string,
  config: AuditConfig,
): boolean {
  const expected = config.stageByStatus[status];
  if (!expected?.length) return false;
  const stageLower = stage.toLowerCase();
  return expected.some((fragment) => stageLower.includes(fragment.toLowerCase()));
}

export function configuredStatusLabels(config: AuditConfig): string {
  return Object.keys(config.stageByStatus).join(", ");
}

export function expectedStageMarkers(
  status: string,
  config: AuditConfig,
): string {
  const markers = config.stageByStatus[status];
  return markers?.length ? markers.join(", ") : "—";
}
