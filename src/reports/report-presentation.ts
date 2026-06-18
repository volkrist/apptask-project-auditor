/** Presentation-only helpers for audit-report.md (rules unchanged). */

export type SkipRuleSummary = {
  ruleId: string;
  label: string;
  count: number;
  sampleReason: string;
};

/** Правила, для которых SKIP означает отсутствие источника данных. */
export const SOURCE_UNAVAILABLE_RULE_IDS = new Set([
  "board_name_template",
  "board_folder_link",
  "board_tz_summary",
  "project_worksheet_match",
  "team_worksheet_match",
  "team_role_rate_match",
  "sprint_dates_match",
  "tracking_daily_anomaly",
]);

const PROFILE_LABELS: Record<string, string> = {
  contract_turboweave_v1: "TurboWeave",
  legacy_generic: "Расширенный (legacy)",
};

const SOURCE_LABELS: Record<string, string> = {
  "AppTask DB": "карточки AppTask (БД)",
  Scrum: "смета Scrum",
  "tracking-hours": "учёт фактического времени",
  "status history": "история смены статусов",
  "рабочая таблица": "рабочая таблица проекта",
  "метаданные доски": "метаданные доски AppTask",
};

const SKIP_USER_EXPLANATIONS: Record<string, string> = {
  board_name_template: "данные о названии доски не найдены в доступных источниках",
  board_folder_link:
    "описание доски недоступно — нельзя проверить ссылку на папку проекта",
  board_tz_summary:
    "описание доски недоступно — нельзя проверить краткое описание из ТЗ",
  project_worksheet_match: "рабочая таблица проекта не подключена",
  team_worksheet_match: "рабочая таблица проекта не подключена",
  team_role_rate_match: "рабочая таблица проекта не подключена",
  sprint_dates_match: "в Scrum-портале или рабочей таблице не найдены даты спринтов",
  tracking_daily_anomaly: "учёт времени по дням недоступен",
};

export function humanizeProfileLabel(profileId: string | undefined): string {
  if (!profileId) return "TurboWeave";
  return PROFILE_LABELS[profileId] ?? "Контрактный аудит";
}

export function humanizeSourcesUsed(sources: string[] | undefined): string {
  if (!sources?.length) return "AppTask (БД), Scrum, учёт времени, история статусов";
  return sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ");
}

export function isSourceMissingSkip(summary: SkipRuleSummary): boolean {
  return (
    SOURCE_UNAVAILABLE_RULE_IDS.has(summary.ruleId) &&
    isSourceMissingReason(summary.sampleReason)
  );
}

export function isSourceMissingReason(reason: string): boolean {
  const text = reason.toLowerCase();
  if (/не ui\/front|не ui\b|только для готовых|не применимо|не на проверке|не завершена|не активная|не заблокирована|факт ниже порога|лимит не превышен|недавно создана|уже в работе|нет замечаний|название соответствует|ссылка на макет найдена|описание доски пустое/i.test(reason)) {
    return false;
  }
  return (
    /недоступн|не подключ|не настроен|не найден|нет данных|не реализован|portal недоступен|tracking db|collector|worksheet|источник/i.test(
      text,
    ) || SOURCE_UNAVAILABLE_RULE_IDS.has(reason)
  );
}

export function filterSourceUnavailableSkips(
  skips: SkipRuleSummary[],
): SkipRuleSummary[] {
  return skips.filter(isSourceMissingSkip);
}

export function skipExplanationForReport(ruleId: string, sampleReason: string): string {
  if (SKIP_USER_EXPLANATIONS[ruleId]) {
    return SKIP_USER_EXPLANATIONS[ruleId]!;
  }
  return simplifyReasonText(sampleReason);
}

/** Убираем тех. жаргон из текста нарушения в пользовательской части отчёта. */
export function simplifyReasonText(reason: string): string {
  let text = reason.trim();

  text = text
    .replace(/\s*\(confidence=[^)]+\)/gi, "")
    .replace(/\s*\(last:[^)]+\)/gi, "")
    .replace(/board metadata collector/gi, "описание доски")
    .replace(/WORKSHEET_SOURCE/gi, "рабочая таблица")
    .replace(/Daily breakdown tracking/gi, "дневная разбивка учёта времени")
    .replace(/tracking DB/gi, "учёт времени")
    .replace(/Scrum portal/gi, "Scrum")
    .replace(/collector/gi, "источник данных")
    .replace(/contract_turboweave_v1/gi, "TurboWeave")
    .replace(/\s{2,}/g, " ")
    .trim();

  text = text.replace(/(\d+\.\d{2,})(?=\s*ч)/g, (_, num: string) => {
    const n = Number(num);
    return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : num;
  });

  return text;
}

export function formatAuditedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/** Пользовательская формулировка статуса Discord-сверки команды. */
export function humanizeDiscordTeamNote(note: string): string {
  if (/disallowed intents/i.test(note)) {
    return "не выполнена — у бота нет доступа к списку участников сервера";
  }
  return note;
}

/** Убирает тех. формулировки Discord из текста отчёта. */
export function humanizeDiscordInReportText(text: string): string {
  return text
    .replace(/Used disallowed intents/gi, "доступ к списку участников не предоставлен")
    .replace(
      /Discord:\s*сверка пропущена/gi,
      "Discord: доступ к списку участников не предоставлен",
    );
}
