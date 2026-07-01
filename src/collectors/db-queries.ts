import type { DbConfig } from "./db-config.js";
import { boardIdsInClause, querySelect } from "./db-client.js";
import type {
  DbAssigneeRow,
  DbBoardRow,
  DbBoardStateRow,
  DbCommentRow,
  DbCountRow,
  DbGroupCountRow,
  DbHistoryRow,
  DbTagRow,
  DbTaskRow,
  DbUserRow,
} from "./db-types.js";

const ACTIVE_TASK_FILTER = `
  t.removed = 0
  AND t.archived = 0
  AND ISNULL(b.removed, 0) = 0
  AND ISNULL(s.removed, 0) = 0
`;

function idsClause(boardIds: number[]): { clause: string; params: Record<string, number> } {
  return boardIdsInClause(boardIds) as { clause: string; params: Record<string, number> };
}

export async function fetchBoards(
  config: DbConfig,
  boardIds: number[],
): Promise<DbBoardRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbBoardRow>(
    config,
    `SELECT id, name FROM dbo.Boards WHERE id IN (${clause}) AND ISNULL(removed, 0) = 0`,
    params,
  );
}

export async function fetchBoardStates(
  config: DbConfig,
  boardIds: number[],
): Promise<DbBoardStateRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbBoardStateRow>(
    config,
    `
SELECT id, board_id, name
FROM dbo.BoardStates
WHERE board_id IN (${clause}) AND ISNULL(removed, 0) = 0
`,
    params,
  );
}

export async function fetchActiveTasks(
  config: DbConfig,
  boardIds: number[],
): Promise<DbTaskRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbTaskRow>(
    config,
    `
SELECT
  t.id,
  t.offset_id,
  t.board_id,
  t.name AS task_name,
  t.content,
  t.block_id,
  b.name AS block_name,
  t.state_id,
  s.name AS status_name,
  t.priority,
  t.planned_start_time,
  t.planned_end_time,
  t.planned_end_time_offset,
  t.current_end_time_offset,
  t.end_time,
  t.update_time,
  t.create_time,
  t.real_sprint_id,
  t.sprint_id,
  sp.name AS sprint_name,
  t.creator_id
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardBlocks b
  ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s
  ON s.id = t.state_id AND s.board_id = t.board_id
LEFT JOIN dbo.BoardSprints sp
  ON sp.id = t.sprint_id AND sp.board_id = t.board_id AND ISNULL(sp.removed, 0) = 0
WHERE t.board_id IN (${clause})
  AND ${ACTIVE_TASK_FILTER}
ORDER BY t.board_id, t.id
`,
    params,
  );
}

export async function countActiveTasksByBoard(
  config: DbConfig,
  boardId: number,
): Promise<number> {
  const rows = await querySelect<DbCountRow>(
    config,
    `
SELECT COUNT(*) AS cnt
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
WHERE t.board_id = @boardId AND ${ACTIVE_TASK_FILTER}
`,
    { boardId },
  );
  return rows[0]?.cnt ?? 0;
}

export async function countTasksByStatus(
  config: DbConfig,
  boardId: number,
): Promise<DbGroupCountRow[]> {
  return querySelect<DbGroupCountRow>(
    config,
    `
SELECT ISNULL(s.name, N'(без статуса)') AS label, COUNT(*) AS cnt
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
WHERE t.board_id = @boardId AND ${ACTIVE_TASK_FILTER}
GROUP BY s.name
ORDER BY cnt DESC
`,
    { boardId },
  );
}

export async function countTasksByBlock(
  config: DbConfig,
  boardId: number,
): Promise<DbGroupCountRow[]> {
  return querySelect<DbGroupCountRow>(
    config,
    `
SELECT ISNULL(b.name, N'(без блока)') AS label, COUNT(*) AS cnt
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
WHERE t.board_id = @boardId AND ${ACTIVE_TASK_FILTER}
GROUP BY b.name
ORDER BY cnt DESC
`,
    { boardId },
  );
}

export async function fetchAssignees(
  config: DbConfig,
  boardIds: number[],
): Promise<DbAssigneeRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbAssigneeRow>(
    config,
    `
SELECT
  tu.board_id,
  tu.task_id,
  t.name AS task_name,
  tu.user_id,
  u.real_name,
  u.email,
  u.blocked,
  u.removed
FROM dbo.BoardTaskUsers tu
INNER JOIN dbo.BoardTasks t
  ON t.id = tu.task_id AND t.board_id = tu.board_id
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
LEFT JOIN dbo.Users u ON u.id = tu.user_id
WHERE tu.board_id IN (${clause})
  AND ${ACTIVE_TASK_FILTER}
`,
    params,
  );
}

