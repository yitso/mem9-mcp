import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MnemoClient } from "../client/mnemo-client.js";
import type { Logger } from "../utils/logger.js";
import { MnemoError } from "../errors/error-mapper.js";
import { formatSearchResults, formatMemoryDetail } from "../utils/formatter.js";

/** Register all 5 memory tools on the MCP server. */
export function registerTools(
  server: McpServer,
  client: MnemoClient,
  logger: Logger,
  options: { searchLimit: number },
): void {
  const { searchLimit } = options;

  // memory_store
  server.registerTool(
    "memory_store",
    {
      description:
        "Store a new memory. The content will be processed synchronously by the memory service (fact extraction and reconciliation) before the call returns, so it can be searched immediately afterward. It is not stored verbatim. Use this when you learn something worth remembering: user preferences, project conventions, important decisions, recurring patterns, or any context that would be useful in future sessions. Do NOT store trivial or transient information like current file paths, temporary debug notes, or information that only matters in the current session. Note: the response does not include the stored memory's ID. If you need to update or delete a memory you just stored, use memory_search to find it first.",
      inputSchema: {
        content: z.string().describe(
          "The memory content to store. Be specific and self-contained — this should make sense when retrieved later without additional context.",
        ),
        tags: z.array(z.string()).optional().describe(
          "Optional tags for categorization (e.g., ['coding-style', 'python', 'user-preference']).",
        ),
        metadata: z.record(z.string()).optional().describe(
          "Optional key-value metadata (e.g., { 'project': 'web-app', 'source': 'code-review' }).",
        ),
        session_id: z.string().optional().describe(
          "Optional session identifier to associate this memory with a specific conversation or workflow.",
        ),
      },
    },
    async ({ content, tags, metadata, session_id }) => {
      const normalizedSessionId = session_id === "" ? undefined : session_id;

      logger.debug("memory_store", {
        contentRedacted: true,
        contentLength: content.length,
        tagsCount: tags?.length ?? 0,
        metadataKeyCount: metadata ? Object.keys(metadata).length : 0,
        hasSessionId: normalizedSessionId !== undefined,
      });
      try {
        await client.store({ content, tags, metadata, session_id: normalizedSessionId });
        return { content: [{ type: "text" as const, text: "Memory stored successfully." }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // memory_search
  server.registerTool(
    "memory_search",
    {
      description:
        "Search your memory for relevant information. Use this at the start of a task to recall relevant context, when you need to check if something was previously discussed, or when the user references past work. Supports both semantic (meaning-based) and keyword search.",
      inputSchema: {
        query: z.string().describe(
          "Natural language search query. Describe what you're looking for — the system handles both semantic and keyword matching.",
        ),
        limit: z.number().int().positive().max(50).optional().default(searchLimit).describe(
          `Maximum number of results to return (default: ${searchLimit}, max: 50).`,
        ),
        tags: z.array(z.string()).optional().describe(
          "Optional: filter results to only memories with these tags.",
        ),
      },
    },
    async ({ query, limit, tags }) => {
      logger.debug("memory_search", {
        queryRedacted: true,
        queryLength: query.length,
        limit,
        tagsCount: tags?.length ?? 0,
      });
      try {
        const result = await client.search({ query, limit, tags });
        const text = formatSearchResults(result.memories, result.total);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // memory_get
  server.registerTool(
    "memory_get",
    {
      description:
        "Retrieve a specific memory by its ID. Use this when you have a memory ID from a previous search and need the full content.",
      inputSchema: {
        id: z.string().describe("The memory ID (UUID format)."),
      },
    },
    async ({ id }) => {
      logger.debug("memory_get", { id });
      try {
        const mem = await client.get(id);
        const text = formatMemoryDetail(mem);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // memory_update
  server.registerTool(
    "memory_update",
    {
      description:
        "Update an existing memory. Use this when information has changed, needs correction, or should be enriched with additional context. Provide the memory ID and at least one field to update. This is a direct field update — content is NOT re-processed through reconciliation.",
      inputSchema: {
        id: z.string().describe("The memory ID to update."),
        content: z.string().optional().describe(
          "The updated memory content (replaces the existing content). Omit to keep current content.",
        ),
        tags: z.array(z.string()).optional().describe(
          "Updated tags (replaces the entire tag list). Omit to keep current tags.",
        ),
        metadata: z.record(z.string()).optional().describe(
          "Updated metadata (replaces existing metadata). Omit to keep current metadata.",
        ),
      },
    },
    async ({ id, content, tags, metadata }) => {
      logger.debug("memory_update", { id });
      try {
        const mem = await client.update(id, { content, tags, metadata });
        const text = formatMemoryDetail(mem);
        return { content: [{ type: "text" as const, text: `Memory updated.\n\n${text}` }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // memory_delete
  server.registerTool(
    "memory_delete",
    {
      description:
        "Delete a memory that is no longer relevant or accurate. Use this to clean up outdated information. This action is irreversible.",
      inputSchema: {
        id: z.string().describe("The memory ID to delete."),
      },
    },
    async ({ id }) => {
      logger.debug("memory_delete", { id });
      try {
        await client.delete(id);
        return { content: [{ type: "text" as const, text: "Memory deleted." }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

/** Convert an error to an MCP tool error result. */
function toolError(err: unknown) {
  const message =
    err instanceof MnemoError
      ? err.message
      : `Unexpected error: ${String(err)}`;
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
