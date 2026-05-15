import type { Rule } from "../rule-types.js";
import {
  collectLinkTargets,
  fail,
  isValidHttpUrl,
  pass,
  warn,
} from "../helpers.js";

export const linksReachableRule: Rule = {
  id: "links_reachable",
  severity: "hard",
  evaluate(task, { config }) {
    const issues: string[] = [];

    for (const attachment of task.attachments) {
      if (!attachment.url?.trim()) {
        issues.push(
          `вложение «${attachment.name}» без ссылки (проверка доступности невозможна)`,
        );
      }
    }

    const targets = collectLinkTargets(task);
    for (const url of targets) {
      if (!isValidHttpUrl(url)) {
        issues.push(`некорректная ссылка: «${url}»`);
      }
    }

    if (issues.length > 0) {
      const hasHard = targets.some((url) => url && !isValidHttpUrl(url));
      const message = issues.join("; ");
      if (hasHard) {
        return fail("links_reachable", message);
      }
      return warn("links_reachable", message);
    }

    if (config.linkCheckEnabled) {
      return warn(
        "links_reachable",
        "HTTP-проверка ссылок включена, но пока не реализована в синхронном движке",
      );
    }

    if (targets.length === 0 && task.attachments.length === 0) {
      return pass("links_reachable", "Ссылок и вложений для проверки нет");
    }

    return pass("links_reachable");
  },
};
