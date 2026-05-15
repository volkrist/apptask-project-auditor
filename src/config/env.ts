import path from "node:path";

export type Env = {
  boardUrl: string;
  authStatePath: string;
  projectName: string;
  discordWebhookUrl: string | null;
};

export function loadEnv(): Env {
  return {
    boardUrl:
      process.env.APPTASK_BOARD_URL ??
      "https://apptask.ru/c/7/board/445",
    authStatePath:
      process.env.APPTASK_AUTH_STATE ??
      path.join("playwright", ".auth", "user.json"),
    projectName: process.env.APPTASK_PROJECT_NAME ?? "AppTask Project",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? null,
  };
}
