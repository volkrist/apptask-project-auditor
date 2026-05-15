import type { Rule } from "../rule-types.js";
import { isBlank, normalizeTitle, pass, titleSimilarity, warn } from "../helpers.js";

export const notDuplicateRule: Rule = {
  id: "not_duplicate",
  severity: "soft",
  evaluate(task, { config, allTasks }) {
    if (isBlank(task.title)) {
      return pass("not_duplicate", "Название пустое — проверка пропущена");
    }
    const currentTitle = normalizeTitle(task.title!);
    const duplicates: string[] = [];

    for (const other of allTasks) {
      if (other === task) continue;
      if (task.id && other.id && task.id === other.id) continue;
      if (isBlank(other.title)) continue;
      const similarity = titleSimilarity(currentTitle, other.title!);
      if (similarity >= config.duplicateSimilarityThreshold) {
        const label = other.id ? `№${other.id}` : (other.title ?? "без названия");
        duplicates.push(`${label} (${Math.round(similarity * 100)}%)`);
      }
    }

    if (duplicates.length > 0) {
      return warn(
        "not_duplicate",
        `Возможный дубликат: ${duplicates.slice(0, 3).join("; ")}`,
      );
    }
    return pass("not_duplicate");
  },
};
