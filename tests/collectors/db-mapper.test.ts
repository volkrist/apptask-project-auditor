import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToPlainText } from "../../src/collectors/api-mapper.js";
import { mapDbBundleToRawTasks } from "../../src/collectors/db-mapper.js";
import type {
  DbAssigneeRow,
  DbCommentRow,
  DbTaskRow,
} from "../../src/collectors/db-types.js";

const baseTask: DbTaskRow = {
  id: 9001,
  offset_id: 1,
  board_id: 783,
  task_name: "3.2.1 UI: HUD",
  content: "<p>Описание&nbsp;задачи</p>",
  block_id: 10,
  block_name: "Frontend",
  state_id: 2,
  status_name: "В процессе",
  priority: 2,
  planned_start_time: "2026-01-10T00:00:00.000Z",
  planned_end_time: "2026-02-20T00:00:00.000Z",
  end_time: null,
  update_time: "2026-03-01T12:00:00.000Z",
  create_time: "2026-01-01T00:00:00.000Z",
  real_sprint_id: 5,
  sprint_id: 4,
  creator_id: 100,
};

test("mapDbBundleToRawTasks builds url and cleans html", () => {
  const assignees: DbAssigneeRow[] = [
    {
      board_id: 783,
      task_id: 9001,
      task_name: "3.2.1 UI: HUD",
      user_id: 42,
      real_name: "Иван",
      email: null,
      blocked: 0,
      removed: 0,
    },
  ];
  const comments: DbCommentRow[] = [
    {
      id: 1,
      board_id: 783,
      task_id: 9001,
      task_name: "3.2.1 UI: HUD",
      content: "<b>готово</b>",
      create_time: "2026-03-02T00:00:00.000Z",
      creator_id: 42,
      creator_name: "Иван",
      parent_id: null,
    },
  ];

  const [raw] = mapDbBundleToRawTasks(
    {
      tasks: [baseTask],
      assignees,
      tags: [],
      comments,
      histories: [],
    },
    "https://apptask.ru/c/7",
  );

  assert.equal(raw.id, "9001");
  assert.equal(raw.boardId, "783");
  assert.equal(raw.url, "https://apptask.ru/c/7/board/783/9001");
  assert.equal(raw.status, "В процессе");
  assert.equal(raw.category, "Frontend");
  assert.ok(raw.descriptionText?.includes("Описание"));
  assert.deepEqual(raw.assignees, ["Иван"]);
  assert.equal(raw.comments[0]?.text.toLowerCase(), "готово");
  assert.equal(raw.sprintId, "4");
});

test("htmlToPlainText normalizes nbsp", () => {
  assert.equal(htmlToPlainText("<p>a&nbsp;b</p>"), "a b");
});
