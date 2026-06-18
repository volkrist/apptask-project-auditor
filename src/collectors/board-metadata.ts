import type { DbConfig } from "./db-config.js";
import { querySelect } from "./db-client.js";
import { boardIdsInClause } from "./db-client.js";

export type BoardMetadata = {
  boardId: number;
  name: string | null;
  description: string | null;
  comment: string | null;
  discordLink: string | null;
};

export type BoardMetadataById = Record<string, BoardMetadata>;

type DbBoardMetadataRow = {
  id: number;
  name: string | null;
  description: string | null;
  comment: string | null;
  discord_link: string | null;
};

export async function fetchBoardMetadata(
  config: DbConfig,
  boardIds: number[],
): Promise<BoardMetadata[]> {
  if (boardIds.length === 0) return [];
  const { clause, params } = boardIdsInClause(boardIds);
  const rows = await querySelect<DbBoardMetadataRow>(
    config,
    `
SELECT id, name, description, comment, discord_link
FROM dbo.Boards
WHERE id IN (${clause}) AND ISNULL(removed, 0) = 0
`,
    params,
  );
  return rows.map((r) => ({
    boardId: r.id,
    name: r.name?.trim() || null,
    description: r.description?.trim() || null,
    comment: r.comment?.trim() || null,
    discordLink: r.discord_link?.trim() || null,
  }));
}

export function indexBoardMetadata(rows: BoardMetadata[]): BoardMetadataById {
  const out: BoardMetadataById = {};
  for (const row of rows) {
    out[String(row.boardId)] = row;
  }
  return out;
}

export async function loadBoardMetadataById(
  config: DbConfig,
  boardIds: number[],
): Promise<BoardMetadataById> {
  const rows = await fetchBoardMetadata(config, boardIds);
  return indexBoardMetadata(rows);
}

const FOLDER_LINK_RE =
  /https?:\/\/(?:drive\.google\.com\/(?:drive\/folders|file\/d)|disk\.yandex\.ru|dropbox\.com|1drv\.ms|sharepoint\.com)[^\s)>\]"']*/i;

export function extractBoardText(meta: BoardMetadata | undefined): string {
  if (!meta) return "";
  return [meta.description, meta.comment].filter(Boolean).join("\n");
}

export function boardHasFolderLink(meta: BoardMetadata | undefined): boolean {
  const text = extractBoardText(meta);
  return FOLDER_LINK_RE.test(text);
}

export function boardHasTzSummary(meta: BoardMetadata | undefined): boolean {
  const text = extractBoardText(meta);
  if (!text.trim()) return false;
  if (text.length >= 80) return true;
  return /тз|техническ|описание проекта|краткое описание|цель проекта/i.test(text);
}

/** Проверка шаблона названия доски (мягкая эвристика). */
export function checkBoardNameTemplate(name: string | null): {
  matches: boolean;
  reason: string;
} {
  if (!name?.trim()) {
    return { matches: false, reason: "название доски отсутствует" };
  }
  const trimmed = name.trim();
  const hasManagerSeparator = /\s[-—–]\s+[^-—–]+$/u.test(trimmed);
  const hasTypeHint =
    /\([^)]{2,}\)/u.test(trimmed) || /\b(аутстафф|outstaff|fixed|t&m|tm)\b/i.test(trimmed);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (hasManagerSeparator && hasTypeHint && wordCount >= 4) {
    return { matches: true, reason: "название соответствует шаблону" };
  }
  if (!hasManagerSeparator) {
    return {
      matches: false,
      reason: "в названии нет разделителя перед менеджером проекта (— или -)",
    };
  }
  return {
    matches: false,
    reason: "название не соответствует шаблону «{Тег} {Проект} {Тип} — {Менеджер}»",
  };
}

export function getBoardMetadataForTask(
  byId: BoardMetadataById | undefined,
  boardId: string | null | undefined,
): BoardMetadata | undefined {
  if (!boardId?.trim()) return undefined;
  return byId?.[boardId.trim()];
}
