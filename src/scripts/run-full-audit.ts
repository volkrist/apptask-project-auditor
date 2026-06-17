/**
 * Full multi-board audit: 783,445,54 — manual only (Discord /audit or npm run audit:full).
 */
import "dotenv/config";
import path from "node:path";
import { runAudit } from "../app/run-audit.js";
import {
  applyAuditModeEnv,
  FULL_AUDIT_CONFIG,
  restoreAuditModeEnv,
} from "../config/audit-modes.js";

async function main(): Promise<void> {
  console.log("[full-audit] starting multi-board 783,445,54");
  const snapshot = applyAuditModeEnv("full");

  try {
    const out = await runAudit(FULL_AUDIT_CONFIG.boardUrl, null, {
      projectName: FULL_AUDIT_CONFIG.projectName,
      commentsAuditMode: "off",
    });

    const meta = out.result.meta;
    console.log("output dir:", path.resolve(out.output.dir));
    console.log(`boardsChecked=${meta.boardsChecked ?? "?"}`);
    const boardIds =
      meta.boardSummaries?.map((s) => s.boardId).join(",") ??
      FULL_AUDIT_CONFIG.env.APPTASK_DB_BOARD_IDS;
    console.log(`boardIds=${boardIds}`);
    console.log(`cardsChecked=${meta.cardsChecked}`);
    console.log(`FAIL=${meta.failCount} WARN=${meta.warnCount}`);
    console.log(
      `discord: ${out.discordPublished ? "published" : out.discordError ?? "skipped"}`,
    );

    if (out.discordError && !out.discordPublished) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error("[full-audit] failed:", err);
    process.exit(1);
  } finally {
    restoreAuditModeEnv(snapshot);
  }
}

void main();
