import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import {
  formatDbProbeReport,
  runDbCollectorProbe,
} from "../src/collectors/db-probe.js";

function parseArgs(argv: string[]): number[] {
  const ids: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-ids" && argv[i + 1]) {
      ids.push(...parseBoardIds(argv[++i]));
    } else if (a.startsWith("--board-ids=")) {
      ids.push(...parseBoardIds(a.slice("--board-ids=".length)));
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const fromArgv = parseArgs(process.argv.slice(2));
  const boardIds =
    fromArgv.length > 0 ? fromArgv : parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);

  const config = loadDbConfig({ boardIds });
  const result = await runDbCollectorProbe(config, boardIds);
  console.log(formatDbProbeReport(result));

  if (result.globalWarnings.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
