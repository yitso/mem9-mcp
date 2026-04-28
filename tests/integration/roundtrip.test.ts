import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MnemoClient } from "../../src/client/mnemo-client.js";
import { registerTools } from "../../src/tools/index.js";
import type { Config } from "../../src/config/config.js";
import type { Logger } from "../../src/utils/logger.js";

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

/**
 * Helper: create a linked MCP client+server pair using in-memory transport.
 * Returns the MCP client (for calling tools) and the MnemoClient (for mocking).
 */
async function createTestPair() {
  const mcpServer = new McpServer(
    { name: "test-server", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  const mnemoClient = new MnemoClient(mockConfig, mockLogger);
  registerTools(mcpServer, mnemoClient, mockLogger, {
    searchLimit: mockConfig.searchLimit,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mnemoClient, mcpServer };
}

describe("Integration: Full CRUD roundtrip", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists all 5 tools", async () => {
    const { client } = await createTestPair();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual([
      "memory_store",
      "memory_search",
      "memory_get",
      "memory_update",
      "memory_delete",
    ]);
  });

  it("store → search → get → update → delete", async () => {
    const { client } = await createTestPair();

    // Mock fetch for all sequential API calls.
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      callIndex++;
      const method = init.method ?? "GET";

      // 1. store (POST)
      if (callIndex === 1 && method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "ok" }),
          headers: new Headers(),
        });
      }

      // 2. search (GET with ?q=)
      if (callIndex === 2 && method === "GET" && (url as string).includes("?q=")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              memories: [
                {
                  id: "mem-001",
                  content: "User prefers dark mode",
                  memory_type: "insight",
                  source: "mcp",
                  tags: ["preference"],
                  metadata: null,
                  agent_id: "test-agent",
                  session_id: "",
                  state: "active",
                  version: 1,
                  created_at: "2026-03-29T10:00:00Z",
                  updated_at: "2026-03-29T10:00:00Z",
                  score: 0.95,
                  relative_age: "1 day ago",
                },
              ],
              total: 1,
              limit: 10,
              offset: 0,
            }),
          headers: new Headers(),
        });
      }

      // 3. get (GET /memories/:id)
      if (callIndex === 3 && method === "GET") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: "mem-001",
              content: "User prefers dark mode",
              memory_type: "insight",
              source: "mcp",
              tags: ["preference"],
              metadata: null,
              agent_id: "test-agent",
              session_id: "",
              state: "active",
              version: 1,
              created_at: "2026-03-29T10:00:00Z",
              updated_at: "2026-03-29T10:00:00Z",
            }),
          headers: new Headers(),
        });
      }

      // 4. update (PUT)
      if (callIndex === 4 && method === "PUT") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: "mem-001",
              content: "User prefers light mode",
              memory_type: "insight",
              source: "mcp",
              tags: ["preference", "updated"],
              metadata: null,
              agent_id: "test-agent",
              session_id: "",
              state: "active",
              version: 2,
              created_at: "2026-03-29T10:00:00Z",
              updated_at: "2026-03-29T11:00:00Z",
            }),
          headers: new Headers(),
        });
      }

      // 5. delete (DELETE)
      if (callIndex === 5 && method === "DELETE") {
        return Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers(),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("unexpected call"),
        headers: new Headers(),
      });
    });

    // Step 1: Store
    const storeResult = await client.callTool({
      name: "memory_store",
      arguments: { content: "User prefers dark mode", tags: ["preference"] },
    });
    expect(storeResult.isError).toBeFalsy();
    const storeBody = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .body as string,
    );
    expect(storeBody.sync).toBe(true);
    const storeText = (storeResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(storeText).toContain("stored successfully");

    // Step 2: Search
    const searchResult = await client.callTool({
      name: "memory_search",
      arguments: { query: "user preference" },
    });
    expect(searchResult.isError).toBeFalsy();
    const searchText = (searchResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(searchText).toContain("Found 1 memory");
    expect(searchText).toContain("mem-001");
    expect(searchText).toContain("dark mode");
    expect(searchText).toContain("score: 0.95");
    expect(searchText).toContain("1 day ago");

    // Step 3: Get
    const getResult = await client.callTool({
      name: "memory_get",
      arguments: { id: "mem-001" },
    });
    expect(getResult.isError).toBeFalsy();
    const getText = (getResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(getText).toContain("mem-001");
    expect(getText).toContain("dark mode");

    // Step 4: Update
    const updateResult = await client.callTool({
      name: "memory_update",
      arguments: {
        id: "mem-001",
        content: "User prefers light mode",
        tags: ["preference", "updated"],
      },
    });
    expect(updateResult.isError).toBeFalsy();
    const updateText = (updateResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(updateText).toContain("updated");
    expect(updateText).toContain("light mode");

    // Step 5: Delete
    const deleteResult = await client.callTool({
      name: "memory_delete",
      arguments: { id: "mem-001" },
    });
    expect(deleteResult.isError).toBeFalsy();
    const deleteText = (deleteResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(deleteText).toContain("deleted");

    expect(callIndex).toBe(5);
  });
});

describe("Integration: Error scenarios", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns error for 401 Unauthorized", async () => {
    const { client } = await createTestPair();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
      headers: new Headers(),
    });

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Authentication failed");
    expect(text).toContain("MEM9_API_KEY");
  });

  it("returns error for 404 Not Found", async () => {
    const { client } = await createTestPair();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
      headers: new Headers(),
    });

    const result = await client.callTool({
      name: "memory_get",
      arguments: { id: "nonexistent" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("not found");
  });

  it("retries 429 and succeeds", async () => {
    const { client } = await createTestPair();
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          headers: new Headers({ "Retry-After": "0" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            memories: [],
            total: 0,
            limit: 10,
            offset: 0,
          }),
        headers: new Headers(),
      });
    });

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test" },
    });
    expect(result.isError).toBeFalsy();
    expect(callCount).toBe(2);
  });

  it("returns error for network failure after retries", async () => {
    const { client } = await createTestPair();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Cannot reach");
  });

  it("returns timeout error instead of connectivity error for slow backends", async () => {
    const { client } = await createTestPair();
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("timed out");
    expect(text).not.toContain("Cannot reach");
  });

  it("returns invalid response error for malformed JSON instead of connectivity error", async () => {
    const { client } = await createTestPair();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      headers: new Headers(),
    });

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("invalid response");
    expect(text).not.toContain("Cannot reach");
  });
});

