import type { Rule } from "../rule-types.js";
import { fail, notApplicable, pass, skip, warn, commentPlainTextForRules } from "../helpers.js";
import {
  commentThreadHasProof,
  isBlockedTask,
  isCompletedStatus,
  isInProgressStatus,
  isTestingStatus,
} from "../status/status-helpers.js";
import { hoursSince } from "../../scrum/estimate-matcher.js";
import { findInProgressStartedAt } from "../history/history-parser.js";
import { makeStateNameResolver } from "../../collectors/state-map.js";
import { isUiRelatedTask, requiresExistingMockupLink } from "../task-ui.js";
import { getAuditProfile, resolveAuditProfileId } from "../../config/audit-profiles.js";
import { partitionTasksForAudit } from "../../tasks/task-classification.js";
import { getTaskTrackingMetrics } from "../../tracking/load-tracking-context.js";
import { hasVerificationSuccessMarker, hasMockupApprovalMarker, isTesterFeedbackComment } from "../soft/comment-heuristics.js";
import { findOpenQuestionWithoutReply } from "../soft/open-questions-closed.js";

function primaryAssignee(task: Parameters<Rule["evaluate"]>[0]): string | null {
  const name = task.assignees.find((a) => a?.trim() && !a.includes("Добавить"));
  return name?.trim() ?? null;
}

const DEVELOPER_MAX_ACTIVE =
  Number(process.env.DEVELOPER_MAX_ACTIVE_TASKS ?? "3") || 3;
const MASS_START_MIN_IN_PROGRESS =
  Number(process.env.MASS_START_MIN_IN_PROGRESS ?? "4") || 4;
const NEVER_STARTED_DAYS =
  Number(process.env.NEVER_STARTED_DAYS ?? "14") || 14;
const TRACKING_HIGH_HOURS_THRESHOLD =
  Number(process.env.TRACKING_HIGH_WITHOUT_RESULT_HOURS ?? "20") || 20;

const ACT_BAD_TITLE_RE =
  /^(фикс|баг|тест|правки|fix|bug|todo|wip)\b/i;

