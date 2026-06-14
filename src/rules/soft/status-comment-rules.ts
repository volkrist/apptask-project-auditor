import type { Rule } from "../rule-types.js";
import {
  businessHoursSince,
  computeLastActivityAt,
  deadlineUrgency,
  findReworkReasonComment,
  findVagueDoneComments,
  formatHoursLabel,
  hasAdequateBlockReason,
  isBlockedTask,
  isCompletedStatus,
  isHighPriorityOrCriticalBug,
  isInProgressStatus,
  isTestingStatus,
} from "../status/status-helpers.js";
import { hoursSince } from "../../scrum/estimate-matcher.js";
import {
  findReviewStartedAt,
  findReworkTransitions,
} from "../history/history-parser.js";
import { makeStateNameResolver } from "../../collectors/state-map.js";
import { pass, warn, fail } from "../helpers.js";

const STALE_WORKDAY_HOURS = Number(process.env.STALE_WORKDAY_HOURS ?? "24") || 24;
const REVIEW_QUEUE_MAX = Number(process.env.REVIEW_QUEUE_MAX ?? "10") || 10;
const RECENT_REWORK_DAYS = Number(process.env.RECENT_REWORK_DAYS ?? "30") || 30;

export const deadlineLessThanOneDayRule: Rule = {
  id: "deadline_less_than_one_day",
  severity: "soft",
  evaluate(task) {
    if (isCompletedStatus(task.status)) {
      return pass("deadline_less_than_one_day", "Задача завершена");
    }
    const urgency = deadlineUrgency(task);
    if (urgency.kind === "none" && urgency.days == null) {
      return pass("deadline_less_than_one_day", "Нет дедлайна");
    }
    if (urgency.kind === "overdue") {
      return fail(
        "deadline_less_than_one_day",
        `Дедлайн просрочен (${task.dueDate}), задача не завершена — ${urgency.label}`,
      );
    }
    if (urgency.kind === "soon") {
      return warn(
        "deadline_less_than_one_day",
        `До дедлайна меньше 1 дня (${task.dueDate}) — ${urgency.label}`,
      );
    }
    return pass("deadline_less_than_one_day", "OK");
  },
};

export const blockedTaskReasonRule: Rule = {
  id: "blocked_task_reason",
  severity: "soft",
  evaluate(task) {
    if (!isBlockedTask(task)) {
      return pass("blocked_task_reason", "Задача не заблокирована");
    }
    if (hasAdequateBlockReason(task)) {
      return pass("blocked_task_reason", "Причина блокировки указана");
    }
    return fail(
      "blocked_task_reason",
      "Задача заблокирована, причина не указана или слишком общая",
    );
  },
};

export const reviewQueueSizeRule: Rule = {
  id: "review_queue_over_limit",
  severity: "soft",
  evaluate(task, ctx) {
    const boardId = task.boardId ?? "?";
    const board = ctx.boardMetrics?.byBoard?.[boardId];
    const max =
      board?.testingQueueMax ?? ctx.boardMetrics?.reviewQueueMax ?? REVIEW_QUEUE_MAX;
    const count =
      board?.testingQueueCount ?? ctx.boardMetrics?.reviewQueueCount ?? 0;
    if (count <= max) {
      return pass("review_queue_over_limit", "Очередь на проверку в норме");
    }
    if (!isTestingStatus(task.status)) {
      return pass("review_queue_over_limit", "Не в статусе проверки");
    }
    return warn(
      "review_queue_over_limit",
      `Доска ${boardId}: очередь на тестирование ${count} задач (лимит ${max})`,
    );
  },
};

export const inProgressStaleRule: Rule = {
  id: "in_progress_stale",
  severity: "soft",
  evaluate(task) {
    if (!isInProgressStatus(task.status)) {
      return pass("in_progress_stale", "Не в работе");
    }
    const lastAt = computeLastActivityAt(task);
    const hours = businessHoursSince(lastAt);
    if (hours != null && hours > STALE_WORKDAY_HOURS) {
      return warn(
        "in_progress_stale",
        `В работе без активности ${formatHoursLabel(hours)} (лимит ${STALE_WORKDAY_HOURS} раб.ч)`,
      );
    }
    return pass("in_progress_stale", "OK");
  },
};

