import type { RawTask, TaskComment } from "../../adapters/apptask/types.js";
import { commentPlainTextForRules } from "../helpers.js";
import { isOpenQuestionComment } from "./comment-heuristics.js";

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

function commentId(comment: TaskComment): string | null {
  if (comment.id == null) return null;
  const id = String(comment.id).trim();
  return id || null;
}

const MIN_REPLY_LENGTH = 6;

function isSubstantiveReplyText(text: string): boolean {
  return text.trim().length >= MIN_REPLY_LENGTH;
}

/** Ответ на вопрос: тред (parent_id), позже по времени от другого участника. */
export function hasReplyToQuestion(
  question: TaskComment,
  allComments: TaskComment[],
): boolean {
  const qid = commentId(question);
  const author = commentAuthor(question);
  const qTime = commentTime(question);

  for (const reply of allComments) {
    if (reply === question) continue;

    const replyText = commentPlainTextForRules(reply);
    if (!isSubstantiveReplyText(replyText)) continue;

    if (qid && reply.parentId != null && String(reply.parentId) === qid) {
      return true;
    }

    if (commentTime(reply) <= qTime) continue;

    const replyAuthor = commentAuthor(reply);
    if (replyAuthor && author && replyAuthor !== author) {
      return true;
    }
  }

  return false;
}

/** Эвристика: вопрос в комментарии без ответа. */
export function findOpenQuestionWithoutReply(task: RawTask): string | null {
  const comments = [...(task.comments ?? [])].sort(
    (a, b) => commentTime(a) - commentTime(b),
  );

  for (const comment of comments) {
    const text = commentPlainTextForRules(comment);
    if (!isOpenQuestionComment(text)) continue;
    if (!hasReplyToQuestion(comment, comments)) {
      return text.trim().slice(0, 160);
    }
  }

  return null;
}
