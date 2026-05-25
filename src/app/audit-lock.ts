import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_FILE = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  "logs",
  "audit.pid",
);

let heldByThisProcess = false;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/**
 * Захват lock для audit (CLI / run-audit). Не использует bot.pid.
 * Discord bot дополнительно держит in-memory auditInProgress.
 */
export function tryAcquireAuditLock(): boolean {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
      return false;
    }
    fs.unlinkSync(LOCK_FILE);
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");
  heldByThisProcess = true;

  const release = () => {
    if (!heldByThisProcess) return;
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const current = fs.readFileSync(LOCK_FILE, "utf8").trim();
        if (current === String(process.pid)) fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      // ignore
    }
    heldByThisProcess = false;
  };

  process.once("exit", release);
  process.once("SIGINT", release);
  process.once("SIGTERM", release);

  return true;
}

export function releaseAuditLock(): void {
  if (!heldByThisProcess) return;
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const current = fs.readFileSync(LOCK_FILE, "utf8").trim();
      if (current === String(process.pid)) fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // ignore
  }
  heldByThisProcess = false;
}

export function getAuditLockPath(): string {
  return LOCK_FILE;
}

/** Проверка без захвата (Discord / CLI). */
export function isAuditLocked(): boolean {
  if (!fs.existsSync(LOCK_FILE)) return false;
  const pid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 && isProcessAlive(pid);
}
