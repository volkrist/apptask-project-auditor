import type { RawTask } from "../adapters/apptask/types.js";
import { getAuditProfile, resolveAuditProfileId } from "../config/audit-profiles.js";
import { googleSpreadsheetUrl } from "../reports/report-links.js";
import {
  boardHasFolderLink,
  boardHasTzSummary,
  checkBoardNameTemplate,
  extractBoardText,
  type BoardMetadata,
} from "../collectors/board-metadata.js";
import { isFlowOrServiceTask } from "../tasks/task-classification.js";
import { summarizeTaskTypes } from "../tasks/task-type-classification.js";
import {
  activeWorksheetParticipants,
  descriptionReflectsWorksheet,
  findWorksheetParticipant,
  participantNameMatches,
  projectNamesAlign,
  sprintMilestonesHaveDates,
} from "../worksheet/worksheet-reader.js";
import type { EntityFinding, RuleContext } from "./rule-types.js";
import { getRuleScope } from "./rule-scopes.js";

const TRACKING_DAILY_ANOMALY_HOURS =
  Number(process.env.TRACKING_DAILY_ANOMALY_HOURS ?? "10") || 10;

function primaryAssignee(task: RawTask): string | null {
  const name = task.assignees.find((a) => a?.trim() && !a.includes("Добавить"));
  return name?.trim() ?? null;
}

function boardObjectLabel(meta: BoardMetadata): string {
  const title = meta.name?.trim() || "(без названия)";
  return `доска ${meta.boardId} — ${title}`;
}

function boardFindings(
  meta: BoardMetadata,
  ctx: RuleContext,
): EntityFinding[] {
  const findings: EntityFinding[] = [];
  const objectLabel = boardObjectLabel(meta);

  if (!meta.name) {
    findings.push({
      ruleId: "board_name_template",
      status: "SKIP",
      reason: "данные о названии доски не найдены в доступных источниках",
      scope: "board",
      objectLabel,
    });
  } else {
    const check = checkBoardNameTemplate(meta.name);
    if (check.status !== "PASS") {
      findings.push({
        ruleId: "board_name_template",
        status: "WARN",
        reason: check.summary,
        scope: "board",
        objectLabel,
        actualValue: meta.name,
        details: [...check.deviations, ...check.notes],
      });
    } else {
      findings.push({
        ruleId: "board_name_template",
        status: "PASS",
        reason: check.summary,
        scope: "board",
        objectLabel,
        actualValue: meta.name,
        details: check.notes,
      });
    }
  }

  const text = extractBoardText(meta);
  if (!text.trim()) {
    findings.push({
      ruleId: "board_folder_link",
      status: "WARN",
      reason: "в описании доски нет ссылки на папку проекта",
      scope: "board",
      objectLabel,
      source: "AppTask Boards.description",
      actualValue: "описание доски пустое",
      expectedValue: "ссылка на папку проекта (Google Drive / Яндекс.Диск и т.п.)",
      link: `https://apptask.ru/c/7/board/${meta.boardId}`,
    });
    findings.push({
      ruleId: "board_tz_summary",
      status: "WARN",
      reason: "в описании доски нет краткого описания проекта из ТЗ",
      scope: "board",
      objectLabel,
      source: "AppTask Boards.description",
      actualValue: "описание доски пустое",
      expectedValue: "краткое описание проекта из ТЗ",
      link: `https://apptask.ru/c/7/board/${meta.boardId}`,
    });
  } else {
    if (!boardHasFolderLink(meta)) {
      findings.push({
        ruleId: "board_folder_link",
        status: "WARN",
        reason: "в описании доски нет ссылки на папку проекта",
        scope: "board",
        objectLabel,
        source: "AppTask Boards.description",
        actualValue: text.slice(0, 200),
        expectedValue: "ссылка на папку проекта",
        link: `https://apptask.ru/c/7/board/${meta.boardId}`,
      });
    }
    if (!boardHasTzSummary(meta)) {
      findings.push({
        ruleId: "board_tz_summary",
        status: "WARN",
        reason: "в описании доски нет краткого описания проекта из ТЗ",
        scope: "board",
        objectLabel,
        source: "AppTask Boards.description",
        actualValue: text.slice(0, 200),
        expectedValue: "краткое описание проекта из ТЗ (≥80 символов или маркеры ТЗ)",
        link: `https://apptask.ru/c/7/board/${meta.boardId}`,
      });
    }
  }

  return findings;
}

