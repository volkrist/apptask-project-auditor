import type { Rule } from "../rule-types.js";
import { fail, notApplicable, pass, skip, warn } from "../helpers.js";
import {
  isBlockedTask,
  isCompletedStatus,
  isInProgressStatus,
  isTestingStatus,
} from "../status/status-helpers.js";
import { hoursSince } from "../../scrum/estimate-matcher.js";
import { findInProgressStartedAt } from "../history/history-parser.js";
import { makeStateNameResolver } from "../../collectors/state-map.js";
import { isUiRelatedTask } from "../task-ui.js";
import { getAuditProfile, resolveAuditProfileId } from "../../config/audit-profiles.js";
import { partitionTasksForAudit } from "../../tasks/task-classification.js";
import { getTaskTrackingMetrics } from "../../tracking/load-tracking-context.js";
import {
  boardHasFolderLink,
  boardHasTzSummary,
  checkBoardNameTemplate,
  extractBoardText,
  getBoardMetadataForTask,
} from "../../collectors/board-metadata.js";
import {
  activeWorksheetParticipants,
  participantNameMatches,
  sprintMilestonesHaveDates,
} from "../../worksheet/worksheet-reader.js";
import { taskTrackingKey } from "../../tracking/tracking-hours-reader.js";

function primaryAssignee(task: Parameters<Rule["evaluate"]>[0]): string | null {
  const name = task.assignees.find((a) => a?.trim() && !a.includes("Добавить"));
  return name?.trim() ?? null;
}

const DEVELOPER_MAX_ACTIVE =
  Number(process.env.DEVELOPER_MAX_ACTIVE_TASKS ?? "3") || 3;
const NEVER_STARTED_DAYS =
  Number(process.env.NEVER_STARTED_DAYS ?? "14") || 14;
const TRACKING_HIGH_HOURS_THRESHOLD =
  Number(process.env.TRACKING_HIGH_WITHOUT_RESULT_HOURS ?? "20") || 20;
const TRACKING_DAILY_ANOMALY_HOURS =
  Number(process.env.TRACKING_DAILY_ANOMALY_HOURS ?? "10") || 10;

const ACT_BAD_TITLE_RE =
  /^(фикс|баг|тест|правки|fix|bug|todo|wip)\b/i;

export const blockedTagPresentRule: Rule = {
  id: "blocked_tag_present",
  severity: "soft",
  evaluate(task) {
    if (!isBlockedTask(task)) {
      return pass("blocked_tag_present", "Задача не заблокирована");
    }
    const tags = task.tags ?? [];
    const hasTag = tags.some((t) => /blocked|блок/i.test(t));
    if (hasTag) {
      return pass("blocked_tag_present", "Тег blocked указан");
    }
    return fail(
      "blocked_tag_present",
      "Задача заблокирована, но нет тега blocked/блок",
    );
  },
};

export const developerActiveTasksLimitRule: Rule = {
  id: "developer_active_tasks_limit",
  severity: "soft",
  evaluate(task, ctx) {
    const assignee = primaryAssignee(task);
    if (!assignee || !isInProgressStatus(task.status)) {
      return pass("developer_active_tasks_limit", "Не активная задача исполнителя");
    }
    const profile = getAuditProfile(
      resolveAuditProfileId(ctx.auditProfileId),
    );
    const { auditable } = partitionTasksForAudit(ctx.allTasks, profile);
    const active = auditable.filter(
      (t) =>
        primaryAssignee(t) === assignee && isInProgressStatus(t.status),
    );
    if (active.length <= DEVELOPER_MAX_ACTIVE) {
      return pass("developer_active_tasks_limit", "Лимит не превышен");
    }
    return warn(
      "developer_active_tasks_limit",
      `У исполнителя ${assignee}: ${active.length} задач в работе (лимит ${DEVELOPER_MAX_ACTIVE})`,
    );
  },
};

export const neverStartedTaskRule: Rule = {
  id: "never_started_task",
  severity: "soft",
  evaluate(task, ctx) {
    if (isCompletedStatus(task.status)) {
      return pass("never_started_task", "Завершена");
    }
    if (isInProgressStatus(task.status) || isTestingStatus(task.status)) {
      return pass("never_started_task", "Уже в работе или на проверке");
    }
    const createdAt = task.createdAt ?? null;
    const ageHours = hoursSince(createdAt);
    if (ageHours == null || ageHours < NEVER_STARTED_DAYS * 24) {
      return pass("never_started_task", "Недавно создана или нет даты");
    }
    const resolve = makeStateNameResolver(ctx.stateNameByKey);
    const started = findInProgressStartedAt(task, resolve);
    if (started) {
      return pass("never_started_task", "Была в работе");
    }
    return warn(
      "never_started_task",
      `Создана ${Math.floor(ageHours / 24)} дн. назад, ни разу не брали в работу`,
    );
  },
};

