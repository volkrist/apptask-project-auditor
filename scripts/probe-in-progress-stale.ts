import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { querySelect, closeDb } from "../src/collectors/db-client.js";
import { fetchComments, fetchHistories } from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import {
  businessHoursSince,
  computeLastActivityAt,
  isInProgressStatus,
} from "../src/rules/status/status-helpers.js";
import { inProgressStaleRule } from "../src/rules/soft/status-comment-rules.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { isFlowOrServiceTask } from "../src/tasks/task-classification.js";

const LIMIT = Number(process.env.IN_PROGRESS_STALE_BUSINESS_HOURS ?? "48") || 48;
const boardId = 783;
const db = loadDbConfig();
const config = loadAuditConfig({ linkCheckEnabled: false });

const tasks = await querySelect(db, `
SELECT t.id, t.name AS task_name, t.content, t.board_id, t.priority,
  t.block_id, b.name AS block_name, t.state_id, s.name AS status_name,
  t.planned_start_time, t.planned_end_time, t.planned_end_time_offset,
  t.current_end_time_offset, t.end_time, t.update_time, t.create_time,
  t.real_sprint_id, t.sprint_id, sp.name AS sprint_name, t.creator_id
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardBlocks b ON b.id = t.block_id AND b.board_id = t.board_id
LEFT JOIN dbo.BoardStates s ON s.id = t.state_id AND s.board_id = t.board_id
LEFT JOIN dbo.BoardSprints sp ON sp.id = t.sprint_id AND sp.board_id = t.board_id
WHERE t.board_id = @boardId AND t.removed = 0 AND t.archived = 0
  AND s.name LIKE N'%процесс%'
ORDER BY t.update_time
`, { boardId });

const comments = await fetchComments(db, [boardId]);
const histories = await fetchHistories(db, [boardId]);

const rawTasks = mapDbBundleToRawTasks(
  { tasks, assignees: [], tags: [], comments, histories },
  "https://apptask.ru/c/7",
);

console.log(`Threshold: > ${LIMIT} business hours (env IN_PROGRESS_STALE_BUSINESS_HOURS)`);
console.log(`In-progress tasks on board: ${rawTasks.length}\n`);

const rows: Array<{
  id: string;
  title: string;
  status: string | null;
  lastAt: string | null;
  bizHours: number | null;
  rule: string;
  flow: boolean;
}> = [];

for (const t of rawTasks) {
  const lastAt = computeLastActivityAt(t);
  const bizHours = businessHoursSince(lastAt);
  const r = inProgressStaleRule.evaluate(t, { config, allTasks: rawTasks });
  rows.push({
    id: t.id ?? "?",
    title: (t.title ?? "").slice(0, 50),
    status: t.status,
    lastAt,
    bizHours: bizHours != null ? Math.round(bizHours * 10) / 10 : null,
    rule: `${r.status}: ${r.reason.slice(0, 80)}`,
    flow: isFlowOrServiceTask(t),
  });
}

rows.sort((a, b) => (b.bizHours ?? 0) - (a.bizHours ?? 0));

for (const r of rows.slice(0, 15)) {
  console.log(
    `#${r.id} [${r.flow ? "FLOW" : "audit"}] bizH=${r.bizHours ?? "?"} last=${r.lastAt?.slice(0, 19) ?? "null"}`,
  );
  console.log(`  ${r.title}`);
  console.log(`  → ${r.rule}\n`);
}

const warns = rows.filter((r) => r.rule.startsWith("WARN") && !r.flow);
const near = rows.filter(
  (r) =>
    !r.flow &&
    r.bizHours != null &&
    r.bizHours <= LIMIT &&
    r.bizHours >= LIMIT - 24,
);
console.log(`WARN count (auditable in-progress): ${warns.length}`);
console.log(`Near threshold (auditable, ${LIMIT - 24}-${LIMIT} bizH): ${near.length}`);
for (const r of near) {
  console.log(`  #${r.id} bizH=${r.bizHours} → ${r.rule.split(":")[0]}`);
}

const passing = rows
  .filter((r) => !r.flow && r.rule.includes("PASS") && r.bizHours != null)
  .sort((a, b) => (b.bizHours ?? 0) - (a.bizHours ?? 0));
console.log(`\nPASS (auditable), ${passing.length} tasks:`);
for (const r of passing) {
  console.log(
    `  #${r.id} bizH=${r.bizHours} last=${r.lastAt?.slice(0, 19)} — ${r.title}`,
  );
}

await closeDb();
