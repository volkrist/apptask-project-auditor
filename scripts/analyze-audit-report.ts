import { readFileSync } from "node:fs";

const dir = process.argv[2] ?? "output/audit-2026-05-17-21-26-11";
const data = JSON.parse(readFileSync(`${dir}/audit.json`, "utf8")) as {
  meta: { failCount: number; warnCount: number; cardsChecked: number };
  cards: Array<{
    task: Record<string, unknown>;
    results: Array<{ ruleId: string; status: string; reason: string }>;
  }>;
};

const risky = new Set([
  "title_not_generic",
  "description_has_goal",
  "artifact_links_present",
  "estimate_link_present",
  "links_reachable",
  "task_type_valid",
  "deadline_realistic",
]);

const ruleAgg = new Map<string, { fail: number; warn: number }>();

for (const card of data.cards) {
  const title = String(card.task.title ?? card.task.id ?? "?");
  let fail = 0;
  let warn = 0;
  console.log(`\n=== ${title} ===`);
  for (const r of card.results) {
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
    if (r.status !== "PASS") {
      const a = ruleAgg.get(r.ruleId) ?? { fail: 0, warn: 0 };
      if (r.status === "FAIL") a.fail++;
      else a.warn++;
      ruleAgg.set(r.ruleId, a);
      console.log(`  ${r.status} ${r.ruleId}: ${r.reason}`);
    }
  }
  console.log(`  TOTAL fail=${fail} warn=${warn}`);
}

console.log("\n--- RULE AGGREGATE ---");
for (const [id, s] of [...ruleAgg.entries()].sort(
  (a, b) => b.fail + b.warn - (a.fail + a.warn),
)) {
  const tag = risky.has(id) ? " [RISKY]" : "";
  console.log(`${id}: fail=${s.fail} warn=${s.warn}${tag}`);
}

console.log(`\nMETA: cards=${data.meta.cardsChecked} fail=${data.meta.failCount} warn=${data.meta.warnCount}`);
