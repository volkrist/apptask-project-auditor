import "dotenv/config";
import { readSheetRows } from "../src/scrum/google-sheets-reader.js";
import { loadScrumEstimateConfig } from "../src/scrum/scrum-estimate-config.js";

function esc(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const c = loadScrumEstimateConfig();
  const tabs = [
    "🚦S1 - 1 этап: Основы",
    "Майлстоуны",
    "Информация о проекте",
    "Участники проекта",
  ];
  for (const name of tabs) {
    try {
      const id =
        name.startsWith("🚦") ? c.scrumSpreadsheetId! : c.workSpreadsheetId!;
      const rows = await readSheetRows(id, `${esc(name)}!A1:H25`);
      console.log(`\n=== ${name} ===`);
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        console.log(`${i + 1}:`, (rows[i] ?? []).join(" | ").slice(0, 200));
      }
    } catch (e) {
      console.log(name, "err", e instanceof Error ? e.message : e);
    }
  }
}

main();
