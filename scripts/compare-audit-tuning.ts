import { readFileSync } from "node:fs";
import type { RawTask } from "../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { evaluateProject } from "../src/rules/evaluate.js";

const auditPath = process.argv[2];
if (!auditPath) {
  console.error("Usage: npx tsx scripts/compare-audit-tuning.ts <audit.json>");
  process.exit(1);
}

const prev = JSON.parse(readFileSync(auditPath, "utf8")) as {
  meta: { failCount: number; warnCount: number };
  cards: { task: RawTask; results: { ruleId: string; status: string }[] }[];
};

const tasks = prev.cards.map((c) => c.task);
const config = loadAuditConfig({ linkCheckEnabled: false });
const next = await evaluateProject(tasks, config);

const ruleDelta = new Map<string, { before: number; after: number }>();
for (const card of prev.cards) {
  for (const r of card.results) {
    if (r.status !== "FAIL" && r.status !== "WARN") continue;
    const entry = ruleDelta.get(r.ruleId) ?? { before: 0, after: 0 };
    entry.before++;
    ruleDelta.set(r.ruleId, entry);
  }
}
for (const card of next.cards) {
  for (const r of card.results) {
    if (r.status !== "FAIL" && r.status !== "WARN") continue;
    const entry = ruleDelta.get(r.ruleId) ?? { before: 0, after: 0 };
    entry.after++;
    ruleDelta.set(r.ruleId, entry);
  }
}

console.log("=== BEFORE (saved audit) ===");
console.log(`FAIL=${prev.meta.failCount} WARN=${prev.meta.warnCount}`);
console.log("=== AFTER (re-eval same RawTasks) ===");
console.log(`FAIL=${next.failCount} WARN=${next.warnCount}`);
console.log("=== RULE DELTA ===");
for (const [ruleId, d] of [...ruleDelta.entries()].sort((a, b) => b[1].before - a[1].before - (a[1].after - b[1].after))) {
  const delta = d.after - d.before;
  if (delta === 0 && d.before === 0) continue;
  console.log(`${ruleId}: ${d.before} → ${d.after} (${delta >= 0 ? "+" : ""}${delta})`);
}
