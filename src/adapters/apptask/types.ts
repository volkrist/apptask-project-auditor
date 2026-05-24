export type TaskAssigneeRef = {
  name: string;
  userId: string | null;
};

export type TaskComment = {
  /** Plain text for rules (often stripped from HTML content). */
  text: string;
  /** Raw API `content` when loaded via get_task_comments. */
  content?: string;
  id?: number | string;
  creatorId?: number | string | null;
  createTime?: string | null;
  parentId?: number | string | null;
};

/** Normalized card from DOM. Empty UI → null / []. */
export type RawTask = {
  id: string | null;
  url: string | null;
  title: string | null;
  descriptionText: string | null;
  createdAt: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: string | null;
  status: string | null;
  tags: string[];
  creator: string | null;
  assignees: string[];
  assigneeRefs: TaskAssigneeRef[];
  category: string | null;
  stage: string | null;
  plannedTime: string | null;
  actualTime: string | null;
  links: string[];
  attachments: Array<{ name: string; url: string | null }>;
  /** Board task comments when parser provides them; empty = skip. */
  comments: TaskComment[];
};

export function emptyRawTask(): RawTask {
  return {
    id: null,
    url: null,
    title: null,
    descriptionText: null,
    createdAt: null,
    startDate: null,
    dueDate: null,
    priority: null,
    status: null,
    tags: [],
    creator: null,
    assignees: [],
    assigneeRefs: [],
    category: null,
    stage: null,
    plannedTime: null,
    actualTime: null,
    links: [],
    attachments: [],
    comments: [],
  };
}