export const blockedTagPresentRule: Rule = {
  id: "blocked_tag_present",
  severity: "soft",
  evaluate(task) {
    if (!isBlockedTask(task)) {
      return notApplicable("blocked_tag_present", "Задача не заблокирована");
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
      return notApplicable("developer_active_tasks_limit", "Не активная задача исполнителя");
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
      return notApplicable("never_started_task", "Завершена");
    }
    if (isInProgressStatus(task.status) || isTestingStatus(task.status)) {
      return notApplicable("never_started_task", "Уже в работе или на проверке");
    }
    const createdAt = task.createdAt ?? null;
    const ageHours = hoursSince(createdAt);
    if (ageHours == null || ageHours < NEVER_STARTED_DAYS * 24) {
      return notApplicable("never_started_task", "Недавно создана или нет даты");
    }
    const resolve = makeStateNameResolver(ctx.stateNameByKey);
    const started = findInProgressStartedAt(task, resolve);
    if (started) {
      return notApplicable("never_started_task", "Была в работе");
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
  evaluate() {
    return notApplicable("board_name_template", "Проверка уровня доски");
  },
};

export const boardFolderLinkRule: Rule = {
  id: "board_folder_link",
  severity: "soft",
  evaluate() {
    return notApplicable("board_folder_link", "Проверка уровня доски");
  },
};

export const boardTzSummaryRule: Rule = {
  id: "board_tz_summary",
  severity: "soft",
  evaluate() {
    return notApplicable("board_tz_summary", "Проверка уровня доски");
  },
};

export const teamWorksheetMatchRule: Rule = {
  id: "team_worksheet_match",
  severity: "soft",
  evaluate() {
    return notApplicable("team_worksheet_match", "Проверка уровня команды");
  },
};

export const teamDiscordMatchRule: Rule = {
  id: "team_discord_match",
  severity: "soft",
  evaluate() {
    return notApplicable("team_discord_match", "Проверка уровня команды");
  },
};

export const projectWorksheetMatchRule: Rule = {
  id: "project_worksheet_match",
  severity: "soft",
  evaluate() {
    return notApplicable("project_worksheet_match", "Проверка уровня проекта");
  },
};

export const teamRoleRateMatchRule: Rule = {
  id: "team_role_rate_match",
  severity: "soft",
  evaluate() {
    return notApplicable("team_role_rate_match", "Проверка уровня команды");
  },
};

export const taskTypeClassificationRule: Rule = {
  id: "task_type_classification",
  severity: "soft",
  evaluate() {
    return notApplicable("task_type_classification", "Проверка уровня проекта");
  },
};

export const sprintDatesMatchRule: Rule = {
  id: "sprint_dates_match",
  severity: "soft",
  evaluate() {
    return notApplicable("sprint_dates_match", "Проверка уровня спринта");
  },
};

function hasMockupLinkReference(textBlob: string): boolean {
  if (/figma\.com|zeplin\.com|sketch\.com|invisionapp\.com/i.test(textBlob)) {
    return true;
  }
  return /https?:\/\/\S*(mockup|макет)/i.test(textBlob);
}

export const uiHasMockupLinkRule: Rule = {
  id: "ui_has_mockup_link",
  severity: "soft",
  evaluate(task, ctx) {
    if (!isUiRelatedTask(task)) {
      return notApplicable("ui_has_mockup_link", "Не UI/front задача");
    }
    if (!requiresExistingMockupLink(task, ctx.config)) {
      return notApplicable(
        "ui_has_mockup_link",
        "Задача на создание UI/макета — готовый макет не требуется",
      );
    }
    const links = [...(task.links ?? []), ...(task.attachments ?? []).map((a) => a.url ?? a.name)];
    const desc = task.descriptionText ?? "";
    const textBlob = [desc, ...links].join("\n");
    if (hasMockupLinkReference(textBlob)) {
      return pass("ui_has_mockup_link", "Ссылка на макет найдена");
    }
    return fail(
      "ui_has_mockup_link",
      "Нет ссылки на готовый макет (Figma и др.). Для задач на вёрстку по макету нужен Figma; ссылка на ТЗ не заменяет макет",
    );
  },
};

export const uiMockupApprovedRule: Rule = {
  id: "ui_mockup_approved",
  severity: "soft",
  evaluate(task) {
    if (!isUiRelatedTask(task)) {
      return notApplicable("ui_mockup_approved", "Не UI/front задача");
    }

    const textParts = [
      task.title ?? "",
      task.descriptionText ?? "",
      ...(task.comments ?? []).map((c) => commentPlainTextForRules(c)),
    ];
    const blob = textParts.join("\n");

    if (hasMockupApprovalMarker(blob)) {
      return pass(
        "ui_mockup_approved",
        "Подтверждение согласования макета найдено в описании или комментариях",
      );
    }

    return warn(
      "ui_mockup_approved",
      "Нет подтверждения согласования макета перед разработкой (описание или комментарии)",
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
  evaluate() {
    return notApplicable("tracking_daily_anomaly", "Проверка уровня учёта времени");
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
      return notApplicable("verified_success_comment", "Не завершена");
    }
    const textParts = [
      task.descriptionText ?? "",
      ...(task.comments ?? []).map((c) => commentPlainTextForRules(c)),
    ];
    const ok = textParts.some((text) => hasVerificationSuccessMarker(text));
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
    const comments = task.comments ?? [];

    const feedback = comments.filter((c) => {
      const text = commentPlainTextForRules(c);
      return text.trim().length > 0 && isTesterFeedbackComment(text);
    });

    if (feedback.length === 0) {
      return notApplicable("tester_feedback_has_proof", "Нет замечаний тестировщика");
    }

    const missing = feedback.filter(
      (c) => !commentThreadHasProof(c, comments),
    );
    if (missing.length === 0) {
      return pass("tester_feedback_has_proof", "Есть пруф в замечаниях");
    }
    return warn(
      "tester_feedback_has_proof",
      `${missing.length} замечаний без скриншота/ссылки/видео`,
    );
  },
};

export const massStartWithoutCompletionRule: Rule = {
  id: "mass_start_without_completion",
  severity: "soft",
  evaluate(task, ctx) {
    const assignee = primaryAssignee(task);
    if (!assignee || !isInProgressStatus(task.status)) {
      return notApplicable("mass_start_without_completion", "Не применимо");
    }
    const profile = getAuditProfile(
      resolveAuditProfileId(ctx.auditProfileId),
    );
    const { auditable } = partitionTasksForAudit(ctx.allTasks, profile);
    const mine = auditable.filter((t) => primaryAssignee(t) === assignee);
    const inProgress = mine.filter((t) => isInProgressStatus(t.status));
    if (inProgress.length >= MASS_START_MIN_IN_PROGRESS) {
      return warn(
        "mass_start_without_completion",
        `У исполнителя ${assignee}: ${inProgress.length} задач в работе одновременно (порог ${MASS_START_MIN_IN_PROGRESS})`,
      );
    }
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

export const openQuestionsClosedRule: Rule = {
  id: "open_questions_closed",
  severity: "soft",
  evaluate(task) {
    const comments = task.comments ?? [];
    if (comments.length === 0) {
      return notApplicable("open_questions_closed", "Комментариев нет");
    }
    const snippet = findOpenQuestionWithoutReply(task);
    if (snippet) {
      return warn(
        "open_questions_closed",
        `Открытый вопрос в комментарии без ответа: «${snippet}»`,
      );
    }
    return pass(
      "open_questions_closed",
      "Открытых вопросов без ответа в комментариях не найдено",
    );
  },
};

export const actReadyNamingRule: Rule = {
  id: "act_ready_naming",
  severity: "soft",
  evaluate(task) {
    if (!isCompletedStatus(task.status)) {
      return notApplicable("act_ready_naming", "Не завершена");
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
  teamDiscordMatchRule,
  projectWorksheetMatchRule,
  teamRoleRateMatchRule,
  taskTypeClassificationRule,
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
  openQuestionsClosedRule,
  actReadyNamingRule,
];