export const reviewStaleRule: Rule = {
  id: "review_stale",
  severity: "soft",
  evaluate(task, ctx) {
    if (!isTestingStatus(task.status)) {
      return pass("review_stale", "Не на проверке");
    }
    const resolve = makeStateNameResolver(ctx.stateNameByKey);
    const review = findReviewStartedAt(task, resolve);
    const refAt = review?.at ?? computeLastActivityAt(task);
    const hours = businessHoursSince(refAt);
    const confidence = review?.confidence ?? "fallback_update_time";
    if (hours != null && hours > STALE_WORKDAY_HOURS) {
      return warn(
        "review_stale",
        `На проверке ${formatHoursLabel(hours)} (confidence=${confidence})`,
      );
    }
    return pass("review_stale", "OK");
  },
};

export const vagueDoneCommentRule: Rule = {
  id: "vague_done_comment",
  severity: "soft",
  evaluate(task) {
    const vague = findVagueDoneComments(task);
    if (vague.length === 0) {
      return pass("vague_done_comment", "OK");
    }
    const c = vague[0]!;
    return warn(
      "vague_done_comment",
      `Комментарий без деталей/пруфа: «${c.text.slice(0, 50)}»`,
    );
  },
};

export const highPriorityStaleRule: Rule = {
  id: "high_priority_stale",
  severity: "soft",
  evaluate(task) {
    const hp = isHighPriorityOrCriticalBug(task);
    if (!hp.match) {
      return pass("high_priority_stale", "Не high/critical/bug");
    }
    const lastAt = computeLastActivityAt(task);
    const hours = hoursSince(lastAt);
    if (hours != null && hours > 24) {
      return warn(
        "high_priority_stale",
        `${hp.marker}: без движения ${formatHoursLabel(hours)}`,
      );
    }
    return pass("high_priority_stale", "OK");
  },
};

export const reworkWithoutReasonRule: Rule = {
  id: "rework_without_reason",
  severity: "soft",
  evaluate(task, ctx) {
    const resolve = makeStateNameResolver(ctx.stateNameByKey);
    const transitions = findReworkTransitions(task, resolve);
    if (transitions.length === 0) {
      return pass("rework_without_reason", "Нет возвратов на доработку в history");
    }
    const latest = transitions.find((t) => {
      const ageHours = hoursSince(t.at);
      return ageHours != null && ageHours <= RECENT_REWORK_DAYS * 24;
    });
    if (!latest) {
      return pass("rework_without_reason", "Нет недавних возвратов на доработку");
    }
    const reason = findReworkReasonComment(task, latest.at);
    if (reason) {
      return pass("rework_without_reason", "Причина возврата найдена в комментариях");
    }
    return warn(
      "rework_without_reason",
      `Возврат ${latest.fromStatus} → ${latest.toStatus} без описания причины (${latest.at.slice(0, 10)})`,
    );
  },
};

export const statusCommentRules: Rule[] = [
  deadlineLessThanOneDayRule,
  reviewQueueSizeRule,
  inProgressStaleRule,
  reviewStaleRule,
  highPriorityStaleRule,
  blockedTaskReasonRule,
  vagueDoneCommentRule,
  reworkWithoutReasonRule,
];

export const DEADLINE_STATUS_RULE_IDS = new Set([
  "deadline_less_than_one_day",
  "deadline_not_overdue",
]);

export const STALE_STATUS_RULE_IDS = new Set([
  "in_progress_stale",
  "review_stale",
  "high_priority_stale",
]);

export const TESTING_QUEUE_RULE_IDS = new Set(["review_queue_over_limit"]);

export const COMMENT_STATUS_RULE_IDS = new Set([
  "blocked_task_reason",
  "vague_done_comment",
  "unresolved_question_keywords_in_card",
  "rework_without_reason",
]);
