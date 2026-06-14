import type { RawTask } from "../adapters/apptask/types.js";
import type { BoardAuditMetrics, BoardQueueMetrics } from "../scrum/scrum-estimate-config.js";
import { countTestingQueueTasks } from "../rules/status/status-helpers.js";

const REVIEW_QUEUE_MAX = Number(process.env.REVIEW_QUEUE_MAX ?? "10") || 10;

export function buildBoardAuditMetrics(tasks: RawTask[]): BoardAuditMetrics {
  const byBoardId = new Map<string, RawTask[]>();
  for (const t of tasks) {
    const id = t.boardId ?? "?";
    const list = byBoardId.get(id) ?? [];
    list.push(t);
    byBoardId.set(id, list);
  }

  const byBoard: Record<string, BoardQueueMetrics> = {};
  let globalReview = 0;

  for (const [boardId, boardTasks] of byBoardId) {
    const queue = countTestingQueueTasks(boardTasks);
    globalReview += queue.length;
    byBoard[boardId] = {
      boardId,
      testingQueueCount: queue.length,
      testingQueueMax: REVIEW_QUEUE_MAX,
      sampleTasks: queue.slice(0, 10).map((t) => ({
        id: t.id ?? "?",
        url: t.url ?? "—",
        title: t.title,
      })),
    };
  }

  return {
    reviewQueueCount: globalReview,
    reviewQueueMax: REVIEW_QUEUE_MAX,
    byBoard,
  };
}
