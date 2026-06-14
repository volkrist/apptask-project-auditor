import type { DbBoardStateRow } from "./db-types.js";

export type StateNameByKey = Record<string, string>;

export function buildStateNameByKey(states: DbBoardStateRow[]): StateNameByKey {
  const map: StateNameByKey = {};
  for (const s of states) {
    const name = s.name?.trim();
    if (!name) continue;
    map[`${s.board_id}:${s.id}`] = name;
  }
  return map;
}

export type StateNameResolver = (
  boardId: string | null | undefined,
  stateId: string | number,
) => string | null;

export function makeStateNameResolver(
  stateNameByKey?: StateNameByKey,
): StateNameResolver | undefined {
  if (!stateNameByKey || Object.keys(stateNameByKey).length === 0) {
    return undefined;
  }
  return (boardId, stateId) => {
    const key = `${boardId ?? "?"}:${stateId}`;
    return stateNameByKey[key] ?? null;
  };
}

export function resolveStateLabel(
  value: unknown,
  boardId: string | null | undefined,
  resolve?: StateNameResolver,
): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (resolve && /^\d+$/.test(raw)) {
    return resolve(boardId, raw) ?? raw;
  }
  return raw;
}
