/**
 * Проверка готовности машины после git clone / pull.
 * npm run setup:check          — полная (БД + Google Sheets)
 * npm run setup:check -- --quick — только файлы и переменные .env
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { connectDb, closeDb, querySelect } from "../src/collectors/db-client.js";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";
import { isGoogleSheetsConfigured } from "../src/scrum/scrum-estimate-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

type Row = {
  label: string;
  ok: boolean;
  critical: boolean;
  detail: string;
};

const rows: Row[] = [];

function add(
  label: string,
  ok: boolean,
  detail: string,
  critical = true,
): void {
  rows.push({ label, ok, critical, detail });
}

function envSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return Boolean(v && v.length > 0);
}

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

async function main(): Promise<void> {
  console.log("=== AppTask Auditor — setup check ===\n");

  add(
    "Node.js",
    Number(process.versions.node.split(".")[0]) >= 20,
    `v${process.versions.node} (нужен 20+)`,
    true,
  );

  add(
    "package.json / node_modules",
    fileExists("node_modules"),
    fileExists("node_modules")
      ? "npm install выполнен"
      : "запустите: npm install",
    true,
  );

  const hasEnv = fileExists(".env");
  add(
    ".env",
    hasEnv,
    hasEnv
      ? "найден"
      : "скопируйте .env с рабочего ПК или: copy .env.example .env и заполните секреты",
    true,
  );

  if (!hasEnv) {
    printReport();
    process.exit(1);
  }

  const requiredEnv = [
    "DISCORD_BOT_TOKEN",
    "APPTASK_DB_HOST",
    "APPTASK_DB_USER",
    "APPTASK_DB_NAME",
    "APPTASK_DB_PASSWORD",
    "AUDIT_DISCORD_CHANNEL_ID",
  ] as const;

  for (const key of requiredEnv) {
    add(`env ${key}`, envSet(key), envSet(key) ? "задан" : "не задан в .env", true);
  }

  add(
    "env APPTASK_DB_BOARD_IDS",
    envSet("APPTASK_DB_BOARD_IDS"),
    process.env.APPTASK_DB_BOARD_IDS?.trim() || "рекомендуется: 783,789,445,54",
    false,
  );

  add(
    "config/projects.json",
    fileExists("config/projects.json"),
    "маппинг досок → Discord (в git)",
    false,
  );

  add("start-bot.bat", fileExists("start-bot.bat"), "запуск бота", false);
  add(
    "ensure-bot-running.bat",
    fileExists("ensure-bot-running.bat"),
    "watchdog",
    false,
  );

  const sheetsOk =
    isGoogleSheetsConfigured() &&
    envSet("GOOGLE_WORK_SPREADSHEET_ID");
  add(
    "Google Sheets (смета)",
    sheetsOk,
    sheetsOk
      ? "учётные данные заданы"
      : "GOOGLE_SHEETS_* и GOOGLE_WORK_SPREADSHEET_ID — без них Scrum/смета SKIP",
    false,
  );

  if (!quick) {
    try {
      const db = loadDbConfig();
      await connectDb(db);
      const one = await querySelect<{ n: number }>(
        db,
        "SELECT 1 AS n",
        {},
      );
      add(
        "SQL Server (AppTask DB)",
        one[0]?.n === 1,
        `${db.host}:${db.port}/${db.database}`,
        true,
      );
      await closeDb();
    } catch (err) {
      add(
        "SQL Server (AppTask DB)",
        false,
        err instanceof Error ? err.message : String(err),
        true,
      );
      await closeDb().catch(() => {});
    }

    if (sheetsOk) {
      try {
        const scrum = await loadScrumAuditContext();
        add(
          "Google Sheets (доступ)",
          scrum.loaded,
          scrum.loaded
            ? `${scrum.rows.length} строк сметы`
            : scrum.loadError ?? "не загружено",
          false,
        );
      } catch (err) {
        add(
          "Google Sheets (доступ)",
          false,
          err instanceof Error ? err.message : String(err),
          false,
        );
      }
    }
  } else {
    add("Сеть", true, "пропущено (--quick)", false);
  }

  printReport();

  const failedCritical = rows.some((r) => r.critical && !r.ok);
  if (failedCritical) {
    console.log("\nИсправьте критичные пункты. См. docs/NEW_MACHINE_SETUP.md");
    process.exit(1);
  }

  console.log("\nГотово. Запуск бота: start-bot.bat");
  console.log("Автонастройка Windows: powershell -File infra\\windows\\setup-machine.ps1");
}

function printReport(): void {
  for (const r of rows) {
    const mark = r.ok ? "OK" : r.critical ? "FAIL" : "WARN";
    const tag = r.critical ? "" : " (рекомендуется)";
    console.log(`[${mark}] ${r.label}${tag}: ${r.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
