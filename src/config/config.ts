export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  /** mnemo-server base URL */
  apiUrl: string;
  /** API key (also serves as tenant ID in v1alpha2) */
  apiKey: string;
  /** Agent identifier sent as X-Mnemo-Agent-Id header */
  agentId: string;
  /** Logging level */
  logLevel: LogLevel;
  /** HTTP request timeout in milliseconds */
  timeoutMs: number;
  /** Default search result limit */
  searchLimit: number;
}

const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

function parseLogLevel(value: string | undefined): LogLevel {
  if (value && LOG_LEVELS.includes(value)) {
    return value as LogLevel;
  }
  return "info";
}

/**
 * Detect the calling agent platform from environment variables.
 * Order: explicit MEM9_AGENT_ID > platform env vars > fallback.
 */
export function detectAgentId(): string {
  if (process.env.CURSOR_WORKSPACE) return "cursor";
  if (process.env.CLAUDE_CODE_VERSION) return "claude-code";
  if (process.env.CODEX_CLI_VERSION) return "codex";
  return "mcp-unknown";
}

/**
 * Load and validate configuration from environment variables.
 * Throws if required variables are missing.
 */
export function loadConfig(): Config {
  const apiKey = process.env.MEM9_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MEM9_API_KEY is required. Set it in your MCP server configuration.",
    );
  }

  const timeoutMs = parsePositiveIntEnv(
    "MEM9_TIMEOUT_MS",
    process.env.MEM9_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const searchLimit = parsePositiveIntEnv(
    "MEM9_SEARCH_LIMIT",
    process.env.MEM9_SEARCH_LIMIT,
    DEFAULT_SEARCH_LIMIT,
    { max: MAX_SEARCH_LIMIT },
  );

  return {
    apiUrl: process.env.MEM9_API_URL || "https://api.mem9.ai",
    apiKey,
    agentId: process.env.MEM9_AGENT_ID || detectAgentId(),
    logLevel: parseLogLevel(process.env.MEM9_LOG_LEVEL),
    timeoutMs,
    searchLimit,
  };
}

function parsePositiveIntEnv(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  options?: { max?: number },
): number {
  if (rawValue === undefined) {
    return fallback;
  }

  const trimmedValue = rawValue.trim();
  if (!/^[1-9]\d*$/.test(trimmedValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number.parseInt(trimmedValue, 10);
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  if (options?.max !== undefined && parsed > options.max) {
    throw new Error(`${name} must be less than or equal to ${options.max}.`);
  }

  return parsed;
}
