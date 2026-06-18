import type { RawTask, TaskComment } from "../../adapters/apptask/types.js";
import { commentPlainTextForRules } from "../helpers.js";

const OPEN_QUESTION_MARKERS =
  /уточнить|обсудить|ждем ответ|ждём ответ|непонятно|нужно уточнить/i;

function commentAuthor(comment: TaskComment): string {
  return String(comment.creatorName ?? comment.creatorId ?? "")
    .trim()
    .toLowerCase();
}

function commentTime(comment: TaskComment): number {
  if (!comment.createTime) return 0;
  const t = Date.parse(comment.createTime);
  return Number.isNaN(t) ? 0 : t;
}

function isQuestionComment(text: string): boolean {
  if (!text.trim()) return false;
  return text.includes("?") || text.includes("？") || OPEN_QUESTION_MARKERS.test(text);
}

/** Эвристика: вопрос в комментарии без ответа другого участника. */
export function findOpenQuestionWithoutReply(task: RawTask): string | null {
  const comments = [...(task.comments ?? [])].sort(
    (a, b) => commentTime(a) - commentTime(b),
  );

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i]!;
    const text = commentPlainTextForRules(comment);
    if (!isQuestionComment(text)) continue;

    const author = commentAuthor(comment);
    const later = comments.slice(i + 1);
    const hasReply = later.some((reply) => {
      const replyText = commentPlainTextForRules(reply);
      if (replyText.trim().length < 6) return false;
      const replyAuthor = commentAuthor(reply);
      return Boolean(replyAuthor && author && replyAuthor !== author);
    });

    if (!hasReply) {
      return text.trim().slice(0, 160);
    }
  }

  return null;
}
