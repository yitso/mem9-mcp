import type { LogLevel } from "../config/config.js";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Create a structured JSON logger that writes to stderr.
 * Stdout is reserved for MCP protocol messages.
 */
export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = LEVEL_PRIORITY[level];

  function log(
    lvl: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_PRIORITY[lvl] < threshold) return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...data,
    });
    process.stderr.write(entry + "\n");
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
