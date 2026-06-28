/** Row shapes from AppTask SQL Server (read-only SELECT). */

export type DbBoardRow = {
  id: number;
  name: string | null;
};

export type DbTaskRow = {
  id: number;
  offset_id: number | null;
  board_id: number;
  task_name: string | null;
  content: string | null;
  block_id: number | null;
  block_name: string | null;
  state_id: number | null;
  status_name: string | null;
  priority: number | null;
  planned_start_time: Date | string | null;
  planned_end_time: Date | string | null;
  planned_end_time_offset: number | null;
  current_end_time_offset: number | null;
  end_time: Date | string | null;
  update_time: Date | string | null;
  create_time: Date | string | null;
  real_sprint_id: number | null;
  sprint_id: number | null;
  creator_id: number | null;
};

export type DbAssigneeRow = {
  board_id: number;
  task_id: number;
  task_name: string | null;
  user_id: number;
  real_name: string | null;
  email: string | null;
  blocked: boolean | number | null;
  removed: boolean | number | null;
};

export type DbUserRow = {
  id: number;
  real_name: string | null;
  email: string | null;
  blocked: boolean | number | null;
  removed: boolean | number | null;
};

export type DbTagRow = {
  board_id: number;
  task_id: number;
  task_name: string | null;
  tag_id: number;
  tag_name: string | null;
};

export type DbCommentRow = {
  id: number;
  board_id: number;
  task_id: number;
  task_name: string | null;
  content: string | null;
  create_time: Date | string | null;
  creator_id: number | null;
  creator_name: string | null;
  parent_id: number | null;
};

export type DbHistoryRow = {
  id: number;
  board_id: number;
  task_id: number;
  task_name: string | null;
  user_id: number | null;
  real_name: string | null;
  action_type: number | string | null;
  date: Date | string | null;
  data: string | null;
};

export type DbCountRow = { cnt: number };
export type DbGroupCountRow = { label: string | null; cnt: number };

export type DbBoardStateRow = {
  id: number;
  board_id: number;
  name: string | null;
};
