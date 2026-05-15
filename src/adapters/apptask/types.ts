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
  category: string | null;
  stage: string | null;
  plannedTime: string | null;
  actualTime: string | null;
  links: string[];
  attachments: Array<{ name: string; url: string | null }>;
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
    category: null,
    stage: null,
    plannedTime: null,
    actualTime: null,
    links: [],
    attachments: [],
  };
}