function sourceSkip(ruleId: string, reason: string) {
  return skip(ruleId, reason);
}

function uiOnlyRule(
  ruleId: string,
  task: Parameters<Rule["evaluate"]>[0],
  message: string,
): ReturnType<typeof notApplicable> | ReturnType<typeof warn> {
  if (!isUiRelatedTask(task)) {
    return notApplicable(ruleId, "Не UI/front задача");
  }
  return warn(ruleId, message);
}

export const boardNameTemplateRule: Rule = {
  id: "board_name_template",
  severity: "soft",
  evaluate(task, ctx) {
    const meta = getBoardMetadataForTask(ctx.boardMetadata, task.boardId);
    if (!meta) {
      return sourceSkip(
        "board_name_template",
        "данные о названии доски не найдены в доступных источниках",
      );
    }
    if (!meta.name) {
      return sourceSkip(
        "board_name_template",
        "данные о названии доски не найдены в доступных источниках",
      );
    }
    const check = checkBoardNameTemplate(meta.name);
    if (check.matches) {
      return pass("board_name_template", check.reason);
    }
    return warn("board_name_template", check.reason);
  },
};

export const boardFolderLinkRule: Rule = {
  id: "board_folder_link",
  severity: "soft",
  evaluate(task, ctx) {
    const meta = getBoardMetadataForTask(ctx.boardMetadata, task.boardId);
    if (!meta) {
      return sourceSkip(
        "board_folder_link",
        "описание доски недоступно в источнике данных",
      );
    }
    const text = extractBoardText(meta);
    if (!text.trim()) {
      return warn(
        "board_folder_link",
        "в описании доски нет ссылки на папку проекта (описание пустое)",
      );
    }
    if (boardHasFolderLink(meta)) {
      return pass("board_folder_link", "Ссылка на папку проекта найдена");
    }
    return warn(
      "board_folder_link",
      "в описании доски нет ссылки на папку проекта",
    );
  },
};

export const boardTzSummaryRule: Rule = {
  id: "board_tz_summary",
  severity: "soft",
  evaluate(task, ctx) {
    const meta = getBoardMetadataForTask(ctx.boardMetadata, task.boardId);
    if (!meta) {
      return sourceSkip(
        "board_tz_summary",
        "описание доски недоступно в источнике данных",
      );
    }
    const text = extractBoardText(meta);
    if (!text.trim()) {
      return warn(
        "board_tz_summary",
        "в описании доски нет краткого описания проекта из ТЗ (описание пустое)",
      );
    }
    if (boardHasTzSummary(meta)) {
      return pass("board_tz_summary", "Краткое описание из ТЗ найдено");
    }
    return warn(
      "board_tz_summary",
      "в описании доски нет краткого описания проекта из ТЗ",
    );
  },
};

export const teamWorksheetMatchRule: Rule = {
  id: "team_worksheet_match",
  severity: "soft",
  evaluate(task, ctx) {
    const ws = ctx.worksheet;
    if (!ws?.loaded) {
      return sourceSkip(
        "team_worksheet_match",
        ws?.loadError ?? "рабочая таблица проекта не подключена",
      );
    }
    const assignee = primaryAssignee(task);
    if (!assignee) {
      return pass("team_worksheet_match", "Нет исполнителя для сверки");
    }
    const active = activeWorksheetParticipants(ws.participants);
    if (active.length === 0) {
      return sourceSkip(
        "team_worksheet_match",
        "в рабочей таблице не найден список участников",
      );
    }
    if (participantNameMatches(assignee, active)) {
      return pass("team_worksheet_match", "Исполнитель найден в рабочей таблице");
    }
    return warn(
      "team_worksheet_match",
      `Исполнитель «${assignee}» не найден среди активных участников рабочей таблицы`,
    );
  },
};

export const sprintDatesMatchRule: Rule = {
  id: "sprint_dates_match",
  severity: "soft",
  evaluate(_task, ctx) {
    const ws = ctx.worksheet;
    if (!ws?.loaded) {
      return sourceSkip(
        "sprint_dates_match",
        ws?.loadError ?? "рабочая таблица проекта не подключена",
      );
    }
    if (ws.milestones.length === 0) {
      return sourceSkip(
        "sprint_dates_match",
        "в рабочей таблице не найдены майлстоуны со сроками",
      );
    }
    const check = sprintMilestonesHaveDates(ws.milestones);
    if (check.ok) {
      return pass("sprint_dates_match", "Даты этапов S1–S4 заполнены в майлстоунах");
    }
    if (check.missing.length > 0) {
      return warn(
        "sprint_dates_match",
        `Не заполнены даты: ${check.missing.join(", ")}`,
      );
    }
    return sourceSkip(
      "sprint_dates_match",
      "в Scrum-портале не найдены даты спринтов",
    );
  },
};

