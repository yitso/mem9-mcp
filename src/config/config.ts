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

  const timeoutMs = parseInt(process.env.MEM9_TIMEOUT_MS || "10000", 10);
  const searchLimit = parseInt(process.env.MEM9_SEARCH_LIMIT || "10", 10);

  return {
    apiUrl: process.env.MEM9_API_URL || "https://api.mem9.ai",
    apiKey,
    agentId: process.env.MEM9_AGENT_ID || detectAgentId(),
    logLevel: parseLogLevel(process.env.MEM9_LOG_LEVEL),
    timeoutMs: Number.isNaN(timeoutMs) ? 10000 : timeoutMs,
    searchLimit: Number.isNaN(searchLimit) ? 10 : searchLimit,
  };
}
