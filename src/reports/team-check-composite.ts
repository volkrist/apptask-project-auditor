import type { AuditResult, EntityFinding } from "../rules/rule-types.js";
import type { RegistryOutcome } from "./check-registry-stats.js";

export type TeamSubSourceStatus = "OK" | "WARN" | "FAIL" | "SKIP";

export type TeamSubSourceView = {
  label: string;
  status: TeamSubSourceStatus;
  detail: string;
};

function entityFindingsForRule(
  result: AuditResult,
  ruleId: string,
): EntityFinding[] {
  return (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === ruleId,
  );
}

export function isTeamDiscordSkipped(result: AuditResult): boolean {
  const findings = entityFindingsForRule(result, "team_discord_match");
  return findings.length > 0 && findings.every((f) => f.status === "SKIP");
}

export function buildTeamSubSources(result: AuditResult): TeamSubSourceView[] {
  const wsFindings = entityFindingsForRule(result, "team_worksheet_match");
  const discordFindings = entityFindingsForRule(result, "team_discord_match");

  const wsSkipped =
    wsFindings.length > 0 && wsFindings.every((f) => f.status === "SKIP");
  const wsWarn = wsFindings.filter((f) => f.status === "WARN").length;
  const wsFail = wsFindings.filter((f) => f.status === "FAIL").length;

  const wsStatus: TeamSubSourceStatus = wsSkipped
    ? "SKIP"
    : wsFail > 0
      ? "FAIL"
      : wsWarn > 0
        ? "WARN"
        : "OK";

  const wsDetail = wsSkipped
    ? (wsFindings[0]?.reason ?? "рабочая таблица недоступна")
    : wsWarn > 0
      ? `${wsWarn} участников не в таблице`
      : "состав сверен";

  const discordSkipped = isTeamDiscordSkipped(result);
  const discordWarn = discordFindings.filter((f) => f.status === "WARN").length;

  const discordStatus: TeamSubSourceStatus = discordSkipped
    ? "SKIP"
    : discordWarn > 0
      ? "WARN"
      : "OK";

  const discordDetail = discordSkipped
    ? "нет доступа к списку участников сервера"
    : discordWarn > 0
      ? `${discordWarn} участников не в Discord`
      : "состав сверен";

  return [
    { label: "AppTask + рабочая таблица", status: wsStatus, detail: wsDetail },
    { label: "Discord", status: discordStatus, detail: discordDetail },
  ];
}

export function describeTeamCompositeRegistry(
  result: AuditResult,
  wsRow: {
    checked: string;
    candidates: string;
    unavailable: string;
    violations: string;
    outcome: RegistryOutcome;
  },
): {
  checked: string;
  candidates: string;
  unavailable: string;
  violations: string;
  outcome: RegistryOutcome;
} {
  const subs = buildTeamSubSources(result);
  const subSummary = subs
    .map((s) => `${s.label}: ${s.status} — ${s.detail}`)
    .join("; ");

  return {
    checked: "AppTask + рабочая таблица; Discord",
    candidates: subSummary || wsRow.candidates,
    unavailable: wsRow.unavailable,
    violations: wsRow.violations,
    outcome: wsRow.outcome,
  };
}