describe("Integration: Concurrent tool calls", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("handles parallel searches without cross-talk", async () => {
    const { client } = await createTestPair();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const query = new URL(url).searchParams.get("q");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            memories: [
              {
                id: `mem-${query}`,
                content: `Memory for ${query}`,
                memory_type: "insight",
                source: "mcp",
                tags: ["parallel"],
                metadata: null,
                agent_id: "test-agent",
                session_id: "",
                state: "active",
                version: 1,
                created_at: "2026-03-29T10:00:00Z",
                updated_at: "2026-03-29T10:00:00Z",
                score: 0.95,
              },
            ],
            total: 1,
            limit: 10,
            offset: 0,
          }),
        headers: new Headers(),
      });
    });

    const [alphaResult, betaResult] = await Promise.all([
      client.callTool({ name: "memory_search", arguments: { query: "alpha" } }),
      client.callTool({ name: "memory_search", arguments: { query: "beta" } }),
    ]);

    expect(alphaResult.isError).toBeFalsy();
    expect(betaResult.isError).toBeFalsy();
    expect((alphaResult.content as Array<{ type: string; text: string }>)[0].text).toContain(
      "Memory for alpha",
    );
    expect((betaResult.content as Array<{ type: string; text: string }>)[0].text).toContain(
      "Memory for beta",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("Integration: Truncation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("truncates large search results", async () => {
    const { client } = await createTestPair();

    // Return 20 memories with long content.
    const memories = Array.from({ length: 20 }, (_, i) => ({
      id: `mem-${String(i).padStart(3, "0")}`,
      content: "X".repeat(500),
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
      score: 0.9 - i * 0.01,
    }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          memories,
          total: 20,
          limit: 20,
          offset: 0,
        }),
      headers: new Headers(),
    });

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "test", limit: 20 },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("more results omitted");
    expect(text.length).toBeLessThan(9000);
  });
});
