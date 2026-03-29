/** MCP-aligned error codes. */
export type McpErrorCode = "InvalidParams" | "InvalidRequest" | "InternalError";

/** Error thrown by the mnemo client, carrying MCP error code and user message. */
export class MnemoError extends Error {
  override readonly name = "MnemoError";
  readonly mcpCode: McpErrorCode;
  readonly httpStatus: number;
  /** Delay (ms) before retrying, set from Retry-After header on 429. */
  retryAfterMs?: number;

  constructor(mcpCode: McpErrorCode, message: string, httpStatus: number) {
    super(message);
    this.mcpCode = mcpCode;
    this.httpStatus = httpStatus;
  }
}

/** Map an HTTP status code to a MnemoError with user-facing message. */
export function mapHttpError(status: number, detail: string): MnemoError {
  switch (status) {
    case 400:
      return new MnemoError("InvalidParams", `Invalid request: ${detail}`, 400);
    case 401:
      return new MnemoError(
        "InvalidRequest",
        "Authentication failed. Check MEM9_API_KEY.",
        401,
      );
    case 404:
      return new MnemoError("InvalidParams", `Memory not found.`, 404);
    case 409:
      return new MnemoError(
        "InvalidRequest",
        "Version conflict. Memory was modified by another agent. Fetch latest and retry.",
        409,
      );
    case 429:
      return new MnemoError(
        "InvalidRequest",
        "Rate limited. Please retry shortly.",
        429,
      );
    case 500:
      return new MnemoError(
        "InternalError",
        "Memory service error. Please try again.",
        500,
      );
    case 0:
      return new MnemoError(
        "InternalError",
        `Cannot reach memory service. Is mnemo-server running? (${detail})`,
        0,
      );
    default:
      if (status >= 500) {
        return new MnemoError(
          "InternalError",
          `Memory service error (${status}).`,
          status,
        );
      }
      return new MnemoError(
        "InvalidRequest",
        `Request failed (${status}): ${detail}`,
        status,
      );
  }
}

/** Whether the given HTTP status code should be retried. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}
