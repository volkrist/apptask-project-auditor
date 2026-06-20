import type { AuditResult, CardAudit, EntityFinding } from "../rules/rule-types.js";
import { buildBoardClassification } from "./board-classification.js";
import { ruleCondition } from "./rule-conditions.js";
import { ruleLabel } from "./rule-labels.js";
import { ruleVerificationMethod } from "./rule-verification-methods.js";
import { escapeTableCell } from "./report-links.js";
import { simplifyReasonText, humanizeDiscordInReportText } from "./report-presentation.js";

export type TaskViolationGroup = {
  ruleId: string;
  status: "FAIL" | "WARN";
  cards: CardAudit[];
  sampleReason: string;
};

function humanLabel(ruleId: string): string {
  return ruleLabel(ruleId);
}

function cardLink(card: CardAudit): string {
  const t = card.task;
  const id = t.id ? `№${t.id}` : "без номера";
  const title = t.title ?? "(без названия)";
  if (t.url) return `[${id} — ${escapeTableCell(title)}](${t.url})`;
  return `${id} — ${escapeTableCell(title)}`;
}

export function parseScrumTitleMismatch(
  reason: string,
): { actual: string; expected: string } | null {
  const m = reason.match(/AppTask: «(.+)» ≠ смета: «(.+)»/);
  if (!m) return null;
  return { actual: m[1]!, expected: m[2]! };
}

export function formatScrumTitleDiff(actual: string, expected: string): string {
  const a = actual.trim();
  const b = expected.trim();
  if (a === b) return "—";
  if (a.replace(/\s/g, "") === b.replace(/\s/g, "")) {
    return "пробелы / регистр";
  }
  if (b.startsWith(`${a} `) || a.startsWith(`${b} `)) {
    return `${a} → ${b}`;
  }

  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  const diffs: string[] = [];
  const max = Math.max(aWords.length, bWords.length);

  for (let i = 0; i < max; i++) {
    const aw = aWords[i];
    const bw = bWords[i];
    if (aw === bw) continue;
    if (aw === undefined) {
      diffs.push(`+ ${bw}`);
    } else if (bw === undefined) {
      diffs.push(`− ${aw}`);
    } else {
      diffs.push(`${aw} → ${bw}`);
    }
  }

  if (diffs.length === 1) return diffs[0]!;
  if (diffs.length > 1) return diffs.join("; ");
  return `${a} → ${b}`;
}

function formatScrumTitleTable(group: TaskViolationGroup): string[] {
  const lines = [
    "",
    "| Карточка | AppTask | Смета / Scrum | Расхождение |",
    "| -------- | ------- | ------------- | ----------- |",
  ];
  for (const card of group.cards) {
    const r = card.results.find((x) => x.ruleId === group.ruleId);
    const parsed = r ? parseScrumTitleMismatch(r.reason) : null;
    const actual = parsed?.actual ?? simplifyReasonText(r?.reason ?? "—");
    const expected = parsed?.expected ?? "—";
    const diff = parsed ? formatScrumTitleDiff(parsed.actual, parsed.expected) : "—";
    lines.push(
      `| ${cardLink(card)} | ${escapeTableCell(actual)} | ${escapeTableCell(expected)} | ${escapeTableCell(diff)} |`,
    );
  }
  return lines;
}

function formatDefaultTaskTable(group: TaskViolationGroup): string[] {
  const lines = [
    "",
    "| Карточка | Статус | Исполнитель | Фактическое значение | Ожидаемое значение |",
    "| -------- | ------ | ----------- | -------------------- | ------------------ |",
  ];
  for (const card of group.cards) {
    const t = card.task;
    const r = card.results.find((x) => x.ruleId === group.ruleId);
    const fact = simplifyReasonText(r?.reason ?? "—");
    const expected = expectedForRule(group.ruleId, r?.reason ?? "");
    lines.push(
      `| ${cardLink(card)} | ${escapeTableCell(t.status ?? "—")} | ${escapeTableCell(t.assignees[0] ?? "—")} | ${escapeTableCell(fact)} | ${escapeTableCell(expected)} |`,
    );
  }
  return lines;
}

function entityEvidenceCell(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  const text = v && v !== "—" ? v : fallback;
  return escapeTableCell(humanizeDiscordInReportText(text));
}

export function formatTaskClassificationDebugTable(
  result: AuditResult,
): string[] {
  const { rows } = buildBoardClassification(result);

  const lines = [
    "",
    "## Классификация задач",
    "",
    "| № | Название | Тип | Причина классификации | Применённые правила |",
    "| - | -------- | --- | --------------------- | ------------------- |",
  ];

  for (const row of rows) {
    const idCell = row.url
      ? `[№${row.id}](${row.url})`
      : `№${row.id}`;
    lines.push(
      `| ${idCell} | ${escapeTableCell(row.title)} | ${escapeTableCell(row.bucketLabel)} | ${escapeTableCell(row.reason)} | ${escapeTableCell(row.appliedRules)} |`,
    );
  }

  lines.push("");
  return lines;
}

