import type { Rule } from "../rule-types.js";
import {
  collectLinkTargets,
  fail,
  isValidHttpUrl,
  pass,
  warn,
} from "../helpers.js";
import { checkHttpUrl } from "../helpers/link-check.js";

export const linksReachableRule: Rule = {
  id: "links_reachable",
  severity: "hard",
  evaluate: async (task, { config }) => {
    const fails: string[] = [];
    const warns: string[] = [];

    for (const attachment of task.attachments) {
      if (!attachment.url?.trim()) {
        fails.push(`вложение «${attachment.name}» без ссылки`);
      }
    }

    const targets = collectLinkTargets(task);
    for (const url of targets) {
      if (!isValidHttpUrl(url)) {
        fails.push(`некорректная ссылка: «${url}»`);
        continue;
      }

      if (!config.linkCheckEnabled) {
        continue;
      }

      const outcome = await checkHttpUrl(url, config.linkCheckTimeoutMs);
      if (outcome === "fail") {
        fails.push(`ссылка недоступна (HTTP 4xx/5xx): ${url}`);
      } else if (outcome === "timeout") {
        warns.push(`таймаут при проверке ссылки: ${url}`);
      }
    }

    if (fails.length > 0) {
      return fail("links_reachable", fails.join("; "));
    }
    if (warns.length > 0) {
      return warn("links_reachable", warns.join("; "));
    }

    if (targets.length === 0 && task.attachments.length === 0) {
      return pass("links_reachable", "Ссылок и вложений для проверки нет");
    }

    return pass("links_reachable");
  },
};