function projectWorksheetFindings(
  meta: BoardMetadata,
  ctx: RuleContext,
): EntityFinding[] {
  const ws = ctx.worksheet;
  const objectLabel = boardObjectLabel(meta);

  if (!ws?.loaded) {
    return [
      {
        ruleId: "project_worksheet_match",
        status: "SKIP",
        reason: ws?.loadError ?? "рабочая таблица проекта не подключена",
        scope: "project",
        objectLabel: "проект",
      },
    ];
  }

  const findings: EntityFinding[] = [];
  const boardText = extractBoardText(meta);
  const boardName = meta.name?.trim() ?? "";

  if (!ws.projectInfoTabFound) {
    findings.push({
      ruleId: "project_worksheet_match",
      status: "WARN",
      reason: "в рабочей таблице не найден лист «Информация о проекте»",
      scope: "project",
      objectLabel: "проект",
      actualValue: "лист с названием и описанием проекта отсутствует",
    });
    return findings;
  }

  if (!ws.projectName && !ws.projectDescription) {
    findings.push({
      ruleId: "project_worksheet_match",
      status: "WARN",
      reason: "в рабочей таблице не найдены поля названия и краткого описания проекта",
      scope: "project",
      objectLabel: "проект",
      actualValue: "колонки «Проект» / «Краткое описание» не распознаны",
    });
  }

  if (!boardText.trim()) {
    findings.push({
      ruleId: "project_worksheet_match",
      status: "WARN",
      reason: "описание доски пустое — нельзя сверить с рабочей таблицей",
      scope: "project",
      objectLabel,
      actualValue: boardName || "описание доски пустое",
    });
  }

  if (ws.projectName && boardName && !projectNamesAlign(boardName, ws.projectName)) {
    findings.push({
      ruleId: "project_worksheet_match",
      status: "WARN",
      reason: "название доски не совпадает с названием проекта в рабочей таблице",
      scope: "project",
      objectLabel,
      actualValue: `доска: ${boardName}; таблица: ${ws.projectName}`,
    });
  }

  if (ws.projectDescription) {
    if (!boardText.trim()) {
      // already reported
    } else if (!descriptionReflectsWorksheet(boardText, ws.projectDescription)) {
      findings.push({
        ruleId: "project_worksheet_match",
        status: "WARN",
        reason: "описание доски не отражает краткое описание проекта из рабочей таблицы",
        scope: "project",
        objectLabel,
        actualValue: `таблица: ${ws.projectDescription.slice(0, 120)}`,
      });
    }
  } else {
    findings.push({
      ruleId: "project_worksheet_match",
      status: "WARN",
      reason: "в рабочей таблице не найдено краткое описание проекта для сверки",
      scope: "project",
      objectLabel: "проект",
      actualValue: "поле «Краткое описание» не заполнено или не найдено",
    });
  }

  return findings;
}

function teamRoleRateFindings(
  auditable: RawTask[],
  ctx: RuleContext,
): EntityFinding[] {
  const ws = ctx.worksheet;
  if (!ws?.loaded) {
    return [
      {
        ruleId: "team_role_rate_match",
        status: "SKIP",
        reason: ws?.loadError ?? "рабочая таблица проекта не подключена",
        scope: "team",
        objectLabel: "команда проекта",
      },
    ];
  }

  const findings: EntityFinding[] = [];

  if (!ws.participantColumns.role) {
    findings.push({
      ruleId: "team_role_rate_match",
      status: "WARN",
      reason: "в рабочей таблице не найдена колонка роли (специализация)",
      scope: "team",
      objectLabel: "рабочая таблица",
      actualValue: "колонка «Специализация» отсутствует",
    });
  }
  if (!ws.participantColumns.rate) {
    findings.push({
      ruleId: "team_role_rate_match",
      status: "WARN",
      reason: "в рабочей таблице не найдена колонка ставки",
      scope: "team",
      objectLabel: "рабочая таблица",
      actualValue: "колонка «Ставка» отсутствует",
    });
  }

  const active = activeWorksheetParticipants(ws.participants);
  if (active.length === 0) {
    return [
      ...findings,
      {
        ruleId: "team_role_rate_match",
        status: "SKIP",
        reason: "в рабочей таблице не найден список участников",
        scope: "team",
        objectLabel: "команда проекта",
      },
    ];
  }

  const assignees = new Set<string>();
  for (const task of auditable) {
    const name = primaryAssignee(task);
    if (name) assignees.add(name);
  }

  for (const assignee of [...assignees].sort()) {
    const participant = findWorksheetParticipant(assignee, active);
    if (!participant) continue;
    if (ws.participantColumns.role && !participant.role?.trim()) {
      findings.push({
        ruleId: "team_role_rate_match",
        status: "WARN",
        reason: "роль не заполнена в рабочей таблице",
        scope: "team",
        objectLabel: `участник — ${assignee}`,
      });
    }
    if (ws.participantColumns.rate && !participant.rate?.trim()) {
      findings.push({
        ruleId: "team_role_rate_match",
        status: "WARN",
        reason: "ставка не заполнена в рабочей таблице",
        scope: "team",
        objectLabel: `участник — ${assignee}`,
      });
    }
  }

  return findings;
}

