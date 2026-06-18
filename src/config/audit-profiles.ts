/**
 * Контрактные профили правил — какие проверки реально применяются к проекту.
 * Production: contract_turboweave_v1 (/turboweave, /audit, autostart).
 */

export type AuditProfileId = "contract_turboweave_v1" | "legacy_generic";

export type AuditProfile = {
  id: AuditProfileId;
  label: string;
  /** Правила, входящие в профиль (остальные не запускаются). */
  ruleIds: ReadonlySet<string>;
  /** Группы для секций отчёта. */
  reportGroups: ReadonlyArray<{
    section: string;
    ruleIds: readonly string[];
  }>;
  flowTaskPatterns: readonly RegExp[];
  flowCategoryPatterns: readonly RegExp[];
  flowTagPatterns: readonly RegExp[];
};

const CONTRACT_RULE_IDS = [
  "deadline_less_than_one_day",
  "high_priority_stale",
  "in_progress_stale",
  "review_stale",
  "review_queue_over_limit",
  "scrum_task_in_estimate",
  "scrum_title_matches_estimate",
  "scrum_planned_hours_present",
  "scrum_decomposition_over_20h",
  "actual_hours_exceeds_estimate",
  "estimate_exceeded_without_comment",
  "blocked_task_reason",
  "blocked_tag_present",
  "done_task_without_tracking",
  "in_progress_without_recent_tracking",
  "tracking_on_non_work_status",
  "rework_without_reason",
  "vague_done_comment",
  "unresolved_question_keywords_in_card",
  "review_stage_requires_assignee",
  "blocked_assignee_not_allowed",
  "assignee_present",
  "developer_active_tasks_limit",
  "never_started_task",
  "description_present",
  // source-dependent — правило есть, но может вернуть SKIP
  "board_name_template",
  "board_folder_link",
  "board_tz_summary",
  "team_worksheet_match",
  "sprint_dates_match",
  "ui_has_mockup_link",
  "ui_mockup_approved",
  "ui_adaptive_requirements",
  "ui_browser_device_requirements",
  "tracking_daily_anomaly",
  "tracking_high_without_result",
  "verified_success_comment",
  "tester_feedback_has_proof",
  "mass_start_without_completion",
  "act_ready_naming",
] as const;

export const CONTRACT_TURBOWEAVE_V1: AuditProfile = {
  id: "contract_turboweave_v1",
  label: "Контракт TurboWeave v1",
  ruleIds: new Set(CONTRACT_RULE_IDS),
  reportGroups: [
    {
      section: "Сроки и статусы",
      ruleIds: [
        "deadline_less_than_one_day",
        "high_priority_stale",
        "in_progress_stale",
        "review_stale",
        "review_queue_over_limit",
        "never_started_task",
        "mass_start_without_completion",
      ],
    },
    {
      section: "Scrum / смета",
      ruleIds: [
        "scrum_task_in_estimate",
        "scrum_title_matches_estimate",
        "scrum_planned_hours_present",
        "scrum_decomposition_over_20h",
        "sprint_dates_match",
      ],
    },
    {
      section: "Tracking",
      ruleIds: [
        "actual_hours_exceeds_estimate",
        "estimate_exceeded_without_comment",
        "done_task_without_tracking",
        "in_progress_without_recent_tracking",
        "tracking_on_non_work_status",
        "tracking_daily_anomaly",
        "tracking_high_without_result",
      ],
    },
    {
      section: "QA / проверка",
      ruleIds: [
        "review_stage_requires_assignee",
        "verified_success_comment",
        "tester_feedback_has_proof",
        "developer_active_tasks_limit",
      ],
    },
    {
      section: "Комментарии и открытые вопросы",
      ruleIds: [
        "unresolved_question_keywords_in_card",
        "rework_without_reason",
        "vague_done_comment",
        "blocked_task_reason",
        "blocked_tag_present",
      ],
    },
    {
      section: "Доска / проект / команда",
      ruleIds: [
        "board_name_template",
        "board_folder_link",
        "board_tz_summary",
        "team_worksheet_match",
        "assignee_present",
        "blocked_assignee_not_allowed",
        "description_present",
        "ui_has_mockup_link",
        "ui_mockup_approved",
        "ui_adaptive_requirements",
        "ui_browser_device_requirements",
        "act_ready_naming",
      ],
    },
  ],
  flowTaskPatterns: [
    /менеджмент/i,
    /коммуникаци/i,
    /операционн/i,
    /контроль\s*\(coo/i,
    /аудит проекта/i,
    /сопровождение/i,
    /маркетолог/i,
    /\(pm\)/i,
    /\(all\)/i,
    /gamedesign\)/i,
    /\(сто\)/i,
    /\(coo/i,
  ],
  flowCategoryPatterns: [/потоков/i, /сервис/i, /операцион/i, /менеджмент/i],
  flowTagPatterns: [/flow/i, /потоков/i, /service/i, /operational/i],
};

const LEGACY_GENERIC_RULE_IDS = new Set<string>(); // empty = all rules (handled in loader)

export const LEGACY_GENERIC_PROFILE: AuditProfile = {
  id: "legacy_generic",
  label: "Legacy generic (dev)",
  ruleIds: LEGACY_GENERIC_RULE_IDS,
  reportGroups: [],
  flowTaskPatterns: [],
  flowCategoryPatterns: [],
  flowTagPatterns: [],
};

const PROFILES: Record<AuditProfileId, AuditProfile> = {
  contract_turboweave_v1: CONTRACT_TURBOWEAVE_V1,
  legacy_generic: LEGACY_GENERIC_PROFILE,
};

export function resolveAuditProfileId(
  explicit?: string | null,
): AuditProfileId {
  const raw =
    explicit?.trim() ||
    process.env.AUDIT_PROFILE?.trim() ||
    "contract_turboweave_v1";
  if (raw in PROFILES) return raw as AuditProfileId;
  return "contract_turboweave_v1";
}

export function getAuditProfile(id?: AuditProfileId): AuditProfile {
  return PROFILES[id ?? resolveAuditProfileId()];
}

export function isRuleInProfile(ruleId: string, profile: AuditProfile): boolean {
  if (profile.id === "legacy_generic") return true;
  return profile.ruleIds.has(ruleId);
}
