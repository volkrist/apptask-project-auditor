import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppTaskUser } from "../../src/users/app-task-users.js";
import {
  buildStatesMap,
  buildUsersMap,
  extractLinksFromHtml,
  formatIsoToRuDate,
  htmlToPlainText,
  mapApiTaskListItemToRawTask,
  mapTagList,
  mapUserListToAssignees,
  mergeTaskDetailsIntoRawTask,
  appTaskCommentsToRawComments,
} from "../../src/collectors/api-mapper.js";
import type { BoardState } from "../../src/collectors/app-task-api-client.js";
import type { AppTaskComment } from "../../src/comments/app-task-comments.js";

const states: BoardState[] = [
  { id: 150, name: "Новая задача" },
  { id: 151, name: "В процессе" },
];
const statesById = buildStatesMap(states);

const users: AppTaskUser[] = [
  {
    id: 7819,
    realName: "Иван Иванов",
    blocked: true,
    roleUser: "Developer",
  },
  { id: 9001, realName: "QA User", blocked: false, roleUser: "QA" },
];
const usersById = buildUsersMap(users);

test("task list item maps core fields", () => {
  const raw = mapApiTaskListItemToRawTask(
    {
      id: 5765,
      name: "Тестовая задача",
      priority: 2,
      stateId: 151,
      creatorId: 7819,
      plannedStartTime: "2023-03-16T20:00:00",
      plannedEndTime: "2023-03-20T18:00:00",
      userList: [{ userId: 9001 }],
      tagList: [{ tagId: 153, name: "bug" }],
    },
    {
      boardUrl: "https://apptask.ru/c/7/board/54",
      boardId: 54,
      blockId: 109,
      statesById,
      blocksById: new Map([[109, { id: 109, name: "Backend" }]]),
      usersById,
    },
  );
  assert.equal(raw.id, "5765");
  assert.equal(raw.title, "Тестовая задача");
  assert.equal(raw.status, "В процессе");
  assert.equal(raw.startDate, "16.03.2023");
  assert.equal(raw.dueDate, "20.03.2023");
  assert.equal(raw.priority, "2");
  assert.equal(raw.url, "https://apptask.ru/c/7/board/54/5765");
});

test("stateId maps to status name", () => {
  const raw = mapApiTaskListItemToRawTask(
    { id: 1, name: "x", stateId: 150 },
    {
      boardUrl: "https://apptask.ru/c/7/board/54",
      boardId: 54,
      blockId: 1,
      statesById,
      blocksById: new Map(),
      usersById,
    },
  );
  assert.equal(raw.status, "Новая задача");
});

test("userList maps assignees and assigneeRefs", () => {
  const { assignees, assigneeRefs } = mapUserListToAssignees(
    [{ userId: 9001 }, { userId: 7819, realName: "Fallback Name" }],
    usersById,
  );
  assert.deepEqual(assignees, ["QA User", "Fallback Name"]);
  assert.equal(assigneeRefs[0]?.userId, "9001");
  assert.equal(assigneeRefs[1]?.name, "Fallback Name");
});

test("creatorId resolves via users map", () => {
  const raw = mapApiTaskListItemToRawTask(
    { id: 2, name: "y", creatorId: 7819, stateId: 150 },
    {
      boardUrl: "https://apptask.ru/c/7/board/54",
      boardId: 54,
      blockId: 1,
      statesById,
      blocksById: new Map(),
      usersById,
    },
  );
  assert.equal(raw.creator, "Иван Иванов");
});

test("tagList maps to tags", () => {
  assert.deepEqual(mapTagList([{ tagId: 1, name: "urgent" }]), ["urgent"]);
  assert.deepEqual(mapTagList([{ tagId: 99 }]), ["tag:99"]);
});

test("HTML content to plain descriptionText", () => {
  const text = htmlToPlainText("<p>Hello<br/>world</p>");
  assert.match(text, /Hello/);
  assert.match(text, /world/);
});

test("HTML content extracts links", () => {
  const links = extractLinksFromHtml(
    '<a href="https://example.com/a">link</a> see https://foo.bar/x',
  );
  assert.ok(links.includes("https://example.com/a"));
  assert.ok(links.some((l) => l.startsWith("https://foo.bar")));
});

test("missing fields do not throw mapper", () => {
  const raw = mapApiTaskListItemToRawTask(
    { id: 3, name: "" },
    {
      boardUrl: "https://apptask.ru/c/7/board/54",
      boardId: 54,
      blockId: 1,
      statesById,
      blocksById: new Map(),
      usersById,
    },
  );
  assert.equal(raw.id, "3");
  assert.equal(raw.status, null);
  assert.equal(raw.dueDate, null);
});

test("blocked user kept in users map for rules", () => {
  const u = usersById.get("7819");
  assert.ok(u);
  assert.equal(u.blocked, true);
});

test("comments map text and content", () => {
  const comments: AppTaskComment[] = [
    {
      id: 10,
      creatorId: 7819,
      content: "<p>Question?</p>",
      createTime: "2024-01-01T00:00:00",
      parentId: null,
      attachmentList: [],
    },
  ];
  const mapped = appTaskCommentsToRawComments(comments);
  assert.equal(mapped[0]?.id, 10);
  assert.equal(mapped[0]?.creatorId, 7819);
  assert.match(mapped[0]?.text ?? "", /Question/);
  assert.match(mapped[0]?.content ?? "", /<p>/);
});

test("merge details fills description and links", () => {
  const base = mapApiTaskListItemToRawTask(
    { id: 5, name: "Task", stateId: 150 },
    {
      boardUrl: "https://apptask.ru/c/7/board/54",
      boardId: 54,
      blockId: 1,
      statesById,
      blocksById: new Map(),
      usersById,
    },
  );
  const merged = mergeTaskDetailsIntoRawTask(
    base,
    {
      id: 5,
      content: '<a href="https://docs.example.com">doc</a>',
      attachmentList: [{ name: "file.pdf", fileUrl: "https://cdn/x.pdf" }],
    },
    { statesById, blocksById: new Map(), usersById },
  );
  assert.match(merged.descriptionText ?? "", /doc/);
  assert.ok(merged.links.includes("https://docs.example.com"));
  assert.equal(merged.attachments[0]?.name, "file.pdf");
});

test("formatIsoToRuDate", () => {
  assert.equal(formatIsoToRuDate("2023-03-16T20:00:00"), "16.03.2023");
  assert.equal(formatIsoToRuDate(null), null);
});
