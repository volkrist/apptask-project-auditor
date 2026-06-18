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

/** Проверка шаблона названия доски. */
export type BoardNameTemplateCheck = {
  status: "PASS" | "WARN";
  strictMatch: boolean;
  summary: string;
  deviations: string[];
  notes: string[];
  parsed: {
    tag: string | null;
    project: string | null;
    projectType: string | null;
    manager: string | null;
    separator: string | null;
  };
};

const BOARD_NAME_TEMPLATE =
  "{Тег проекта} {Проект} {Тип проекта} — {Менеджер проекта}";

export function checkBoardNameTemplate(name: string | null): BoardNameTemplateCheck {
  const empty: BoardNameTemplateCheck = {
    status: "WARN",
    strictMatch: false,
    summary: "название доски отсутствует",
    deviations: ["название доски отсутствует"],
    notes: [],
    parsed: {
      tag: null,
      project: null,
      projectType: null,
      manager: null,
      separator: null,
    },
  };
  if (!name?.trim()) return empty;

  const trimmed = name.trim();
  const deviations: string[] = [];
  const notes: string[] = [];

  const withTag = trimmed.match(
    /^(\S{2,12})\s+(.+?\([^)]+\))\s*([-—–])\s+(.+)$/u,
  );
  const withoutTag = trimmed.match(
    /^(.+?\([^)]+\))\s*([-—–])\s+(.+)$/u,
  );

  let tag: string | null = null;
  let projectBlock: string | null = null;
  let separator: string | null = null;
  let manager: string | null = null;

  if (withTag && withTag[1]!.trim().length <= 4) {
    tag = withTag[1]!.trim();
    projectBlock = withTag[2]!.trim();
    separator = withTag[3]!;
    manager = withTag[4]!.trim();
    notes.push(`тег проекта: «${tag}»`);
  } else if (withoutTag) {
    projectBlock = withoutTag[1]!.trim();
    separator = withoutTag[2]!;
    manager = withoutTag[3]!.trim();
    deviations.push(
      "отсутствует тег проекта в начале названия (первая часть до названия проекта)",
    );
  } else {
    deviations.push("название не разбирается по шаблону с типом проекта в скобках и менеджером");
  }

  if (separator === "-") {
    deviations.push(
      "использован дефис «-» вместо длинного тире «—»",
    );
  } else if (separator === "—") {
    notes.push("разделитель: длинное тире «—»");
  }

  const parenType = projectBlock?.match(/^(.+?)\s+(\([^)]+\))\s*$/u);
  const project = parenType?.[1]?.trim() ?? projectBlock;
  const projectType = parenType?.[2]?.trim() ?? null;

  if (!projectType) {
    deviations.push("тип проекта не указан в скобках");
  } else {
    notes.push("тип проекта в скобках — допустимый формат");
  }

  if (!manager || manager.split(/\s+/).length < 2) {
    deviations.push("менеджер проекта должен быть указан Фамилия Имя после разделителя");
  }

  const strictMatch =
    deviations.length === 0 &&
    separator === "—" &&
    Boolean(tag) &&
    Boolean(project) &&
    Boolean(projectType) &&
    Boolean(manager);

  const parsed = {
    tag,
    project: project ?? null,
    projectType,
    manager,
    separator,
  };

  if (strictMatch) {
    return {
      status: "PASS",
      strictMatch: true,
      summary: "название соответствует шаблону",
      deviations: [],
      notes: [
        `шаблон: ${BOARD_NAME_TEMPLATE}`,
        ...notes,
        `разобрано: тег «${tag}», проект «${project}», тип ${projectType}, менеджер «${manager}»`,
      ],
      parsed,
    };
  }

  return {
    status: "WARN",
    strictMatch: false,
    summary:
      deviations.length > 0
        ? `название не соответствует шаблону «${BOARD_NAME_TEMPLATE}»`
        : "название частично соответствует шаблону",
    deviations,
    notes: [`шаблон: ${BOARD_NAME_TEMPLATE}`, ...notes],
    parsed,
  };
}

export function getBoardMetadataForTask(
  byId: BoardMetadataById | undefined,
  boardId: string | null | undefined,
): BoardMetadata | undefined {
  if (!boardId?.trim()) return undefined;
  return byId?.[boardId.trim()];
}
