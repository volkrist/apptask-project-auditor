/**
 * UI vs DB verification for tracking hours (no rule changes).
 *
 * npm run probe:tracking:ui-verify
 */
import "dotenv/config";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../src/adapters/apptask/auth.js";
import {
  closeTaskCard,
  parseTaskCard,
} from "../src/adapters/apptask/card.js";
import { TASK_MODAL_SELECTORS } from "../src/adapters/apptask/selectors.js";
import type { TaskRef } from "../src/adapters/apptask/task-ref.js";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { closeDb, querySelect } from "../src/collectors/db-client.js";
import {
  loadTaskTrackingProbeRows,
  msToHours,
} from "../src/tracking/tracking-hours-reader.js";
import { formatSecondsToTime } from "../src/collectors/api-mapper.js";

const TASKS = [
  { boardId: 783, taskId: 1, url: "https://apptask.ru/c/7/board/783/1" },
  { boardId: 783, taskId: 3, url: "https://apptask.ru/c/7/board/783/3" },
  { boardId: 783, taskId: 5, url: "https://apptask.ru/c/7/board/783/5" },
] as const;

/** Parse AppTask «Фактическое время» label to decimal hours. */
export function parseUiActualTimeToHours(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().toLowerCase().replace(/\u00a0/g, " ").replace(/\s+/g, " ");

  const chMin = s.match(/(\d+)\s*ч(?:\s*(\d+)\s*мин)?/);
  if (chMin) {
    return Number(chMin[1]) + (chMin[2] ? Number(chMin[2]) / 60 : 0);
  }

  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    return Number(colon[1]) + Number(colon[2]) / 60;
  }

  const days = s.match(/(\d+)\s*д(?:[^\d]*(\d+)\s*ч)?/);
  if (days) {
    return Number(days[1]) * 24 + (days[2] ? Number(days[2]) : 0);
  }

  const onlyMin = s.match(/^(\d+)\s*мин$/);
  if (onlyMin) return Number(onlyMin[1]) / 60;

  return null;
}

function fmt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtDiff(ui: number | null, db: number): string {
  if (ui == null) return "n/a";
  return (ui - db).toFixed(2);
}

async function fetchUiProxyOffsets(
  boardId: number,
  taskIds: number[],
): Promise<Map<number, { offsetSec: number; offsetHours: number; uiLabel: string | null }>> {
  const config = loadDbConfig();
  const params: Record<string, number> = { boardId };
  const parts = taskIds.map((id, i) => {
    const key = `taskId${i}`;
    params[key] = id;
    return `@${key}`;
  });
  const rows = await querySelect<{
    id: number;
    current_end_time_offset: number | null;
  }>(
    config,
    `
SELECT id, current_end_time_offset
FROM dbo.BoardTasks
WHERE board_id = @boardId AND id IN (${parts.join(", ")})
`,
    params,
  );
  const map = new Map<number, { offsetSec: number; offsetHours: number; uiLabel: string | null }>();
  for (const row of rows) {
    const sec = Number(row.current_end_time_offset) || 0;
    map.set(row.id, {
      offsetSec: sec,
      offsetHours: sec / 3600,
      uiLabel: formatSecondsToTime(sec),
    });
  }
  return map;
}

async function readUiActualTime(
  boardId: number,
  taskId: number,
  url: string,
): Promise<{ actualTimeRaw: string | null; uiHours: number | null; title: string | null }> {
  assertProfileExists();
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const ref: TaskRef = {
    categoryId: "",
    categoryName: null,
    columnStateId: null,
    taskId: String(taskId),
    titlePreview: null,
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (/apptask\.ru\/login/i.test(page.url())) {
      throw new Error("Playwright profile session expired (redirect to /login)");
    }
    await page
      .locator(TASK_MODAL_SELECTORS.root)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    const task = await parseTaskCard(page, ref);
    return {
      actualTimeRaw: task.actualTime,
      uiHours: parseUiActualTimeToHours(task.actualTime),
      title: task.title?.replace(/\s+/g, " ").trim() ?? null,
    };
  } finally {
    await closeTaskCard(page).catch(() => undefined);
    await context.close();
  }
}

