import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../../src/tools/index.js";
import { MnemoClient, type Memory } from "../../../src/client/mnemo-client.js";
import { MnemoError } from "../../../src/errors/error-mapper.js";
import type { Config } from "../../../src/config/config.js";
import type { Logger } from "../../../src/utils/logger.js";

const mockConfig: Config = {
  apiUrl: "http://localhost:8080",
  apiKey: "test-key",
  agentId: "test-agent",
  logLevel: "error",
  timeoutMs: 5000,
  searchLimit: 10,
};

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    content: "Test memory content",
    memory_type: "insight",
    source: "mcp",
    tags: ["test"],
    metadata: null,
    agent_id: "test-agent",
    session_id: "",
    state: "active",
    version: 1,
    created_at: "2026-03-29T10:00:00Z",
    updated_at: "2026-03-29T10:00:00Z",
    ...overrides,
  };
}

async function createToolPair() {
  const server = new McpServer(
    { name: "test", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );
  const mnemoClient = new MnemoClient(mockConfig, mockLogger);
  registerTools(server, mnemoClient, mockLogger, {
    searchLimit: mockConfig.searchLimit,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mnemoClient, server };
}

describe("registerTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists all 5 tools with the expected input schema", async () => {
    const { client } = await createToolPair();

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual([
      "memory_store",
      "memory_search",
      "memory_get",
      "memory_update",
      "memory_delete",
    ]);

    const searchTool = result.tools.find((tool) => tool.name === "memory_search");
    expect(searchTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { default: 10, maximum: 50 },
        tags: { type: "array" },
      },
    });
  });

  it("memory_store calls the tool handler and redacts logged content", async () => {
    const { client, mnemoClient } = await createToolPair();
    const storeSpy = vi
      .spyOn(mnemoClient, "store")
      .mockResolvedValue({ status: "ok" });

    const content = "User salary is 99999 and should never be logged";
    const result = await client.callTool({
      name: "memory_store",
      arguments: {
        content,
        tags: ["sensitive"],
        metadata: { source: "test" },
        session_id: "session-1",
      },
    });

    expect(storeSpy).toHaveBeenCalledWith({
      content,
      tags: ["sensitive"],
      metadata: { source: "test" },
      session_id: "session-1",
    });
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ type: string; text: string }>)[0].text).toBe(
      "Memory stored successfully.",
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "memory_store",
      expect.objectContaining({
        contentRedacted: true,
        contentLength: content.length,
        tagsCount: 1,
        metadataKeyCount: 1,
        hasSessionId: true,
      }),
    );
    expect(mockLogger.debug).not.toHaveBeenCalledWith(
      "memory_store",
      expect.objectContaining({ content }),
    );
  });

  it("memory_search applies the default limit, formats results, and redacts the query", async () => {
    const { client, mnemoClient } = await createToolPair();
    const searchSpy = vi.spyOn(mnemoClient, "search").mockResolvedValue({
      memories: [
        makeMemory({
          id: "mem-001",
          content: "Deployment uses GitHub Actions",
          score: 0.91,
          relative_age: "2 days ago",
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });

    const query = "customer password reset workflow";
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query, tags: ["ops"] },
    });

    expect(searchSpy).toHaveBeenCalledWith({
      query,
      limit: 10,
      tags: ["ops"],
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Found 1 memory");
    expect(text).toContain("mem-001");
    expect(text).toContain("score: 0.91");
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "memory_search",
      expect.objectContaining({
        queryRedacted: true,
        queryLength: query.length,
        limit: 10,
        tagsCount: 1,
      }),
    );
    expect(mockLogger.debug).not.toHaveBeenCalledWith(
      "memory_search",
      expect.objectContaining({ query }),
    );
  });

  it("memory_get formats the memory detail result", async () => {
    const { client, mnemoClient } = await createToolPair();
    vi.spyOn(mnemoClient, "get").mockResolvedValue(
      makeMemory({
        id: "mem-002",
        content: "Detailed memory body",
        relative_age: "1 hour ago",
      }),
    );

    const result = await client.callTool({
      name: "memory_get",
      arguments: { id: "mem-002" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("ID: mem-002");
    expect(text).toContain("Content: Detailed memory body");
    expect(text).toContain("Age: 1 hour ago");
  });

  it("memory_update formats the updated memory detail result", async () => {
    const { client, mnemoClient } = await createToolPair();
    vi.spyOn(mnemoClient, "update").mockResolvedValue(
      makeMemory({
        id: "mem-003",
        content: "Updated memory",
        version: 2,
      }),
    );

    const result = await client.callTool({
      name: "memory_update",
      arguments: { id: "mem-003", content: "Updated memory" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Memory updated.");
    expect(text).toContain("ID: mem-003");
    expect(text).toContain("Version: 2");
  });

  it("memory_delete returns a success message", async () => {
    const { client, mnemoClient } = await createToolPair();
    const deleteSpy = vi.spyOn(mnemoClient, "delete").mockResolvedValue();

    const result = await client.callTool({
      name: "memory_delete",
      arguments: { id: "mem-004" },
    });

    expect(deleteSpy).toHaveBeenCalledWith("mem-004");
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ type: string; text: string }>)[0].text).toBe(
      "Memory deleted.",
    );
  });

  it("returns MCP error results from tool failures", async () => {
    const { client, mnemoClient } = await createToolPair();
    vi.spyOn(mnemoClient, "search").mockRejectedValue(
      new MnemoError("InvalidRequest", "Rate limited. Please retry shortly.", 429),
    );

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "rate limit me" },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ type: string; text: string }>)[0].text).toContain(
      "Error: Rate limited. Please retry shortly.",
    );
  });
});