function taskTypeClassificationFindings(
  allTasks: RawTask[],
  ctx: RuleContext,
): EntityFinding[] {
  const profile = getAuditProfile(
    resolveAuditProfileId(ctx.auditProfileId),
  );
  const summary = summarizeTaskTypes(allTasks, profile);
  const details = [
    `всего задач на доске: ${summary.total}`,
    `потоковые / сервисные (исключены из карточного аудита): ${summary.flow}`,
    `UI / front: ${summary.ui}`,
    `обычные задачи: ${summary.regular}`,
    `не удалось классифицировать: ${summary.unknown}`,
  ];

  if (summary.unknown > 0) {
    const examples = summary.unknownExamples
      .map((e) => `№${e.id} — ${e.title}`)
      .join("; ");
    return [
      {
        ruleId: "task_type_classification",
        status: "WARN",
        reason: `не удалось классифицировать ${summary.unknown} задач(и)`,
        scope: "project",
        objectLabel: "классификация задач на доске",
        actualValue: examples || undefined,
        details,
      },
    ];
  }

  return [
    {
      ruleId: "task_type_classification",
      status: "PASS",
      reason: "все задачи классифицированы по типам",
      scope: "project",
      objectLabel: "классификация задач на доске",
      details,
    },
  ];
}

function teamFindings(
  auditable: RawTask[],
  ctx: RuleContext,
): EntityFinding[] {
  const ws = ctx.worksheet;
  if (!ws?.loaded) {
    return [
      {
        ruleId: "team_worksheet_match",
        status: "SKIP",
        reason: ws?.loadError ?? "рабочая таблица проекта не подключена",
        scope: "team",
        objectLabel: "команда проекта",
      },
    ];
  }

  const active = activeWorksheetParticipants(ws.participants);
  if (active.length === 0) {
    return [
      {
        ruleId: "team_worksheet_match",
        status: "SKIP",
        reason: "в рабочей таблице не найден список участников",
        scope: "team",
        objectLabel: "команда проекта",
      },
    ];
  }

  const assignees = new Set<string>();
  for (const task of auditable) {
    const name = primaryAssignee(task);
    if (name) assignees.add(name);
  }

  const findings: EntityFinding[] = [];
  for (const assignee of [...assignees].sort()) {
    if (!participantNameMatches(assignee, active)) {
      findings.push({
        ruleId: "team_worksheet_match",
        status: "WARN",
        reason: "не найден среди активных участников рабочей таблицы",
        scope: "team",
        objectLabel: `участник — ${assignee}`,
      });
    }
  }

  return findings;
}

function sprintFindings(ctx: RuleContext): EntityFinding[] {
  const ws = ctx.worksheet;
  if (!ws?.loaded) {
    return [
      {
        ruleId: "sprint_dates_match",
        status: "SKIP",
        reason: ws?.loadError ?? "рабочая таблица проекта не подключена",
        scope: "sprint",
        objectLabel: "спринты / майлстоуны",
      },
    ];
  }
  if (ws.milestones.length === 0) {
    return [
      {
        ruleId: "sprint_dates_match",
        status: "SKIP",
        reason: "в рабочей таблице не найдены майлстоуны со сроками",
        scope: "sprint",
        objectLabel: "спринты / майлстоуны",
      },
    ];
  }

  const check = sprintMilestonesHaveDates(ws.milestones);
  if (check.ok) {
    return [];
  }

  return check.missing.map((label) => {
    const idMatch = label.match(/^(M\d+)/i);
    const milestone = idMatch
      ? ws.milestones.find((m) => m.id.toUpperCase() === idMatch[1]!.toUpperCase())
      : undefined;
    const sheetLink = ws.spreadsheetId
      ? googleSpreadsheetUrl(ws.spreadsheetId)
      : undefined;
    return {
      ruleId: "sprint_dates_match",
      status: "WARN" as const,
      reason: "не заполнены даты начала и/или окончания",
      scope: "sprint" as const,
      objectLabel: `спринт / майлстоун — ${label}`,
      source: "рабочая таблица / лист «Майлстоуны»",
      actualValue: milestone
        ? `начало: ${milestone.startDate ?? "—"}, окончание: ${milestone.endDate ?? "—"}`
        : "даты не заполнены",
      expectedValue: "дата начала и дата окончания заполнены",
      link: sheetLink,
    };
  });
}

