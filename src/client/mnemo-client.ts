import type { Config } from "../config/config.js";
import type { Logger } from "../utils/logger.js";
import { mapHttpError, isRetryable, MnemoError } from "../errors/error-mapper.js";

/** Memory object returned by mnemo-server. */
export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  source: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  agent_id: string;
  session_id: string;
  state: string;
  version: number;
  created_at: string;
  updated_at: string;
  score?: number;
  relative_age?: string;
}

/** Response from POST /memories. */
export interface StoreResponse {
  status: string;
}

/** Response from GET /memories (search/list). */
export interface SearchResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

/** Options for storing a memory. */
export interface StoreOptions {
  content: string;
  tags?: string[];
  metadata?: Record<string, string>;
  session_id?: string;
}

/** Options for searching memories. */
export interface SearchOptions {
  query: string;
  limit?: number;
  tags?: string[];
}

/** Options for updating a memory. */
export interface UpdateOptions {
  content?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

const MAX_RETRIES = 2;

/**
 * HTTP client for mnemo-server v1alpha2 API.
 * Handles authentication, retry, and error mapping.
 */
export class MnemoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly agentId: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(config: Config, logger: Logger) {
    // Strip trailing slash from base URL.
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.timeoutMs = config.timeoutMs;
    this.logger = logger;
  }

  /** POST /memories — store a new memory. */
  async store(options: StoreOptions): Promise<StoreResponse> {
    const body: Record<string, unknown> = {
      content: options.content,
    };
    if (options.tags?.length) body.tags = options.tags;
    if (options.metadata) body.metadata = options.metadata;
    if (options.session_id) body.session_id = options.session_id;

    return this.request<StoreResponse>("POST", "/memories", { body });
  }

  /** GET /memories — search memories. */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: options.query });
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.tags?.length) {
      params.set("tags", options.tags.join(","));
    }

    return this.request<SearchResponse>("GET", `/memories?${params}`);
  }

  /** GET /memories/:id — get a single memory. */
  async get(id: string): Promise<Memory> {
    return this.request<Memory>("GET", `/memories/${encodeURIComponent(id)}`);
  }

  /** PUT /memories/:id — update a memory. */
  async update(id: string, options: UpdateOptions): Promise<Memory> {
    const body: Record<string, unknown> = {};
    if (options.content !== undefined) body.content = options.content;
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.metadata !== undefined) body.metadata = options.metadata;

    return this.request<Memory>(
      "PUT",
      `/memories/${encodeURIComponent(id)}`,
      { body },
    );
  }

  /** DELETE /memories/:id — delete a memory. */
  async delete(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/memories/${encodeURIComponent(id)}`,
      { expectEmpty: true },
    );
  }

  /** Make an HTTP request with retry and error mapping. */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: Record<string, unknown>;
      expectEmpty?: boolean;
    },
  ): Promise<T> {
    const url = `${this.baseUrl}/v1alpha2/mem9s${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "X-Mnemo-Agent-Id": this.agentId,
    };
    if (options?.body) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: MnemoError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = lastError?.retryAfterMs ?? 100 * Math.pow(2, attempt - 1);
        this.logger.debug("retrying request", {
          method,
          path,
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const error = mapHttpError(response.status, await responseText(response));
          if (isRetryable(response.status) && attempt < MAX_RETRIES) {
            // Use Retry-After header for 429.
            if (response.status === 429) {
              const retryAfter = response.headers.get("Retry-After");
              if (retryAfter) {
                error.retryAfterMs = parseInt(retryAfter, 10) * 1000;
              }
            }
            lastError = error;
            continue;
          }
          throw error;
        }

        if (options?.expectEmpty) {
          return undefined as T;
        }
        return (await response.json()) as T;
      } catch (err) {
        if (err instanceof MnemoError) {
          throw err;
        }
        // Network / timeout errors.
        const networkError = mapHttpError(0, String(err));
        if (attempt < MAX_RETRIES) {
          lastError = networkError;
          continue;
        }
        throw networkError;
      }
    }

    // Should not reach here, but just in case.
    throw lastError ?? mapHttpError(0, "request failed after retries");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
