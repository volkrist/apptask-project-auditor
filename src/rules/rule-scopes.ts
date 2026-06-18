/** Уровень применения правила — влияет на подсчёт и формат отчёта. */
export type RuleScope = "task" | "board" | "project" | "sprint" | "team" | "user";

export const RULE_SCOPES: Record<string, RuleScope> = {
  board_name_template: "board",
  board_folder_link: "board",
  board_tz_summary: "board",
  team_worksheet_match: "team",
  sprint_dates_match: "sprint",
  tracking_daily_anomaly: "user",
};

export const ENTITY_RULE_IDS = new Set(Object.keys(RULE_SCOPES));

export function getRuleScope(ruleId: string): RuleScope {
  return RULE_SCOPES[ruleId] ?? "task";
}

export function isEntityRule(ruleId: string): boolean {
  return ENTITY_RULE_IDS.has(ruleId);
}

export function scopeSectionHint(scope: RuleScope): string {
  switch (scope) {
    case "board":
      return "Доска / проект / команда";
    case "project":
    case "team":
      return "Доска / проект / команда";
    case "sprint":
      return "Scrum / смета";
    case "user":
      return "Tracking";
    default:
      return "";
  }
}
