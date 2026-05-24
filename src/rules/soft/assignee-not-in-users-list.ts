import { findAssigneesMissingFromUsers } from "../../users/app-task-users.js";
import type { Rule } from "../rule-types.js";
import { pass, warn } from "../helpers.js";

export const assigneeNotInUsersListRule: Rule = {
  id: "assignee_not_in_users_list",
  severity: "soft",
  evaluate(task, ctx) {
    const users = ctx.appTaskUsers;
    if (!users || users.length === 0) {
      return pass(
        "assignee_not_in_users_list",
        "Список пользователей AppTask недоступен — проверка пропущена",
      );
    }

    const missing = findAssigneesMissingFromUsers(task, users);
    if (missing.length === 0) {
      return pass("assignee_not_in_users_list");
    }

    const names = missing.map((m) => m.name).join("; ");
    return warn(
      "assignee_not_in_users_list",
      `Исполнитель не найден в списке пользователей AppTask: ${names}`,
    );
  },
};