async function main(): Promise<void> {
  const config = loadDbConfig({ boardIds: [783] });

  console.log("=== Tracking hours UI vs DB verification ===");
  console.log("UI: Playwright persistent profile, field «Фактическое время»");
  console.log("DB: UserTrackingSummaries total_time + append_total_time (ms)");
  console.log("");

  const dbRows = await loadTaskTrackingProbeRows(
    config,
    783,
    TASKS.map((t) => t.taskId),
    config.appTaskBaseUrl,
  );
  const uiProxy = await fetchUiProxyOffsets(
    783,
    TASKS.map((t) => t.taskId),
  );
  await closeDb();

  const dbByTask = new Map(dbRows.map((r) => [r.taskId, r]));

  console.log(
    "Note: AppTask card «Фактическое время» = API currentEndTimeOffset = BoardTasks.current_end_time_offset (seconds).",
  );
  console.log(
    "Playwright DOM read attempted when profile session is valid.",
  );
  console.log("");
  console.log(
    "| taskId | title | UI hours | DB totalHours | diff | conclusion |",
  );
  console.log("| --- | --- | ---: | ---: | ---: | --- |");

  let allOk = true;
  let playwrightOk = true;

  for (const t of TASKS) {
    const db = dbByTask.get(t.taskId);
    const dbTotal = db?.totalHours ?? 0;
    const dbTotalTimeOnly = msToHours(db?.rawTotalTimeMs ?? 0);
    const dbAppend = msToHours(db?.rawAppendTotalTimeMs ?? 0);
    const proxy = uiProxy.get(t.taskId);
    const proxyHours = proxy?.offsetHours ?? null;

    console.log(`\n--- Task #${t.taskId} ---`);
    let uiRaw: string | null = proxy?.uiLabel ?? null;
    let uiHours: number | null = proxyHours;
    let title = db?.title?.replace(/\s+/g, " ").trim() ?? "";

    if (proxy) {
      console.log(
        `UI proxy (BoardTasks.current_end_time_offset): ${proxy.offsetSec} s → ${fmt(proxyHours)} h (${JSON.stringify(proxy.uiLabel)})`,
      );
      console.log(
        `DB summaries: total=${fmt(dbTotal)} h | total_time only=${fmt(dbTotalTimeOnly)} h | append=${fmt(dbAppend)} h`,
      );
    }

    try {
      const ui = await readUiActualTime(t.boardId, t.taskId, t.url);
      if (ui.uiHours != null) {
        uiRaw = ui.actualTimeRaw;
        uiHours = ui.uiHours;
        title = ui.title ?? title;
        console.log(`Playwright DOM: ${JSON.stringify(uiRaw)} → ${fmt(uiHours)} h`);
        if (proxyHours != null && Math.abs(uiHours - proxyHours) > 0.5) {
          console.log(
            `WARN: DOM differs from current_end_time_offset by ${(uiHours - proxyHours).toFixed(2)} h`,
          );
        }
      }
    } catch (err) {
      playwrightOk = false;
      console.log(
        `Playwright DOM: SKIP — ${err instanceof Error ? err.message : err}`,
      );
    }

    const diff = uiHours != null ? uiHours - dbTotal : null;
    const diffVsTotalTimeOnly =
      uiHours != null ? uiHours - dbTotalTimeOnly : null;
    const absDiff = diff != null ? Math.abs(diff) : Infinity;
    const absDiffTotalTimeOnly =
      diffVsTotalTimeOnly != null ? Math.abs(diffVsTotalTimeOnly) : Infinity;
    const appendGap = dbTotal - (uiHours ?? 0);

    let conclusion: string;
    if (uiHours == null) {
      conclusion = "no UI value";
      allOk = false;
    } else if (absDiffTotalTimeOnly <= 0.5) {
      conclusion =
        appendGap > 0.5
          ? "UI ≈ total_time (sec); append not in UI"
          : "match total_time+append";
    } else if (absDiff <= 0.5) {
      conclusion = "match (total_time+append)";
    } else if (absDiff <= 1) {
      conclusion = "rounding/sync drift";
    } else {
      conclusion = "MISMATCH — investigate";
      allOk = false;
    }

    console.log(
      `| ${t.taskId} | ${title.slice(0, 40)} | ${fmt(uiHours)} | ${fmt(dbTotal)} | ${fmtDiff(uiHours, dbTotal)} | ${conclusion} |`,
    );
  }

  console.log("");
  if (!playwrightOk) {
    console.log(
      "Playwright: session expired — re-run `npm run auth:profile` for live DOM check.",
    );
  }
  if (allOk) {
    console.log(
      "Result: units confirmed — safe to proceed with tracking-hours rules design.",
    );
  } else {
    console.log(
      "Result: mismatch or UI read failure — do NOT add tracking-hours rules yet.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
