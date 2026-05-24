import { findBlockedAssignees } from "../../users/app-task-users.js";
import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

export const blockedAssigneeNotAllowedRule: Rule = {
  id: "blocked_assignee_not_allowed",
  severity: "hard",
  evaluate(task, ctx) {
    const users = ctx.appTaskUsers;
    if (!users || users.length === 0) {
      return pass(
        "blocked_assignee_not_allowed",
        "Список пользователей AppTask недоступен — проверка пропущена",
      );
    }

    const blocked = findBlockedAssignees(task, users);
    if (blocked.length === 0) {
      return pass("blocked_assignee_not_allowed");
    }

    const parts = blocked.map((m) => {
      const matchNote =
        m.matchBy === "userId"
          ? `, совпадение по userId ${m.userId}`
          : ", совпадение по ФИО";
      return `${m.user.realName}${matchNote}`;
    });

    return fail(
      "blocked_assignee_not_allowed",
      `Задача назначена на заблокированного/неактивного пользователя AppTask: ${parts.join("; ")}`,
    );
  },
};