export const uiHasMockupLinkRule: Rule = {
  id: "ui_has_mockup_link",
  severity: "soft",
  evaluate(task) {
    if (!isUiRelatedTask(task)) {
      return notApplicable("ui_has_mockup_link", "Не UI/front задача");
    }
    const links = [...(task.links ?? []), ...(task.attachments ?? []).map((a) => a.url ?? a.name)];
    const hasMockup = links.some((l) =>
      /figma|mockup|макет|zeplin|sketch/i.test(l ?? ""),
    );
    const desc = task.descriptionText ?? "";
    if (hasMockup || /figma|mockup|макет/i.test(desc)) {
      return pass("ui_has_mockup_link", "Ссылка на макет найдена");
    }
    return fail("ui_has_mockup_link", "Нет ссылки на актуальный макет");
  },
};

export const uiMockupApprovedRule: Rule = {
  id: "ui_mockup_approved",
  severity: "soft",
  evaluate(task) {
    return uiOnlyRule(
      "ui_mockup_approved",
      task,
      "Нет подтверждения согласования макета перед разработкой",
    );
  },
};

export const uiAdaptiveRequirementsRule: Rule = {
  id: "ui_adaptive_requirements",
  severity: "soft",
  evaluate(task) {
    if (!isUiRelatedTask(task)) {
      return notApplicable("ui_adaptive_requirements", "Не UI/front задача");
    }
    const text = `${task.descriptionText ?? ""} ${task.title ?? ""}`;
    if (/адаптив|responsive|mobile|мобил/i.test(text)) {
      return pass("ui_adaptive_requirements", "Требования к адаптиву указаны");
    }
    return warn(
      "ui_adaptive_requirements",
      "Нет требований к адаптивности в описании",
    );
  },
};

export const uiBrowserDeviceRequirementsRule: Rule = {
  id: "ui_browser_device_requirements",
  severity: "soft",
  evaluate(task) {
    return uiOnlyRule(
      "ui_browser_device_requirements",
      task,
      "Нет требований к браузерам/устройствам (если применимо)",
    );
  },
};

export const trackingDailyAnomalyRule: Rule = {
  id: "tracking_daily_anomaly",
  severity: "soft",
  evaluate(task, ctx) {
    if (!ctx.tracking?.loaded) {
      return sourceSkip(
        "tracking_daily_anomaly",
        ctx.tracking?.loadError ?? "учёт времени недоступен",
      );
    }
    if (!task.boardId || !task.id) {
      return pass("tracking_daily_anomaly", "Нет идентификатора задачи");
    }
    const key = taskTrackingKey(task.boardId, task.id);
    const daily = ctx.tracking.dailyByTaskKey[key] ?? [];
    if (daily.length === 0) {
      return pass("tracking_daily_anomaly", "Нет дневных записей трекинга");
    }
    const anomalies = daily.filter((d) => d.hours > TRACKING_DAILY_ANOMALY_HOURS);
    if (anomalies.length === 0) {
      return pass("tracking_daily_anomaly", "Аномалий по дням нет");
    }
    const worst = anomalies.sort((a, b) => b.hours - a.hours)[0]!;
    const who = worst.userName ?? `user ${worst.userId}`;
    return warn(
      "tracking_daily_anomaly",
      `Списано ${Math.round(worst.hours * 10) / 10} ч за ${worst.date} (${who}), порог ${TRACKING_DAILY_ANOMALY_HOURS} ч`,
    );
  },
};

export const trackingHighWithoutResultRule: Rule = {
  id: "tracking_high_without_result",
  severity: "soft",
  evaluate(task, ctx) {
    if (!ctx.tracking?.loaded) {
      return sourceSkip(
        "tracking_high_without_result",
        ctx.tracking?.loadError ?? "tracking DB недоступен",
      );
    }
    const metrics = getTaskTrackingMetrics(ctx.tracking, task);
    const hours = metrics?.totalHours ?? 0;
    if (hours < TRACKING_HIGH_HOURS_THRESHOLD) {
      return pass("tracking_high_without_result", "Факт ниже порога");
    }
    const comments = task.comments ?? [];
    const meaningful = comments.filter(
      (c) =>
        (c.text?.trim().length ?? 0) > 40 &&
        !/^(готово|сделал|проверь)/i.test(c.text?.trim() ?? ""),
    );
    if (meaningful.length > 0 || (task.descriptionText?.length ?? 0) > 80) {
      return pass("tracking_high_without_result", "Есть содержательный результат");
    }
    return warn(
      "tracking_high_without_result",
      `Затрекано ${hours} ч без содержательных комментариев/результата`,
    );
  },
};

