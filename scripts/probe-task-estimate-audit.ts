import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { fetchActiveTasks } from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import { closeDb } from "../src/collectors/db-client.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";
import { evaluateProject } from "../src/rules/evaluate.js";
import { getAuditProfile } from "../src/config/audit-profiles.js";
import { buildRegistryRowFromEvidence } from "../src/reports/evidence-registry-bridge.js";
import { getFullCheckRegistry } from "../src/config/contract-check-registry.js";
import type { AuditResult } from "../src/rules/rule-types.js";

async function main(): Promise<void> {
  const taskId = process.argv[2] ?? "100";
  const boardId = Number(process.argv[3] ?? "783");

  const db = loadDbConfig();
  const rows = await fetchActiveTasks(db, [boardId]);
  const tasks = mapDbBundleToRawTasks(
    { tasks: rows, assignees: [], tags: [], comments: [], histories: [] },
    db.appTaskBaseUrl,
  );

  const config = loadAuditConfig({ linkCheckEnabled: false });
  const scrum = await loadScrumAuditContext();
  const profile = getAuditProfile("contract_turboweave_v1");

  const evaluated = await evaluateProject(tasks, config, [], {
    scrum,
    auditProfileId: profile.id,
  });

  const card = evaluated.cards.find((c) => c.task.id === taskId);
  if (!card) {
    console.log(`Task ${taskId} not in evaluated cards (${evaluated.cards.length} total)`);
    await closeDb();
    return;
  }

  console.log(`Task ${taskId}: ${card.task.title}`);
  for (const ruleId of ["estimate_present", "estimate_link_present"] as const) {
    const r = card.results.find((x) => x.ruleId === ruleId);
    console.log(`${ruleId}: ${r?.status} — ${r?.reason ?? "?"}`);
  }

  const result: AuditResult = {
    cards: evaluated.cards,
    topIssues: [],
    meta: {
      projectName: "probe",
      boardUrl: `board/${boardId}`,
      auditedAt: new Date().toISOString(),
      cardsChecked: evaluated.cards.length,
      failCount: 0,
      warnCount: 0,
      auditProfile: profile.id,
    },
  };

  for (const entry of getFullCheckRegistry()) {
    if (!entry.ruleIds.includes("estimate_link_present")) continue;
    const row = buildRegistryRowFromEvidence(entry, result);
    const hits = row.evidence.violationEvidence.filter((v) => v.taskId === taskId);
    console.log(`\nRegistry #${entry.num} ${entry.title}`);
    console.log(`violations: ${row.violations}, outcome: ${row.outcome}`);
    console.log(`task ${taskId} in violationEvidence:`, hits.length > 0);
    if (hits[0]) console.log("evidence:", hits[0].reason?.slice(0, 100));
  }

  await closeDb();
}

main().catch(console.error);
