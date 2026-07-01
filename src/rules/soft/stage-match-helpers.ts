import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isStageSameAsStatus(task: RawTask): boolean {
  if (!task.stage?.trim() || !task.status?.trim()) return false;
  return normalizeLabel(task.stage) === normalizeLabel(task.status);
}

/** @deprecated Маркеры stageByStatus; правило stage_matches_column больше не использует. */
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

function findBoardStageKey(
  boardMap: Record<string, readonly string[]>,
  stage: string,
): string | undefined {
  const stageNorm = normalizeLabel(stage);
  return Object.keys(boardMap).find((k) => normalizeLabel(k) === stageNorm);
}

/** Явный allowlist этап→статусы для доски (TurboWeave 783 и др.). */
export function isBoardStageAllowed(
  boardId: string | null | undefined,
  stage: string,
  status: string,
  config: AuditConfig,
): boolean {
  const id = boardId?.trim();
  if (!id) return false;
  const boardMap = config.boardStageByStatus[id];
  if (!boardMap) return false;
  const stageKey = findBoardStageKey(boardMap, stage);
  if (!stageKey) return false;
  const statusNorm = normalizeLabel(status);
  return boardMap[stageKey]!.some((s) => normalizeLabel(s) === statusNorm);
}

/**
 * Этап считается корректным: заполнен и не дублирует статус колонки.
 * boardStageByStatus используется для явного PASS-reason на известных досках.
 */
export function stageColumnCheckPasses(task: RawTask): boolean {
  if (!task.stage?.trim() || !task.status?.trim()) return false;
  return !isStageSameAsStatus(task);
}
