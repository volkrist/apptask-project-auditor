export type AuditBoardSource = "board_url" | "board_id" | "env";

export type ResolvedAuditBoard = {
  boardUrl: string;
  source: AuditBoardSource;
};

/** База вида https://apptask.ru/c/7 из APPTASK_BOARD_URL или дефолт. */
export function apptaskBoardBaseFromEnv(): string {
  const env = process.env.APPTASK_BOARD_URL?.trim();
  const m = env?.match(/^(https?:\/\/[^/]+\/c\/\d+)/i);
  return m?.[1] ?? "https://apptask.ru/c/7";
}

export function buildBoardUrl(boardId: string | number): string {
  return `${apptaskBoardBaseFromEnv()}/board/${boardId}`;
}

/** Из строки Discord / .env; поддержка Excel HYPERLINK, «54», board/54. */
export function resolveBoardUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  if (/^\d{1,6}$/.test(trimmed)) {
    return buildBoardUrl(trimmed);
  }

  const boardPath = trimmed.match(/(?:^|\/)board\/(\d+)/i);
  if (boardPath?.[1]) {
    return buildBoardUrl(boardPath[1]);
  }

  const found: string[] = [];
  const urlRe = /https?:\/\/[^\s"')>\]]+/gi;
  for (const match of trimmed.matchAll(urlRe)) {
    const url = match[0]!.replace(/[>,)\]]+$/, "");
    if (url.includes("/board/")) found.push(url);
  }
  if (found.length === 0) {
    const any = trimmed.match(/https?:\/\/[^\s]+/i);
    if (any) return any[0]!.replace(/[>,)\]]+$/, "");
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return undefined;
  }

  const boardIds = found
    .map((u) => u.match(/\/board\/(\d+)/)?.[1])
    .filter((id): id is string => Boolean(id));
  if (new Set(boardIds).size > 1) {
    console.warn(
      `[audit] board_url contains multiple boards (${[...new Set(boardIds)].join(", ")}), using first: ${found[0]}`,
    );
  }
  return found[0];
}

/** board_url → board_id → APPTASK_BOARD_URL (.env). */
export function resolveAuditBoard(
  boardUrlRaw: string | undefined,
  boardIdOpt: number | null | undefined,
  envFallback?: string,
): ResolvedAuditBoard | null {
  const fromUrl = resolveBoardUrl(boardUrlRaw);
  if (fromUrl) return { boardUrl: fromUrl, source: "board_url" };

  if (boardIdOpt != null && boardIdOpt > 0) {
    return { boardUrl: buildBoardUrl(boardIdOpt), source: "board_id" };
  }

  const fromEnv = resolveBoardUrl(envFallback);
  if (fromEnv) return { boardUrl: fromEnv, source: "env" };

  return null;
}

export type CommentsBoardSource = "board_url" | "APPTASK_COMMENTS_BOARD_URL";

export type ResolvedCommentsBoard = {
  boardUrl: string;
  source: CommentsBoardSource;
};

/** База c/7 из APPTASK_COMMENTS_BOARD_URL (не APPTASK_BOARD_URL). */
export function apptaskCommentsBoardBaseFromEnv(): string {
  const env = process.env.APPTASK_COMMENTS_BOARD_URL?.trim();
  const m = env?.match(/^(https?:\/\/[^/]+\/c\/\d+)/i);
  return m?.[1] ?? "https://apptask.ru/c/7";
}

/** URL доски для /comments_*: полный URL, board/N, цифры; без APPTASK_BOARD_URL. */
export function resolveCommentsBoardUrl(
  raw: string | undefined,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  if (/^\d{1,6}$/.test(trimmed)) {
    return `${apptaskCommentsBoardBaseFromEnv()}/board/${trimmed}`;
  }

  return resolveBoardUrl(trimmed);
}

/** board_url (опция Discord) → APPTASK_COMMENTS_BOARD_URL. Никогда APPTASK_BOARD_URL. */
export function resolveCommentsBoard(
  boardUrlRaw: string | undefined,
  commentsEnvFallback = process.env.APPTASK_COMMENTS_BOARD_URL,
): ResolvedCommentsBoard | null {
  const trimmed = boardUrlRaw?.trim();
  if (trimmed) {
    const fromOption = resolveCommentsBoardUrl(trimmed);
    if (fromOption) return { boardUrl: fromOption, source: "board_url" };
    return null;
  }

  const fromEnv = resolveCommentsBoardUrl(commentsEnvFallback);
  if (fromEnv) {
    return { boardUrl: fromEnv, source: "APPTASK_COMMENTS_BOARD_URL" };
  }

  return null;
}