export const verifiedSuccessCommentRule: Rule = {
  id: "verified_success_comment",
  severity: "soft",
  evaluate(task) {
    if (!isCompletedStatus(task.status)) {
      return pass("verified_success_comment", "Не завершена");
    }
    const comments = task.comments ?? [];
    const ok = comments.some((c) =>
      /проверено|принято|approved|ok\b/i.test(c.text ?? ""),
    );
    if (ok) {
      return pass("verified_success_comment", "Маркер успешной проверки найден");
    }
    return warn(
      "verified_success_comment",
      "Нет комментария «проверено» после успешной проверки",
    );
  },
};

export const testerFeedbackHasProofRule: Rule = {
  id: "tester_feedback_has_proof",
  severity: "soft",
  evaluate(task) {
    if (!isTestingStatus(task.status) && !isCompletedStatus(task.status)) {
      return pass("tester_feedback_has_proof", "Не на проверке");
    }
    const comments = task.comments ?? [];
    const feedback = comments.filter((c) =>
      /баг|ошибк|не работ|замечан|вернуть|rework/i.test(c.text ?? ""),
    );
    if (feedback.length === 0) {
      return pass("tester_feedback_has_proof", "Нет замечаний тестировщика");
    }
    const withProof = feedback.some((c) =>
      /https?:\/\/|скрин|screenshot|видео|\.png|\.jpg|attachment/i.test(
        c.text ?? "",
      ),
    );
    if (withProof) {
      return pass("tester_feedback_has_proof", "Есть пруф в замечаниях");
    }
    return warn(
      "tester_feedback_has_proof",
      "Замечания тестировщика без скриншота/ссылки/видео",
    );
  },
};

export const massStartWithoutCompletionRule: Rule = {
  id: "mass_start_without_completion",
  severity: "soft",
  evaluate(task, ctx) {
    const assignee = primaryAssignee(task);
    if (!assignee || !isInProgressStatus(task.status)) {
      return pass("mass_start_without_completion", "Не применимо");
    }
    const profile = getAuditProfile(
      resolveAuditProfileId(ctx.auditProfileId),
    );
    const { auditable } = partitionTasksForAudit(ctx.allTasks, profile);
    const mine = auditable.filter((t) => primaryAssignee(t) === assignee);
    const inProgress = mine.filter((t) => isInProgressStatus(t.status));
    const oldOpen = mine.filter(
      (t) =>
        !isCompletedStatus(t.status) &&
        !isInProgressStatus(t.status) &&
        !isTestingStatus(t.status),
    );
    if (inProgress.length >= 4 && oldOpen.length >= 3) {
      return warn(
        "mass_start_without_completion",
        `У исполнителя ${inProgress.length} в работе при ${oldOpen.length} незавершённых старых`,
      );
    }
    return pass("mass_start_without_completion", "OK");
  },
};

export const actReadyNamingRule: Rule = {
  id: "act_ready_naming",
  severity: "soft",
  evaluate(task) {
    if (!isCompletedStatus(task.status)) {
      return pass("act_ready_naming", "Не завершена");
    }
    const title = task.title?.trim() ?? "";
    if (title.length < 12) {
      return warn("act_ready_naming", "Название слишком короткое для акта");
    }
    if (ACT_BAD_TITLE_RE.test(title)) {
      return warn(
        "act_ready_naming",
        "Название содержит служебное слово без контекста работы",
      );
    }
    if (title.split(/\s+/).filter(Boolean).length < 3) {
      return warn(
        "act_ready_naming",
        "Название не содержит понятного наименования работы",
      );
    }
    return pass("act_ready_naming", "Название пригодно для акта");
  },
};

export const contractRules: Rule[] = [
  blockedTagPresentRule,
  developerActiveTasksLimitRule,
  neverStartedTaskRule,
  boardNameTemplateRule,
  boardFolderLinkRule,
  boardTzSummaryRule,
  teamWorksheetMatchRule,
  sprintDatesMatchRule,
  uiHasMockupLinkRule,
  uiMockupApprovedRule,
  uiAdaptiveRequirementsRule,
  uiBrowserDeviceRequirementsRule,
  trackingDailyAnomalyRule,
  trackingHighWithoutResultRule,
  verifiedSuccessCommentRule,
  testerFeedbackHasProofRule,
  massStartWithoutCompletionRule,
  actReadyNamingRule,
];
