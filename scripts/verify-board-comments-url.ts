/**
 * CLI equivalent of Discord /audit for board_url + comments verification.
 *
 * npx tsx scripts/verify-board-comments-url.ts
 */
import "dotenv/config";
import { runAudit } from "../src/app/run-audit.js";

async function main(): Promise<void> {
  console.log("=== Verify board 445 (limit 1, comments off) ===\n");
  const r445 = await runAudit("https://apptask.ru/c/7/board/445", null, {
    maxCards: 1,
    commentsAuditMode: "off",
  });
  console.log(
    `445: cards=${r445.result.meta.cardsChecked}, FAIL=${r445.result.meta.failCount}, comments=${r445.commentsAudit?.mode ?? "n/a"}`,
  );

  console.log("\n=== Verify board 54 (limit 5, comments all, limit 2) ===\n");
  const r54 = await runAudit("https://apptask.ru/c/7/board/54", null, {
    maxCards: 5,
    commentsAuditMode: "all",
    commentsAuditLimit: 2,
  });
  const c = r54.commentsAudit;
  console.log(
    `54: cards=${r54.result.meta.cardsChecked}, comments boardId=${c?.boardId}, checked=${c?.checkedComments}, withComments=${c?.tasksWithComments}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