export function formatTeamWorksheetGroup(findings: EntityFinding[]): string[] {
  const violations = findings.filter((f) => f.status === "WARN" || f.status === "FAIL");
  if (violations.length === 0) return [];

  const lines: string[] = [
    "",
    `#### Проверка: Состав команды сверен с рабочей таблицей`,
    "",
    `Условие: ${ruleCondition("team_worksheet_match")}.`,
    `Метод проверки: ${ruleVerificationMethod("team_worksheet_match")}.`,
    `Результат: WARN — найдено ${violations.length} ${violations.length === 1 ? "участник" : "участников"}.`,
    "",
    "| Объект | Источник | Фактическое значение | Ожидаемое значение | Ссылка |",
    "| ------ | -------- | -------------------- | ------------------ | ------ |",
  ];

  for (const f of violations) {
    lines.push(
      `| ${entityEvidenceCell(f.objectLabel, "участник")} | ${entityEvidenceCell(f.source, "AppTask + рабочая таблица")} | ${entityEvidenceCell(f.actualValue, f.reason)} | ${entityEvidenceCell(f.expectedValue, ruleCondition("team_worksheet_match"))} | ${f.link ? `[открыть](${f.link})` : "—"} |`,
    );
  }

  return lines;
}

export function formatTeamDiscordGroup(findings: EntityFinding[]): string[] {
  const skipped = findings.filter((f) => f.status === "SKIP");
  const violations = findings.filter((f) => f.status === "WARN" || f.status === "FAIL");

  if (skipped.length > 0 && violations.length === 0) {
    const f = skipped[0]!;
    return [
      "",
      `#### Проверка: Состав команды сверен с Discord`,
      "",
      `Условие: ${ruleCondition("team_discord_match")}.`,
      `Метод проверки: ${ruleVerificationMethod("team_discord_match")}.`,
      `Результат: SKIP — Discord: доступ к списку участников не предоставлен.`,
      "",
      `Источник: Discord: доступ к списку участников не предоставлен`,
    ];
  }

  if (violations.length === 0) return [];

  const lines: string[] = [
    "",
    `#### Проверка: Состав команды сверен с Discord`,
    "",
    `Условие: ${ruleCondition("team_discord_match")}.`,
    `Метод проверки: ${ruleVerificationMethod("team_discord_match")}.`,
    `Результат: WARN — найдено ${violations.length} ${violations.length === 1 ? "участник" : "участников"}.`,
    "",
    "| Объект | Источник | Фактическое значение | Ожидаемое значение | Ссылка |",
    "| ------ | -------- | -------------------- | ------------------ | ------ |",
  ];

  for (const f of violations) {
    lines.push(
      `| ${entityEvidenceCell(f.objectLabel, "участник")} | ${entityEvidenceCell(f.source, "AppTask + Discord")} | ${entityEvidenceCell(f.actualValue, f.reason)} | ${entityEvidenceCell(f.expectedValue, ruleCondition("team_discord_match"))} | ${f.link ? `[открыть](${f.link})` : "—"} |`,
    );
  }

  return lines;
}

export function expectedForRule(ruleId: string, _reason: string): string {
  const map: Record<string, string> = {
    assignee_present: "назначен исполнитель",
    description_present: "описание заполнено (≥80 символов)",
    ui_has_mockup_link: "ссылка на макет",
    verified_success_comment: "комментарий «проверено» после завершения",
    open_questions_closed: "ответ другого участника на вопрос",
    unresolved_question_keywords_in_card: "нет маркеров незакрытого вопроса",
    scrum_task_in_estimate: "задача в утверждённой смете",
    done_task_without_tracking: "фактическое время > 0",
    blocked_tag_present: "тег blocked/блок",
    blocked_task_reason: "причина блокировки в комментарии",
  };
  return map[ruleId] ?? ruleCondition(ruleId);
}

