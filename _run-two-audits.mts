import "dotenv/config";
import {
  applyAuditModeEnv,
  restoreAuditModeEnv,
  TURBOWEAVE_AUDIT_CONFIG,
  ATAEV_MARKET_AUDIT_CONFIG,
} from "./src/config/audit-modes.js";
import { runAudit } from "./src/app/run-audit.js";

async function runPreset(
  mode: "turboweave" | "ataev_market",
  config: typeof TURBOWEAVE_AUDIT_CONFIG,
  label: string,
): Promise<boolean> {
  console.log(`[${label}] starting`);
  const snapshot = applyAuditModeEnv(mode);
  process.env.APPTASK_DB_FALLBACK = "true";

  try {
    const out = await runAudit(config.boardUrl, null, {
      projectName: config.projectName,
      commentsAuditMode: "off",
    });
    const m = out.result.meta;
    console.log(
      `[${label}] cards=${m.cardsChecked} FAIL=${m.failCount} WARN=${m.warnCount} discord=${out.discordPublished ? "published" : (out.discordError ?? "skipped")}`,
    );
    return out.discordPublished || !out.discordError;
  } catch (err) {
    console.error(`[${label}] failed:`, err);
    return false;
  } finally {
    restoreAuditModeEnv(snapshot);
  }
}

const tw = await runPreset("turboweave", TURBOWEAVE_AUDIT_CONFIG, "turboweave");
const am = await runPreset(
  "ataev_market",
  ATAEV_MARKET_AUDIT_CONFIG,
  "ataev-market",
);

process.exit(tw && am ? 0 : 1);
