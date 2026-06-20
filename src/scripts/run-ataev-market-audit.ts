/**
 * Атаев Маркет audit: board 789 + tracking → Discord #аудитор.
 * Used by npm run audit:ataev-market, /ataev_market.
 */
import "dotenv/config";
import path from "node:path";
import { runAudit } from "../app/run-audit.js";
import {
  applyAuditModeEnv,
  ATAEV_MARKET_AUDIT_CONFIG,
  restoreAuditModeEnv,
} from "../config/audit-modes.js";

async function main(): Promise<void> {
  console.log("[ataev-market-audit] starting");
  const snapshot = applyAuditModeEnv("ataev_market");

  try {
    const out = await runAudit(ATAEV_MARKET_AUDIT_CONFIG.boardUrl, null, {
      projectName: ATAEV_MARKET_AUDIT_CONFIG.projectName,
      commentsAuditMode: "off",
    });

    const meta = out.result.meta;
    console.log("output dir:", path.resolve(out.output.dir));
    console.log(`boardsChecked=${meta.boardsChecked ?? "?"}`);
    const boardIds =
      meta.boardSummaries?.map((s) => s.boardId).join(",") ??
      ATAEV_MARKET_AUDIT_CONFIG.boardId;
    console.log(`boardIds=${boardIds}`);
    console.log(`cardsChecked=${meta.cardsChecked}`);
    console.log(`FAIL=${meta.failCount} WARN=${meta.warnCount}`);
    const ic = meta.issueCounts;
    if (ic) {
      console.log(
        `scrum: missing=${ic.scrumEstimateMissing} name=${ic.scrumNameMismatch} pv=${ic.pvMissing}`,
      );
      console.log(
        `tracking: done=${ic.doneWithoutTracking} stale=${ic.inProgressWithoutRecentTracking} fact>pv=${ic.actualHoursExceededEstimate}`,
      );
    }
    console.log(
      `discord: ${out.discordPublished ? "published" : out.discordError ?? "skipped"}`,
    );

    if (out.discordError && !out.discordPublished) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error("[ataev-market-audit] failed:", err);
    process.exit(1);
  } finally {
    restoreAuditModeEnv(snapshot);
  }
}

void main();
