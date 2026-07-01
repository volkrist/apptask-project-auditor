import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { fetchActiveTasks, fetchCommentsForTasks } from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import { closeDb } from "../src/collectors/db-client.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { uiMockupApprovedRule } from "../src/rules/contract/contract-rules.js";
import { hasMockupApprovalMarker } from "../src/rules/soft/comment-heuristics.js";
import { commentPlainTextForRules } from "../src/rules/helpers.js";
import { isUiRelatedTask } from "../src/rules/task-ui.js";

async function main(): Promise<void> {
  const config = loadDbConfig();
  const tasks = await fetchActiveTasks(config, [783]);
  const row = tasks.find((t) => t.id === 16);
  if (!row) {
    console.log("Task 16 not found");
    return;
  }
  const comments = await fetchCommentsForTasks(config, [16]);
  const [task] = mapDbBundleToRawTasks(
    { tasks: [row], assignees: [], tags: [], comments, histories: [] },
    config.appTaskBaseUrl,
  );

  console.log("title:", task.title);
  console.log("status:", task.status);
  console.log("category:", task.category);
  console.log("isUiRelated:", isUiRelatedTask(task));
  console.log("comments count:", task.comments?.length ?? 0);
  for (const c of task.comments ?? []) {
    const plain = commentPlainTextForRules(c);
    console.log("--- comment ---");
    console.log("raw text:", c.text?.slice(0, 200));
    console.log("plain:", plain.slice(0, 200));
    console.log("marker:", hasMockupApprovalMarker(plain));
  }

  const auditConfig = loadAuditConfig();
  const r = await uiMockupApprovedRule.evaluate(task, { config: auditConfig, allTasks: [task] });
  console.log("\nRule result:", r.status, r.reason);

  await closeDb();
}

main().catch(console.error);
