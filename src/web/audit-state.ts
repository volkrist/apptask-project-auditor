import type { RunAuditResult } from "../app/run-audit.js";

export type AuditJobPhase = "idle" | "running" | "done" | "error";

export type AuditJobStatus = {
  phase: AuditJobPhase;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  reportDir: string | null;
  reportLinks: {
    json: string | null;
    markdown: string | null;
    summary: string | null;
  };
  failCount: number | null;
  warnCount: number | null;
  cardsChecked: number | null;
  discordPublished: boolean;
  discordError: string | null;
};

const idleStatus = (): AuditJobStatus => ({
  phase: "idle",
  message: "Готов к запуску",
  startedAt: null,
  finishedAt: null,
  reportDir: null,
  reportLinks: { json: null, markdown: null, summary: null },
  failCount: null,
  warnCount: null,
  cardsChecked: null,
  discordPublished: false,
  discordError: null,
});

let status: AuditJobStatus = idleStatus();

export function getAuditJobStatus(): AuditJobStatus {
  return status;
}

export function isAuditRunning(): boolean {
  return status.phase === "running";
}

export function markAuditRunning(message: string): void {
  status = {
    ...idleStatus(),
    phase: "running",
    message,
    startedAt: new Date().toISOString(),
  };
}

export function markAuditDone(result: RunAuditResult): void {
  const folder = result.output.dir.replace(/\\/g, "/").split("/").pop() ?? "";
  status = {
    phase: "done",
    message: `Готово: FAIL=${result.result.meta.failCount}, WARN=${result.result.meta.warnCount}`,
    startedAt: status.startedAt,
    finishedAt: new Date().toISOString(),
    reportDir: result.output.dir,
    reportLinks: {
      json: folder ? `/reports/${folder}/audit.json` : null,
      markdown: folder ? `/reports/${folder}/audit.md` : null,
      summary: folder ? `/reports/${folder}/summary.md` : null,
    },
    failCount: result.result.meta.failCount,
    warnCount: result.result.meta.warnCount,
    cardsChecked: result.result.meta.cardsChecked,
    discordPublished: result.discordPublished,
    discordError: result.discordError ?? null,
  };
}

export function markAuditError(message: string): void {
  status = {
    ...status,
    phase: "error",
    message,
    finishedAt: new Date().toISOString(),
  };
}

export function resetAuditJob(): void {
  status = idleStatus();
}
