import type { DbConfig } from "./db-config.js";
import { closeDb } from "./db-client.js";
import {
  countActiveTasksByBoard,
  countComments,
  countDistinctAssignees,
  countDistinctTags,
  countHistories,
  countTasksByBlock,
  countTasksByStatus,
  fetchActiveTasks,
  fetchBoards,
} from "./db-queries.js";
import { buildTaskUrl } from "./db-config.js";

export type BoardProbeStats = {
  boardId: number;
  boardName: string | null;
  found: boolean;
  activeTasks: number;
  byStatus: Array<{ label: string; count: number }>;
  byBlock: Array<{ label: string; count: number }>;
  assigneeCount: number;
  tagCount: number;
  commentCount: number;
  historyCount: number;
  sampleTasks: Array<{ id: number; title: string | null; url: string }>;
  warnings: string[];
};

export type DbProbeResult = {
  boardIds: number[];
  boards: BoardProbeStats[];
  globalWarnings: string[];
};

export async function runDbCollectorProbe(
  config: DbConfig,
  boardIds: number[],
  options: { sampleSize?: number } = {},
): Promise<DbProbeResult> {
  const sampleSize = options.sampleSize ?? 10;
  const globalWarnings: string[] = [];

  if (boardIds.length === 0) {
    return {
      boardIds: [],
      boards: [],
      globalWarnings: [
        "Не заданы board IDs. Укажите APPTASK_DB_BOARD_IDS или --board-ids 783,445",
      ],
    };
  }

  const boardRows = await fetchBoards(config, boardIds);
  const boardNameById = new Map(boardRows.map((b) => [b.id, b.name]));

  const boards: BoardProbeStats[] = [];

  for (const boardId of boardIds) {
    const warnings: string[] = [];
    const boardName = boardNameById.get(boardId) ?? null;
    const found = boardNameById.has(boardId);

    if (!found) {
      warnings.push(`Доска board_id=${boardId} не найдена в dbo.Boards`);
    }

    const activeTasks = await countActiveTasksByBoard(config, boardId);
    if (found && activeTasks === 0) {
      warnings.push(`На доске board_id=${boardId} нет активных задач`);
    }

    const byStatus = (await countTasksByStatus(config, boardId)).map((r) => ({
      label: r.label ?? "(без статуса)",
      count: r.cnt,
    }));
    const byBlock = (await countTasksByBlock(config, boardId)).map((r) => ({
      label: r.label ?? "(без блока)",
      count: r.cnt,
    }));

    const taskRows = await fetchActiveTasks(config, [boardId]);
    const sampleTasks = taskRows.slice(0, sampleSize).map((t) => ({
      id: t.id,
      title: t.task_name,
      url: buildTaskUrl(config.appTaskBaseUrl, boardId, t.id),
    }));

    boards.push({
      boardId,
      boardName,
      found,
      activeTasks,
      byStatus,
      byBlock,
      assigneeCount: await countDistinctAssignees(config, boardId),
      tagCount: await countDistinctTags(config, boardId),
      commentCount: await countComments(config, boardId),
      historyCount: await countHistories(config, boardId),
      sampleTasks,
      warnings,
    });
  }

  await closeDb();

  return { boardIds, boards, globalWarnings };
}

export function formatDbProbeReport(result: DbProbeResult): string {
  const lines: string[] = [];
  lines.push("=== DB Collector Probe (read-only SELECT) ===");
  lines.push(`Board IDs: ${result.boardIds.join(", ") || "(none)"}`);
  lines.push("");

  for (const w of result.globalWarnings) {
    lines.push(`⚠ ${w}`);
  }

  for (const b of result.boards) {
    lines.push(`--- Board ${b.boardId}${b.boardName ? `: ${b.boardName}` : ""} ---`);
    if (!b.found) lines.push("  ⚠ Доска не найдена в БД");
    lines.push(`  Активных задач: ${b.activeTasks}`);
    lines.push(`  Исполнителей (distinct): ${b.assigneeCount}`);
    lines.push(`  Тегов (distinct): ${b.tagCount}`);
    lines.push(`  Комментариев: ${b.commentCount}`);
    lines.push(`  History records: ${b.historyCount}`);

    lines.push("  По статусам:");
    for (const s of b.byStatus) {
      lines.push(`    • ${s.label} — ${s.count}`);
    }
    lines.push("  По блокам:");
    for (const bl of b.byBlock) {
      lines.push(`    • ${bl.label} — ${bl.count}`);
    }

    if (b.sampleTasks.length > 0) {
      lines.push(`  Первые ${b.sampleTasks.length} задач:`);
      for (const t of b.sampleTasks) {
        lines.push(`    #${t.id} ${t.title ?? "(без названия)"}`);
        lines.push(`      ${t.url}`);
      }
    }

    for (const w of b.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
