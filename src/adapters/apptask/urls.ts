export function parseBoardId(boardUrl: string): string | null {
  const match = boardUrl.match(/\/board\/(\d+)/);
  return match?.[1] ?? null;
}

export function parseTaskIdFromUrl(url: string): string | null {
  const match = url.match(/\/board\/\d+\/(\d+)/);
  return match?.[1] ?? null;
}

export function boardUrlPattern(boardId: string): RegExp {
  return new RegExp(`/board/${boardId}(?:/|$)`);
}

export function taskUrlPattern(boardId: string): RegExp {
  return new RegExp(`/board/${boardId}/\\d+`);
}
