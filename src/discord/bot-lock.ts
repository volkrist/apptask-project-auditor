import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_FILE = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  "logs",
  "bot.pid",
);

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function releaseLock(): void {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;
    const current = fs.readFileSync(LOCK_FILE, "utf8").trim();
    if (current === String(process.pid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // ignore
  }
}

/** Exit if another bot instance is already running (prevents 10062 / 40060). */
export function acquireBotInstanceLock(): void {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
      console.error(
        `[bot] Already running (PID ${pid}). Use only one of: start-bot.bat, Startup shortcut. Do not run npm run discord:bot in Cursor while the bot is up.`,
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");

  process.once("exit", releaseLock);
  process.once("SIGINT", () => {
    releaseLock();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    releaseLock();
    process.exit(0);
  });
}
