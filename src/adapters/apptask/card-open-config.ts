export type CardOpenStrategy = "auto" | "url-first" | "click-first";

export type CardOpenTimeouts = {
  directUiMs: number;
  clickUiMs: number;
  totalMs: number;
  gotoMs: number;
};

const SHORT_TASK_ID_MAX_LEN = 3;

export function loadCardOpenStrategy(): CardOpenStrategy {
  const raw = process.env.CARD_OPEN_STRATEGY?.trim().toLowerCase();
  if (raw === "url-first" || raw === "click-first") return raw;
  return "auto";
}

export function loadCardOpenTimeouts(): CardOpenTimeouts {
  return {
    directUiMs: 15_000,
    clickUiMs: 15_000,
    totalMs: 45_000,
    gotoMs: 25_000,
  };
}

/** Порядок попыток открытия карточки. */
export function resolveOpenAttempts(
  strategy: CardOpenStrategy,
  taskId: string | null,
): Array<"direct" | "click"> {
  if (strategy === "click-first") return ["click", "direct"];
  if (strategy === "url-first") return ["direct", "click"];
  if (taskId && taskId.length > 0 && taskId.length <= SHORT_TASK_ID_MAX_LEN) {
    return ["click", "direct"];
  }
  return ["direct", "click"];
}

export function isShortTaskId(taskId: string | null): boolean {
  return Boolean(taskId && taskId.length > 0 && taskId.length <= SHORT_TASK_ID_MAX_LEN);
}
