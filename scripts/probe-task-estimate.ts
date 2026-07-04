import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { fetchActiveTasks } from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import { closeDb } from "../src/collectors/db-client.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";
import {
  estimatePresentRule,
  taskHasEstimatePresent,
} from "../src/rules/hard/estimate-present.js";
import {
  estimateLinkPresentRule,
  taskHasEstimateLinkInCard,
} from "../src/rules/hard/estimate-link-present.js";
import { collectLinkTargets } from "../src/rules/helpers.js";

async function main(): Promise<void> {
  const taskId = Number(process.argv[2] ?? "100");
  const boardId = Number(process.argv[3] ?? "783");

  const config = loadDbConfig();
  const tasks = await fetchActiveTasks(config, [boardId]);
  const row = tasks.find((t) => t.id === taskId);
  if (!row) {
    console.log(`Task ${taskId} not found on board ${boardId}`);
    await closeDb();
    return;
  }

  const [task] = mapDbBundleToRawTasks(
    { tasks: [row], assignees: [], tags: [], comments: [], histories: [] },
    config.appTaskBaseUrl,
  );

  const auditConfig = loadAuditConfig({ linkCheckEnabled: false });
  const scrum = await loadScrumAuditContext();

  console.log("=== Task", taskId, "===");
  console.log("title:", task.title);
  console.log("status:", task.status);
  console.log("plannedTime:", JSON.stringify(task.plannedTime));
  console.log("planned_end_time_offset (raw):", row.planned_end_time_offset);
  console.log("links:", task.links);
  console.log("description (first 500):", (task.descriptionText ?? "").slice(0, 500));
  console.log("collectLinkTargets:", collectLinkTargets(task));

  console.log("\n=== Heuristics ===");
  console.log("taskHasEstimatePresent:", taskHasEstimatePresent(task, auditConfig, { scrum }));
  console.log("taskHasEstimateLinkInCard:", taskHasEstimateLinkInCard(task, auditConfig));

  const ctx = { config: auditConfig, allTasks: [task], scrum };
  const est = estimatePresentRule.evaluate(task, ctx);
  const link = estimateLinkPresentRule.evaluate(task, ctx);
  console.log("\n=== Rules ===");
  console.log("estimate_present:", est.status, est.reason);
  console.log("estimate_link_present:", link.status, link.reason);

  if (scrum.loaded) {
    const { matchTaskToEstimate } = await import("../src/scrum/estimate-matcher.js");
    const match = matchTaskToEstimate(task, scrum.rows);
    console.log("\n=== Scrum match ===");
    console.log("kind:", match.kind);
    if (match.kind !== "not_found") {
      console.log("row title:", match.row.fullTitle ?? match.row.taskTitle);
      console.log("estimateHours:", match.row.estimateHours);
      console.log("plannedHours:", match.row.plannedHours);
    }
  } else {
    console.log("\nScrum not loaded:", scrum.loadError);
  }

  await closeDb();
}

main().catch(console.error);
