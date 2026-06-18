import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
} from "../scrum/scrum-estimate-config.js";
import { listSpreadsheetSheetTitles, readSheetRows } from "../scrum/google-sheets-reader.js";

export type WorksheetParticipant = {
  name: string;
  status: string;
  role: string | null;
  rate: string | null;
  email: string | null;
};

export type WorksheetMilestone = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

export type WorksheetAuditContext = {
  loaded: boolean;
  loadError?: string;
  spreadsheetId: string | null;
  projectName: string | null;
  projectDescription: string | null;
  participants: WorksheetParticipant[];
  milestones: WorksheetMilestone[];
};

function escSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function parseRuDateCell(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3];
  return `${m[1]!.padStart(2, "0")}.${m[2]!.padStart(2, "0")}.${year}`;
}

function findRowValue(rows: string[][], labelRe: RegExp): string | null {
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      const cell = row[i]?.trim() ?? "";
      if (labelRe.test(cell)) {
        const next = row[i + 1]?.trim();
        if (next) return next;
      }
    }
  }
  return null;
}

function parseParticipants(rows: string[][]): WorksheetParticipant[] {
  const headerIdx = rows.findIndex((row) =>
    row.some((c) => /имя\s+фамилия/i.test(c ?? "")) &&
    row.some((c) => /специализац/i.test(c ?? "")),
  );
  if (headerIdx < 0) return [];

  const header = rows[headerIdx] ?? [];
  const statusCol = header.findIndex((c) => /статус/i.test(c ?? ""));
  const nameCol = header.findIndex((c) => /имя\s+фамилия/i.test(c ?? ""));
  const emailCol = header.findIndex((c) => /email/i.test(c ?? ""));
  const roleCol = header.findIndex((c) => /специализац/i.test(c ?? "") && !/црм/i.test(c ?? ""));
  const rateCol = header.findIndex((c) => /ставка/i.test(c ?? ""));

  const out: WorksheetParticipant[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const name = row[nameCol]?.trim();
    if (!name || /памятка/i.test(name)) continue;
    out.push({
      name,
      status: row[statusCol]?.trim() || "—",
      role: roleCol >= 0 ? row[roleCol]?.trim() || null : null,
      rate: rateCol >= 0 ? row[rateCol]?.trim() || null : null,
      email: emailCol >= 0 ? row[emailCol]?.trim() || null : null,
    });
  }
  return out;
}

function parseMilestones(rows: string[][]): WorksheetMilestone[] {
  const headerIdx = rows.findIndex((row) =>
    row.some((c) => /дата начала/i.test(c ?? "")) &&
    row.some((c) => /название майлстоуна/i.test(c ?? "")),
  );
  if (headerIdx < 0) return [];

  const header = rows[headerIdx] ?? [];
  const idCol = header.findIndex((c) => /^id$/i.test((c ?? "").trim()));
  const nameCol = header.findIndex((c) => /название майлстоуна/i.test(c ?? ""));
  const startCol = header.findIndex((c) => /дата начала/i.test(c ?? ""));
  const endCol = header.findIndex((c) => /дата окончания/i.test(c ?? ""));

  const out: WorksheetMilestone[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const id = row[idCol]?.trim() ?? "";
    const name = row[nameCol]?.trim() ?? "";
    if (!id || !name || /^итого$/i.test(name)) continue;
    out.push({
      id,
      name,
      startDate: parseRuDateCell(row[startCol]),
      endDate: parseRuDateCell(row[endCol]),
    });
  }
  return out;
}

export function participantNameMatches(
  assignee: string,
  participants: WorksheetParticipant[],
): boolean {
  const norm = normalizeName(assignee);
  if (!norm) return false;
  const assigneeWords = new Set(norm.split(/\s+/).filter(Boolean));
  return participants.some((p) => {
    const pNorm = normalizeName(p.name);
    if (!pNorm) return false;
    if (pNorm === norm || norm.includes(pNorm) || pNorm.includes(norm)) {
      return true;
    }
    const partWords = pNorm.split(/\s+/).filter(Boolean);
    if (partWords.length < 2 || assigneeWords.size < 2) return false;
    const overlap = partWords.filter((w) => assigneeWords.has(w));
    return overlap.length >= 2;
  });
}

export function activeWorksheetParticipants(
  participants: WorksheetParticipant[],
): WorksheetParticipant[] {
  return participants.filter((p) => /активен/i.test(p.status));
}

export async function loadWorksheetAuditContext(): Promise<WorksheetAuditContext> {
  const config = loadScrumEstimateConfig();
  const empty: WorksheetAuditContext = {
    loaded: false,
    spreadsheetId: config.workSpreadsheetId,
    projectName: null,
    projectDescription: null,
    participants: [],
    milestones: [],
  };

  if (!config.workSpreadsheetId) {
    return { ...empty, loadError: "рабочая таблица проекта не подключена" };
  }
  if (!isGoogleSheetsConfigured()) {
    return { ...empty, loadError: "доступ к Google Sheets не настроен" };
  }

  try {
    const titles = await listSpreadsheetSheetTitles(config.workSpreadsheetId);
    const infoTab = titles.find((t) => /информация о проекте/i.test(t));
    const teamTab = titles.find((t) => /участники проекта/i.test(t));
    const milestoneTab = titles.find((t) => /майлстоуны/i.test(t));

    let projectName: string | null = null;
    let projectDescription: string | null = null;
    let participants: WorksheetParticipant[] = [];
    let milestones: WorksheetMilestone[] = [];

    if (infoTab) {
      const infoRows = await readSheetRows(
        config.workSpreadsheetId,
        `${escSheet(infoTab)}!A1:H40`,
      );
      projectName =
        findRowValue(infoRows, /проект\s*"/i) ??
        infoRows
          .flat()
          .find((c) => /turbo\s*weave/i.test(c ?? ""))
          ?.replace(/.*проект\s*"/i, "")
          .replace(/".*/, "")
          .trim() ??
        null;
      projectDescription = findRowValue(infoRows, /краткое описание/i);
    }

    if (teamTab) {
      const teamRows = await readSheetRows(
        config.workSpreadsheetId,
        `${escSheet(teamTab)}!A1:H80`,
      );
      participants = parseParticipants(teamRows);
    }

    if (milestoneTab) {
      const msRows = await readSheetRows(
        config.workSpreadsheetId,
        `${escSheet(milestoneTab)}!A1:H20`,
      );
      milestones = parseMilestones(msRows);
    }

    return {
      loaded: true,
      spreadsheetId: config.workSpreadsheetId,
      projectName,
      projectDescription,
      participants,
      milestones,
    };
  } catch (err) {
    return {
      ...empty,
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function sprintMilestonesHaveDates(
  milestones: WorksheetMilestone[],
): { ok: boolean; missing: string[] } {
  const sprintMilestones = milestones.filter((m) => /^M[1-4]$/i.test(m.id));
  const missing = sprintMilestones
    .filter((m) => !m.startDate || !m.endDate)
    .map((m) => `${m.id} (${m.name})`);
  return { ok: missing.length === 0 && sprintMilestones.length > 0, missing };
}
