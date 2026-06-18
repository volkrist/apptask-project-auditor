import { loadScrumEstimateConfig } from "../scrum/scrum-estimate-config.js";

export function googleSpreadsheetUrl(
  spreadsheetId: string,
  gid?: string | null,
): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return gid ? `${base}#gid=${gid}` : base;
}

export function scrumSheetLink(): string | null {
  const cfg = loadScrumEstimateConfig();
  if (!cfg.scrumSpreadsheetId) return null;
  return googleSpreadsheetUrl(cfg.scrumSpreadsheetId, cfg.scrumSheetGid);
}

export function workSheetLink(): string | null {
  const cfg = loadScrumEstimateConfig();
  if (!cfg.workSpreadsheetId) return null;
  return googleSpreadsheetUrl(cfg.workSpreadsheetId);
}

export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
