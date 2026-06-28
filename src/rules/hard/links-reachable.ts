import type { Rule } from "../rule-types.js";
import {
  collectLinkCheckTargets,
  fail,
  formatLinkCheckPassReason,
  isValidHttpUrl,
  pass,
  skip,
} from "../helpers.js";
import { checkHttpUrl } from "../helpers/link-check.js";

export const linksReachableRule: Rule = {
  id: "links_reachable",
  severity: "hard",
  evaluate: async (task, { config }) => {
    const fails: string[] = [];
    const attachmentNames: string[] = [];

    for (const attachment of task.attachments) {
      if (!attachment.url?.trim()) {
        attachmentNames.push(attachment.name || "без имени");
      }
    }
    if (attachmentNames.length > 0) {
      fails.push(
        `вложение без ссылки: ${attachmentNames.map((n) => `«${n}»`).join(", ")}`,
      );
    }

    const targets = collectLinkCheckTargets(task);
    const invalid: string[] = [];
    const httpTargets: string[] = [];

    for (const url of targets) {
      if (!isValidHttpUrl(url)) {
        invalid.push(url);
        continue;
      }
      httpTargets.push(url);
    }

    if (invalid.length > 0) {
      fails.push(`некорректная ссылка: ${invalid.join(", ")}`);
    }

    if (
      httpTargets.length === 0 &&
      attachmentNames.length === 0 &&
      invalid.length === 0
    ) {
      return pass("links_reachable", formatLinkCheckPassReason([]));
    }

    if (!config.linkCheckEnabled) {
      if (fails.length > 0) {
        return fail("links_reachable", fails.join("; "));
      }
      return skip(
        "links_reachable",
        `HTTP-проверка ссылок отключена (LINK_CHECK_ENABLED=false). ` +
          `Найдено ссылок: ${httpTargets.length}${httpTargets.length ? ` (${httpTargets.slice(0, 3).join(", ")})` : ""}`,
      );
    }

    const unreachable: string[] = [];
    const checkedOk: string[] = [];

    for (const url of httpTargets) {
      const outcome = await checkHttpUrl(url, config.linkCheckTimeoutMs);
      if (outcome === "ok") {
        checkedOk.push(url);
        continue;
      }
      if (outcome === "fail") {
        unreachable.push(`${url} (HTTP 4xx/5xx)`);
        continue;
      }
      unreachable.push(`${url} (недоступна / таймаут)`);
    }

    if (unreachable.length > 0) {
      fails.push(`ссылки недоступны: ${unreachable.join("; ")}`);
    }

    if (fails.length > 0) {
      return fail("links_reachable", fails.join("; "));
    }

    return pass("links_reachable", formatLinkCheckPassReason(checkedOk));
  },
};