function trackingDailyFindings(
  ctx: RuleContext,
  flowTaskIds: Set<string>,
  taskById: Map<string, RawTask>,
): EntityFinding[] {
  if (!ctx.tracking?.loaded) {
    return [
      {
        ruleId: "tracking_daily_anomaly",
        status: "SKIP",
        reason: ctx.tracking?.loadError ?? "учёт времени недоступен",
        scope: "user",
        objectLabel: "учёт времени по дням",
        source: "учёт фактического времени (БД)",
      },
    ];
  }

  const byUserDay = new Map<
    string,
    {
      userId: number;
      userName: string | null;
      date: string;
      hours: number;
      tasks: string[];
    }
  >();

  for (const [taskKey, rows] of Object.entries(ctx.tracking.dailyByTaskKey)) {
    const taskId = taskKey.split(":")[1] ?? taskKey;
    for (const row of rows) {
      const key = `${row.userId}:${row.date}`;
      const entry = byUserDay.get(key) ?? {
        userId: row.userId,
        userName: row.userName,
        date: row.date,
        hours: 0,
        tasks: [],
      };
      entry.hours += row.hours;
      if (!entry.tasks.includes(taskId)) entry.tasks.push(taskId);
      byUserDay.set(key, entry);
    }
  }

  const findings: EntityFinding[] = [];
  for (const entry of byUserDay.values()) {
    if (entry.hours <= TRACKING_DAILY_ANOMALY_HOURS) continue;
    const who = entry.userName ?? `user ${entry.userId}`;
    const taskRefs = entry.tasks.map((id) => {
      const task = taskById.get(id);
      const isFlow = flowTaskIds.has(id);
      return {
        id,
        title: task?.title ?? "(без названия)",
        url: task?.url ?? null,
        status: task?.status ?? null,
        isFlow,
      };
    });
    findings.push({
      ruleId: "tracking_daily_anomaly",
      status: "WARN",
      reason: `списано ${Math.round(entry.hours * 10) / 10} ч за день (порог ${TRACKING_DAILY_ANOMALY_HOURS} ч)`,
      scope: "user",
      objectLabel: `${who}, ${entry.date}`,
      source: "учёт фактического времени (БД)",
      actualValue: `${Math.round(entry.hours * 10) / 10} ч`,
      expectedValue: `не более ${TRACKING_DAILY_ANOMALY_HOURS} ч за день`,
      trackingRows: [
        {
          date: entry.date,
          userName: who,
          hours: Math.round(entry.hours * 10) / 10,
          limitHours: TRACKING_DAILY_ANOMALY_HOURS,
          tasks: taskRefs,
        },
      ],
    });
  }

  return findings;
}

/** Оценка правил уровня доски / проекта / спринта / команды (один раз на объект). */
export function evaluateEntityFindings(
  ctx: RuleContext,
  auditable: RawTask[],
  allTasks: RawTask[] = auditable,
): EntityFinding[] {
  const findings: EntityFinding[] = [];
  const profile = getAuditProfile(
    resolveAuditProfileId(ctx.auditProfileId),
  );
  const flowTaskIds = new Set(
    allTasks
      .filter((t) => isFlowOrServiceTask(t, profile) && t.id)
      .map((t) => t.id!),
  );
  const taskById = new Map<string, RawTask>();
  for (const task of allTasks) {
    if (task.id) taskById.set(task.id, task);
  }

  const boardIds = [
    ...new Set(
      allTasks
        .map((t) => t.boardId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  for (const boardId of boardIds) {
    const meta = ctx.boardMetadata?.[boardId];
    if (meta) {
      findings.push(...boardFindings(meta, ctx));
      findings.push(...projectWorksheetFindings(meta, ctx));
    } else {
      for (const ruleId of [
        "board_name_template",
        "board_folder_link",
        "board_tz_summary",
        "project_worksheet_match",
      ] as const) {
        findings.push({
          ruleId,
          status: "SKIP",
          reason: "данные о доске не найдены в доступных источниках",
          scope: getRuleScope(ruleId) as EntityFinding["scope"],
          objectLabel: `доска ${boardId}`,
        });
      }
    }
  }

  findings.push(...teamFindings(auditable, ctx));
  findings.push(...teamRoleRateFindings(auditable, ctx));
  findings.push(...sprintFindings(ctx));
  findings.push(...trackingDailyFindings(ctx, flowTaskIds, taskById));
  findings.push(...taskTypeClassificationFindings(allTasks, ctx));

  return findings;
}

export function countEntityViolations(findings: EntityFinding[]): {
  failCount: number;
  warnCount: number;
} {
  let failCount = 0;
  let warnCount = 0;
  for (const f of findings) {
    if (f.status === "FAIL") failCount++;
    if (f.status === "WARN") warnCount++;
  }
  return { failCount, warnCount };
}