/** Все пользователи компании для проверки blocked/removed у исполнителей. */
export async function fetchUsers(config: DbConfig): Promise<DbUserRow[]> {
  return querySelect<DbUserRow>(
    config,
    `
SELECT id, real_name, email, blocked, removed
FROM dbo.Users
`,
    {},
  );
}

export async function fetchTags(
  config: DbConfig,
  boardIds: number[],
): Promise<DbTagRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbTagRow>(
    config,
    `
SELECT
  tt.board_id,
  tt.task_id,
  t.name AS task_name,
  tt.tag_id,
  bt.name AS tag_name
FROM dbo.BoardTaskTags tt
INNER JOIN dbo.BoardTasks t
  ON t.id = tt.task_id AND t.board_id = tt.board_id
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
LEFT JOIN dbo.BoardTags bt
  ON bt.id = tt.tag_id AND bt.board_id = tt.board_id
WHERE tt.board_id IN (${clause})
  AND ISNULL(tt.removed, 0) = 0
  AND ISNULL(bt.removed, 0) = 0
  AND ${ACTIVE_TASK_FILTER}
`,
    params,
  );
}

export async function fetchComments(
  config: DbConfig,
  boardIds: number[],
): Promise<DbCommentRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbCommentRow>(
    config,
    `
SELECT
  c.id,
  c.board_id,
  c.task_id,
  t.name AS task_name,
  c.content,
  c.create_time,
  c.creator_id,
  u.real_name AS creator_name,
  c.parent_id
FROM dbo.BoardTaskComments c
INNER JOIN dbo.BoardTasks t
  ON t.id = c.task_id AND t.board_id = c.board_id
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
LEFT JOIN dbo.Users u ON u.id = c.creator_id
WHERE c.board_id IN (${clause})
  AND c.removed = 0
  AND ${ACTIVE_TASK_FILTER}
ORDER BY c.create_time DESC
`,
    params,
  );
}

export async function fetchHistories(
  config: DbConfig,
  boardIds: number[],
): Promise<DbHistoryRow[]> {
  const { clause, params } = idsClause(boardIds);
  return querySelect<DbHistoryRow>(
    config,
    `
SELECT
  h.id,
  h.board_id,
  h.task_id,
  t.name AS task_name,
  h.user_id,
  u.real_name,
  h.action_type,
  h.date,
  h.data
FROM dbo.BoardTaskHistories h
INNER JOIN dbo.BoardTasks t
  ON t.id = h.task_id AND t.board_id = h.board_id
LEFT JOIN dbo.Users u ON u.id = h.user_id
WHERE h.board_id IN (${clause})
ORDER BY h.date DESC
`,
    params,
  );
}

export async function countDistinctAssignees(
  config: DbConfig,
  boardId: number,
): Promise<number> {
  const rows = await querySelect<DbCountRow>(
    config,
    `
SELECT COUNT(DISTINCT tu.user_id) AS cnt
FROM dbo.BoardTaskUsers tu
INNER JOIN dbo.BoardTasks t ON t.id = tu.task_id AND t.board_id = tu.board_id
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
WHERE tu.board_id = @boardId AND ${ACTIVE_TASK_FILTER}
`,
    { boardId },
  );
  return rows[0]?.cnt ?? 0;
}

export async function countDistinctTags(
  config: DbConfig,
  boardId: number,
): Promise<number> {
  const rows = await querySelect<DbCountRow>(
    config,
    `
SELECT COUNT(DISTINCT tt.tag_id) AS cnt
FROM dbo.BoardTaskTags tt
INNER JOIN dbo.BoardTasks t ON t.id = tt.task_id AND t.board_id = tt.board_id
LEFT JOIN dbo.BoardTags bt ON bt.id = tt.tag_id AND bt.board_id = tt.board_id
WHERE tt.board_id = @boardId
  AND ISNULL(tt.removed, 0) = 0
  AND ISNULL(bt.removed, 0) = 0
`,
    { boardId },
  );
  return rows[0]?.cnt ?? 0;
}

export async function countComments(
  config: DbConfig,
  boardId: number,
): Promise<number> {
  const rows = await querySelect<DbCountRow>(
    config,
    `
SELECT COUNT(*) AS cnt
FROM dbo.BoardTaskComments c
INNER JOIN dbo.BoardTasks t ON t.id = c.task_id AND t.board_id = c.board_id
WHERE c.board_id = @boardId AND c.removed = 0
`,
    { boardId },
  );
  return rows[0]?.cnt ?? 0;
}

export async function countHistories(
  config: DbConfig,
  boardId: number,
): Promise<number> {
  const rows = await querySelect<DbCountRow>(
    config,
    `
SELECT COUNT(*) AS cnt
FROM dbo.BoardTaskHistories h
WHERE h.board_id = @boardId
`,
    { boardId },
  );
  return rows[0]?.cnt ?? 0;
}
