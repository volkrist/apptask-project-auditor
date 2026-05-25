import fs from "node:fs";
import path from "node:path";
import {
  COMMENT_QUESTION_MARKERS,
  type CommentMarkerHit,
} from "./comment-markers.js";

export type CommentsReportTask = {
  taskId: string;
  taskUrl: string;
  title: string | null;
  commentsCount: number;
};

export type CommentsReportInput = {
  boardUrl: string;
  mode: "full" | "limit";
  limit: number | null;
  totalTasksOnBoard: number;
  checkedTasks: number;
  tasksWithComments: number;
  totalComments: number;
  markerHits: CommentMarkerHit[];
  tasks: CommentsReportTask[];
  durationMs: number;
  checkedAt?: Date;
  projectName?: string;
};

export type CommentsOutputPaths = {
  dir: string;
  summaryPath: string;
  detailedPath: string;
  jsonPath: string;
};

function formatDirName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export function createCommentsOutputDir(baseDir = path.join("output")): string {
  const dir = path.join(baseDir, `comments-${formatDirName()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatCheckedAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join("-");
}

function modeLabel(input: CommentsReportInput): string {
  return input.mode === "limit" && input.limit != null
    ? `limit ${input.limit}`
    : "full";
}

function checkedOfTotal(input: CommentsReportInput): string {
  return `${input.checkedTasks} из ${input.totalTasksOnBoard}`;
}

function defaultProjectName(): string {
  return process.env.APPTASK_PROJECT_NAME?.trim() || "AppTask Project";
}

export function buildCommentsSummaryMarkdown(input: CommentsReportInput): string {
  const checkedAt = input.checkedAt ?? new Date();
  const projectName = input.projectName ?? defaultProjectName();
  const markers = input.markerHits.length;
  const markerList = COMMENT_QUESTION_MARKERS.map((m) => `- ${m}`).join("\n");

  const outcome =
    markers === 0
      ? "Нарушения по комментариям не найдены."
      : "Найдены комментарии с признаками незакрытых вопросов. Подробности в comments-detailed.md.";

  return [
    "# Проверка комментариев AppTask",
    "",
    `- **Проект:** ${projectName}`,
    `- **Доска:** ${input.boardUrl}`,
    `- **Проверено:** ${checkedOfTotal(input)}`,
    `- **Задач с комментариями:** ${input.tasksWithComments}`,
    `- **Всего комментариев:** ${input.totalComments}`,
    `- **Найдено маркеров:** ${markers}`,
    `- **Режим:** ${modeLabel(input)}`,
    `- **Дата проверки:** ${formatCheckedAt(checkedAt)}`,
    "",
    "## Маркеры",
    "",
    "Проверялись:",
    markerList,
    "",
    "## Итог",
    "",
    outcome,
    "",
  ].join("\n");
}

export function buildCommentsDetailedMarkdown(input: CommentsReportInput): string {
  const lines = [
    "# Детальный отчёт по комментариям",
    "",
    "| Поле | Значение |",
    "|---|---|",
    `| Доска | ${input.boardUrl} |`,
    `| Проверено задач | ${checkedOfTotal(input)} |`,
    `| Задач с комментариями | ${input.tasksWithComments} |`,
    `| Всего комментариев | ${input.totalComments} |`,
    `| Найдено маркеров | ${input.markerHits.length} |`,
    "",
    "## Найденные маркеры",
    "",
  ];

  if (input.markerHits.length === 0) {
    lines.push("Не найдено.");
    return lines.join("\n");
  }

  const byTask = new Map<string, CommentMarkerHit[]>();
  for (const hit of input.markerHits) {
    const list = byTask.get(hit.taskId) ?? [];
    list.push(hit);
    byTask.set(hit.taskId, list);
  }

  for (const [taskId, hits] of byTask) {
    const first = hits[0]!;
    lines.push(`### Задача ${taskId}`);
    lines.push(`- **URL:** ${first.taskUrl}`);
    for (const hit of hits) {
      const date = hit.createTime?.trim() ? hit.createTime : "—";
      const author =
        hit.creatorId != null && String(hit.creatorId).trim() !== ""
          ? String(hit.creatorId)
          : "—";
      lines.push(`- **Комментарий ID:** ${hit.commentId}`);
      lines.push(`- **Автор ID:** ${author}`);
      lines.push(`- **Дата:** ${date}`);
      lines.push(`- **Маркер:** ${hit.marker}`);
      lines.push(`- **Текст:** ${hit.commentPlain}`);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function taskIdForJson(taskId: string): number | string {
  return /^\d+$/.test(taskId) ? Number(taskId) : taskId;
}

export function buildCommentsJson(input: CommentsReportInput): string {
  const checkedAt = (input.checkedAt ?? new Date()).toISOString();
  const payload = {
    meta: {
      boardUrl: input.boardUrl,
      checkedAt,
      mode: input.mode,
      limit: input.limit,
      totalTasks: input.totalTasksOnBoard,
      checkedTasks: input.checkedTasks,
      tasksWithComments: input.tasksWithComments,
      totalComments: input.totalComments,
      markersFound: input.markerHits.length,
      durationMs: input.durationMs,
    },
    markers: input.markerHits.map((h) => ({
      taskId: taskIdForJson(h.taskId),
      taskUrl: h.taskUrl,
      taskTitle: h.taskTitle,
      commentId: h.commentId,
      creatorId: h.creatorId,
      createTime: h.createTime,
      marker: h.marker,
      text: h.commentPlain,
    })),
    tasks: input.tasks.map((t) => ({
      taskId: taskIdForJson(t.taskId),
      taskUrl: t.taskUrl,
      title: t.title,
      commentsCount: t.commentsCount,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** @deprecated use buildCommentsDetailedMarkdown */
export function buildCommentsReportMarkdown(input: CommentsReportInput): string {
  return buildCommentsDetailedMarkdown(input);
}

export function writeCommentsReport(
  input: CommentsReportInput,
  outputDir?: string,
): CommentsOutputPaths {
  const dir = outputDir ?? createCommentsOutputDir();
  fs.mkdirSync(dir, { recursive: true });

  const summaryPath = path.join(dir, "comments-summary.md");
  const detailedPath = path.join(dir, "comments-detailed.md");
  const jsonPath = path.join(dir, "comments.json");

  const fullInput = {
    ...input,
    checkedAt: input.checkedAt ?? new Date(),
    projectName: input.projectName ?? defaultProjectName(),
  };

  fs.writeFileSync(summaryPath, buildCommentsSummaryMarkdown(fullInput), "utf8");
  fs.writeFileSync(detailedPath, buildCommentsDetailedMarkdown(fullInput), "utf8");
  fs.writeFileSync(jsonPath, buildCommentsJson(fullInput), "utf8");

  console.log(`[comments-report] saved ${dir.replace(/\\/g, "/")}`);

  return { dir, summaryPath, detailedPath, jsonPath };
}
