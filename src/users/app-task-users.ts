import type { BrowserContext, Page, Response } from "@playwright/test";
import type { RawTask } from "../adapters/apptask/types.js";

const GET_USERS_RE = /\/panel\/profile\/get_users/i;

export type AppTaskUser = {
  id: number | string;
  realName: string;
  email?: string | null;
  blocked: boolean;
  roleUser?: string | null;
  role?: string | null;
};

export type BlockedAssigneeMatch = {
  assigneeName: string;
  userId: string | null;
  matchBy: "userId" | "name";
  user: AppTaskUser;
};

type GetUsersPayload = {
  result?: number;
  data?: unknown[];
};

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** blocked из API (boolean) или БД (0/1/bit). */
export function isUserBlocked(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function mapDbUserRow(row: {
  id: number;
  real_name: string | null;
  email?: string | null;
  blocked?: unknown;
}): AppTaskUser | null {
  const realName = row.real_name?.trim();
  if (!realName) return null;
  return {
    id: row.id,
    realName,
    email: row.email ?? null,
    blocked: isUserBlocked(row.blocked),
  };
}

function mapApiUser(raw: unknown): AppTaskUser | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = row.id;
  const realName = typeof row.realName === "string" ? row.realName.trim() : "";
  if (id === undefined || id === null || !realName) return null;
  const roleUser =
    typeof row.roleUser === "string"
      ? row.roleUser.trim()
      : typeof row.role === "string"
        ? row.role.trim()
        : null;
  return {
    id: typeof id === "number" ? id : String(id),
    realName,
    email: typeof row.email === "string" ? row.email : null,
    blocked: isUserBlocked(row.blocked),
    roleUser: roleUser || null,
    role: typeof row.role === "string" ? row.role.trim() : null,
  };
}

function parseGetUsersBody(json: unknown): AppTaskUser[] {
  const payload = json as GetUsersPayload;
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map(mapApiUser).filter((u): u is AppTaskUser => u !== null);
}

async function waitForGetUsersResponse(
  page: Page,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await page.waitForResponse(
      (r) =>
        GET_USERS_RE.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: timeoutMs },
    );
  } catch {
    return null;
  }
}

/**
 * Loads company users via POST /panel/profile/get_users (session cookies from page).
 */
export async function loadAppTaskUsers(
  pageOrContext: Page | BrowserContext,
  usersUrl?: string,
): Promise<AppTaskUser[]> {
  const page =
    "goto" in pageOrContext
      ? pageOrContext
      : pageOrContext.pages()[0] ?? (await pageOrContext.newPage());

  const url =
    usersUrl?.trim() ??
    process.env.APPTASK_USERS_URL?.trim() ??
    "https://apptask.ru/c/7/settings/users";

  const responsePromise = waitForGetUsersResponse(page, 60_000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});

  let response = await responsePromise;
  if (!response) {
    response = await waitForGetUsersResponse(page, 15_000);
  }
  if (!response) return [];

  try {
    const json = await response.json();
    return parseGetUsersBody(json);
  } catch {
    return [];
  }
}

export function indexAppTaskUsers(users: AppTaskUser[]): {
  byId: Map<string, AppTaskUser>;
  byName: Map<string, AppTaskUser>;
  all: AppTaskUser[];
} {
  const byId = new Map<string, AppTaskUser>();
  const byName = new Map<string, AppTaskUser>();
  for (const user of users) {
    byId.set(String(user.id), user);
    byName.set(normalizeName(user.realName), user);
  }
  return { byId, byName, all: users };
}

/**
 * Finds assignees that match a blocked user in AppTask users API.
 * Does not return assignees missing from the users list.
 */
export function findBlockedAssignees(
  task: RawTask,
  users: AppTaskUser[],
): BlockedAssigneeMatch[] {
  if (users.length === 0) return [];

  const { byId, byName } = indexAppTaskUsers(users);
  const refs =
    task.assigneeRefs.length > 0
      ? task.assigneeRefs
      : task.assignees.map((name) => ({ name, userId: null as string | null }));

  const matches: BlockedAssigneeMatch[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const name = ref.name?.trim();
    if (!name || name.includes("Добавить")) continue;

    let user: AppTaskUser | undefined;
    let matchBy: "userId" | "name" | null = null;

    if (ref.userId) {
      user = byId.get(String(ref.userId));
      if (user) matchBy = "userId";
    }
    if (!user) {
      user = byName.get(normalizeName(name));
      if (user) matchBy = "name";
    }
    if (!user || !user.blocked || !matchBy) continue;

    const key = `${matchBy}:${user.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({
      assigneeName: name,
      userId: ref.userId ?? String(user.id),
      matchBy,
      user,
    });
  }

  return matches;
}

export function findAssigneesMissingFromUsers(
  task: RawTask,
  users: AppTaskUser[],
): Array<{ name: string; userId: string | null }> {
  if (users.length === 0) return [];

  const { byId, byName } = indexAppTaskUsers(users);
  const refs =
    task.assigneeRefs.length > 0
      ? task.assigneeRefs
      : task.assignees.map((name) => ({ name, userId: null as string | null }));

  const missing: Array<{ name: string; userId: string | null }> = [];

  for (const ref of refs) {
    const name = ref.name?.trim();
    if (!name || name.includes("Добавить")) continue;
    if (ref.userId && byId.has(String(ref.userId))) continue;
    if (byName.has(normalizeName(name))) continue;
    missing.push({ name, userId: ref.userId });
  }

  return missing;
}