export function formatTaskViolationBlock(group: TaskViolationGroup): string[] {
  const count = group.cards.length;
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(group.ruleId)}`,
    "",
    `Условие: ${ruleCondition(group.ruleId)}.`,
    `Метод проверки: ${ruleVerificationMethod(group.ruleId)}.`,
    `Результат: ${group.status} — найдено ${count} ${count === 1 ? "карточка" : "карточек"}.`,
  ];

  if (group.ruleId === "scrum_title_matches_estimate") {
    lines.push(...formatScrumTitleTable(group));
  } else {
    lines.push(...formatDefaultTaskTable(group));
  }

  return lines;
}

function formatTrackingAnomalyTable(findings: EntityFinding[]): string[] {
  const rows = findings.flatMap((f) => f.trackingRows ?? []);
  if (rows.length === 0) return [];

  const lines = [
    "",
    "| Дата | Пользователь | Карточка | Факт | Лимит |",
    "| ---- | ------------ | -------- | ---- | ----- |",
  ];

  for (const row of rows) {
    const cardCol = row.tasks
      .map((t) => {
        const flow = t.isFlow ? " (потоковая)" : "";
        if (t.url) {
          return `[№${t.id} — ${escapeTableCell(t.title)}](${t.url})${flow}`;
        }
        return `№${t.id} — ${escapeTableCell(t.title)}${flow}`;
      })
      .join("; ");
    lines.push(
      `| ${row.date} | ${escapeTableCell(row.userName)} | ${cardCol} | ${row.hours} ч | > ${row.limitHours} ч |`,
    );
  }
  return lines;
}

export function formatEntityViolationBlock(finding: EntityFinding): string[] {
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(finding.ruleId)}`,
    "",
    `Условие: ${ruleCondition(finding.ruleId)}.`,
    `Метод проверки: ${ruleVerificationMethod(finding.ruleId)}.`,
    `Результат: ${finding.status} — ${simplifyReasonText(finding.reason)}.`,
  ];

  if (finding.ruleId === "tracking_daily_anomaly") {
    lines.push(
      "",
      "Потоковые/сервисные карточки исключены из task-level аудита, но их фактическое время учитывается в проверке дневного списания времени.",
    );
    lines.push(...formatTrackingAnomalyTable([finding]));
    return lines;
  }

  if (finding.ruleId === "task_type_classification" && finding.details?.length) {
    lines.push("", "| Показатель | Значение |", "| ---------- | -------- |");
    for (const d of finding.details) {
      const [label, value] = d.includes(":") ? d.split(/:\s*/, 2) : [d, ""];
      lines.push(`| ${escapeTableCell(label ?? d)} | ${escapeTableCell(value ?? "")} |`);
    }
    return lines;
  }

  lines.push(
    "",
    "| Объект | Источник | Фактическое значение | Ожидаемое значение | Ссылка |",
    "| ------ | -------- | -------------------- | ------------------ | ------ |",
    `| ${entityEvidenceCell(finding.objectLabel, "объект проверки")} | ${entityEvidenceCell(finding.source, ruleCondition(finding.ruleId))} | ${entityEvidenceCell(finding.actualValue, simplifyReasonText(finding.reason))} | ${entityEvidenceCell(finding.expectedValue, ruleCondition(finding.ruleId))} | ${finding.link ? `[открыть](${finding.link})` : "—"} |`,
  );

  if (finding.details && finding.details.length > 0) {
    lines.push("", "Детали:");
    for (const d of finding.details) {
      lines.push(`* ${d}`);
    }
  }

  return lines;
}

export function formatTrackingDailyAnomalyGroup(
  findings: EntityFinding[],
): string[] {
  if (findings.length === 0) return [];
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel("tracking_daily_anomaly")}`,
    "",
    `Условие: ${ruleCondition("tracking_daily_anomaly")}.`,
    `Результат: WARN — найдено ${findings.length} ${findings.length === 1 ? "случай" : "случаев"}.`,
    "",
    "Потоковые/сервисные карточки исключены из task-level аудита, но их фактическое время учитывается в проверке дневного списания времени.",
  ];
  lines.push(...formatTrackingAnomalyTable(findings));
  return lines;
}

export function buildTaskLookup(result: AuditResult): Map<string, CardAudit["task"]> {
  const map = new Map<string, CardAudit["task"]>();
  for (const card of result.cards) {
    if (card.task.id) map.set(card.task.id, card.task);
  }
  const excluded = result.meta.excludedFlowCards ?? [];
  for (const ex of excluded) {
    if (!ex.id || map.has(ex.id)) continue;
    map.set(ex.id, {
      id: ex.id,
      url: ex.url,
      title: ex.title,
      status: ex.status,
      assignees: ex.assignee ? [ex.assignee] : [],
      descriptionText: null,
      createdAt: null,
      startDate: null,
      dueDate: null,
      priority: null,
      tags: [],
      creator: null,
      assigneeRefs: [],
      category: null,
      stage: null,
      plannedTime: null,
      actualTime: null,
      links: [],
      attachments: [],
      comments: [],
      boardId: null,
    });
  }
  return map;
}
