import {
  appTaskCommentsToTaskComments,
  htmlCommentContentToText,
  type AppTaskComment,
} from "./app-task-comments.js";

/** Явные маркеры незакрытого вопроса в тексте комментария (без эвристики «получен ли ответ»). */
export const COMMENT_QUESTION_MARKERS = [
  "уточнить",
  "обсудить",
  "ждем ответ",
  "ждём ответ",
  "непонятно",
] as const;

export type CommentMarkerHit = {
  taskId: string;
  taskUrl: string;
  taskTitle: string | null;
  commentId: string | number;
  creatorId: number | string | null;
  createTime: string | null;
  marker: string;
  commentPlain: string;
};

export function findMarkersInPlainText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const marker of COMMENT_QUESTION_MARKERS) {
    if (lower.includes(marker.toLowerCase())) found.push(marker);
  }
  return found;
}

export function findMarkerHitsInComments(
  taskId: string,
  taskUrl: string,
  taskTitle: string | null,
  comments: AppTaskComment[],
): CommentMarkerHit[] {
  const hits: CommentMarkerHit[] = [];
  for (const comment of comments) {
    const plain = htmlCommentContentToText(comment.content);
    for (const marker of findMarkersInPlainText(plain)) {
      hits.push({
        taskId,
        taskUrl,
        taskTitle,
        commentId: comment.id,
        creatorId: comment.creatorId,
        createTime: comment.createTime,
        marker,
        commentPlain: plain,
      });
    }
  }
  return hits;
}

export { htmlCommentContentToText, appTaskCommentsToTaskComments };
