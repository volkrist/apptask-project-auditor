type LogLevel = "info" | "warn" | "error" | "debug";

function log(level: LogLevel, scope: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [apptask:${scope}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    info: (message: string) => log("info", scope, message),
    warn: (message: string) => log("warn", scope, message),
    error: (message: string) => log("error", scope, message),
    debug: (message: string) => log("debug", scope, message),
  };
}
