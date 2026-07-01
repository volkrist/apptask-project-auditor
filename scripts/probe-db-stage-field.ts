/**
 * Discover «Этап» / stage field in AppTask SQL Server (read-only).
 * Run: npx tsx scripts/probe-db-stage-field.ts [--board-id 783] [--task-id 100]
 */
import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { querySelect, closeDb } from "../src/collectors/db-client.js";

function parseArgs(argv: string[]): { boardId: number; taskId: number | null } {
  let boardId = 783;
  let taskId: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-id" && argv[i + 1]) boardId = Number(argv[++i]);
    if (a === "--task-id" && argv[i + 1]) taskId = Number(argv[++i]);
  }
  return { boardId, taskId };
}

async function main(): Promise<void> {
  const { boardId, taskId } = parseArgs(process.argv.slice(2));
  const config = loadDbConfig();

  console.log("=== Join: sprint / block / status (task context) ===");
  const joinSql = taskId
    ? `AND t.id = @taskId`
    : "";
  const params: Record<string, number> = { boardId };
  if (taskId != null) params.taskId = taskId;

  const joined = await querySelect<{
    id: number;
    task_name: string | null;
    sprint_name: string | null;
    block_name: string | null;
    status_name: string | null;
  }>(
    config,
    `
SELECT TOP 10
  t.id,
  t.name AS task_name,
  sp.name AS sprint_name,
  b.name AS block_name,
  s.name AS status_name
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardSprints sp ON sp.id = t.sprint_id AND sp.board_id = t.board_id
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
WHERE t.board_id = @boardId AND t.removed = 0 ${joinSql}
ORDER BY t.id
`,
    params,
  );
  for (const r of joined) {
    console.log(
      `  #${r.id} «${r.task_name}» | sprint=${JSON.stringify(r.sprint_name)} | block=${JSON.stringify(r.block_name)} | status=${JSON.stringify(r.status_name)}`,
    );
  }

  console.log("\n=== BoardTaskPointGroups columns ===");
  const pgCols = await querySelect<{ COLUMN_NAME: string; DATA_TYPE: string }>(
    config,
    `
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BoardTaskPointGroups'
ORDER BY ORDINAL_POSITION
`,
  );
  for (const c of pgCols) console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);

  console.log("\n=== Point groups linked to tasks (sample board) ===");
  const pointGroups = await querySelect<Record<string, unknown>>(
    config,
    `
SELECT TOP 15
  t.id AS task_id,
  t.name AS task_name,
  g.id AS group_id,
  g.content AS group_content,
  p.content AS point_content
FROM dbo.BoardTasks t
INNER JOIN dbo.BoardTaskPoints p ON p.link_board_task_id = t.id AND p.link_board_id = t.board_id AND p.removed = 0
LEFT JOIN dbo.BoardTaskPointGroups g ON g.id = p.board_task_point_group_id AND g.removed = 0
WHERE t.board_id = @boardId AND t.removed = 0
ORDER BY t.id
`,
    { boardId },
  );
  for (const r of pointGroups) {
    console.log(
      `  #${r.task_id} group=${JSON.stringify(r.group_content)} point=${JSON.stringify(String(r.point_content ?? "").slice(0, 60))}`,
    );
  }

  console.log("\n=== All PropertyList names on board (history scan) ===");
  const histRows = await querySelect<{ data: string | null }>(
    config,
    `
SELECT TOP 500 h.data
FROM dbo.BoardTaskHistories h
WHERE h.board_id = @boardId AND h.data IS NOT NULL
ORDER BY h.id DESC
`,
    { boardId },
  );
  const propNames = new Map<string, number>();
  for (const h of histRows) {
    if (!h.data) continue;
    try {
      const parsed = JSON.parse(h.data) as {
        PropertyList?: Array<{ Name?: string }>;
      };
      for (const p of parsed.PropertyList ?? []) {
        if (!p.Name) continue;
        propNames.set(p.Name, (propNames.get(p.Name) ?? 0) + 1);
      }
    } catch {
      // ignore
    }
  }
  const sorted = [...propNames.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
