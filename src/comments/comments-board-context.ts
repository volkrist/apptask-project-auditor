import { parseBoardId } from "../adapters/apptask/urls.js";
import type { RawTask } from "../adapters/apptask/types.js";

export type CommentsBoardContext = {
  boardUrl: string;
  boardId: string;
  boardIdNum: number;
};

function parseBoardUrlFromRaw(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (/^\d{1,6}$/.test(trimmed)) {
    const base =
      process.env.APPTASK_BOARD_URL?.match(/^(https?:\/\/[^/]+\/c\/\d+)/i)?.[1] ??
      "https://apptask.ru/c/7";
    return `${base}/board/${trimmed}`;
  }

  const boardPath = trimmed.match(/(?:^|\/)board\/(\d+)/i);
  if (boardPath?.[1]) {
    const base =
      process.env.APPTASK_BOARD_URL?.match(/^(https?:\/\/[^/]+\/c\/\d+)/i)?.[1] ??
      "https://apptask.ru/c/7";
    return `${base}/board/${boardPath[1]}`;
  }

  const urlRe = /https?:\/\/[^\s"')>\]]+/gi;
  for (const match of trimmed.matchAll(urlRe)) {
    const url = match[0]!.replace(/[>,)\]]+$/, "");
    if (url.includes("/board/")) return url;
  }

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

/**
 * Доска для комментариев: comments_board_url или основная audit board_url.
 */
export function resolveCommentsBoardUrl(
  auditBoardUrl: string,
  commentsBoardUrlOverride?: string | null,
): string {
  if (!commentsBoardUrlOverride?.trim()) return auditBoardUrl;
  return parseBoardUrlFromRaw(commentsBoardUrlOverride) ?? auditBoardUrl;
}

export function isSameCommentsBoard(
  auditBoardUrl: string,
  commentsBoardUrl: string,
): boolean {
  return parseBoardId(auditBoardUrl) === parseBoardId(commentsBoardUrl);
}

export function resolveCommentsBoardContext(
  boardUrl: string,
): CommentsBoardContext | null {
  const boardId = parseBoardId(boardUrl);
  if (!boardId) return null;
  const boardIdNum = Number(boardId);
  if (!Number.isFinite(boardIdNum)) return null;
  return { boardUrl, boardId, boardIdNum };
}

/** Задача принадлежит доске из board_url (по url или id с той же сессии). */
export function isTaskOnBoard(task: RawTask, boardId: string): boolean {
  if (!task.id?.trim()) return false;
  if (task.url?.trim()) {
    return task.url.includes(`/board/${boardId}/`);
  }
  return true;
}
