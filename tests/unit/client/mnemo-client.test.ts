import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MnemoClient } from "../../../src/client/mnemo-client.js";
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

function mockFetch(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(headers),
  } as unknown as Response);
}

describe("MnemoClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("store", () => {
    it("sends POST with sync:true and correct headers", async () => {
      const fetchMock = mockFetch(200, { status: "ok" });
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      const result = await client.store({ content: "hello world" });

      expect(result.status).toBe("ok");
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:8080/v1alpha2/mem9s/memories");
      expect(init.method).toBe("POST");
      expect(init.headers["X-API-Key"]).toBe("test-key");
      expect(init.headers["X-Mnemo-Agent-Id"]).toBe("test-agent");

      const body = JSON.parse(init.body as string);
      expect(body.content).toBe("hello world");
      expect(body.sync).toBe(true);
    });

    it("includes optional fields when provided", async () => {
      globalThis.fetch = mockFetch(200, { status: "ok" });
      const client = new MnemoClient(mockConfig, mockLogger);
      await client.store({
        content: "test",
        tags: ["a", "b"],
        metadata: { key: "val" },
        session_id: "sess-1",
      });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
          .body as string,
      );
      expect(body.tags).toEqual(["a", "b"]);
      expect(body.metadata).toEqual({ key: "val" });
      expect(body.session_id).toBe("sess-1");
    });
  });

  describe("search", () => {
    it("sends GET with query params", async () => {
      const fetchMock = mockFetch(200, {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      const result = await client.search({ query: "test query", limit: 5 });

      expect(result.memories).toEqual([]);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("q=test+query");
      expect(url).toContain("limit=5");
    });

    it("includes tags filter", async () => {
      const fetchMock = mockFetch(200, {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      await client.search({ query: "test", tags: ["a", "b"] });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("tags=a%2Cb");
    });
  });

  describe("get", () => {
    it("sends GET to /memories/:id", async () => {
      const mem = { id: "abc", content: "hello" };
      const fetchMock = mockFetch(200, mem);
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      const result = await client.get("abc");

      expect(result.id).toBe("abc");
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/memories/abc");
    });
  });

  describe("update", () => {
    it("sends PUT with partial fields", async () => {
      const fetchMock = mockFetch(200, { id: "abc", content: "updated" });
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      await client.update("abc", { content: "updated" });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/memories/abc");
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string);
      expect(body.content).toBe("updated");
      expect(body.tags).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("sends DELETE and returns void", async () => {
      const fetchMock = mockFetch(204);
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      await client.delete("abc");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/memories/abc");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("error handling", () => {
    it("throws MnemoError for 401", async () => {
      globalThis.fetch = mockFetch(401);
      const client = new MnemoClient(mockConfig, mockLogger);

      await expect(client.get("abc")).rejects.toThrow(MnemoError);
      await expect(client.get("abc")).rejects.toMatchObject({
        mcpCode: "InvalidRequest",
      });
    });

    it("throws MnemoError for 404", async () => {
      globalThis.fetch = mockFetch(404);
      const client = new MnemoClient(mockConfig, mockLogger);

      await expect(client.get("abc")).rejects.toThrow(MnemoError);
      await expect(client.get("abc")).rejects.toMatchObject({
        mcpCode: "InvalidParams",
      });
    });
  });

  describe("retry", () => {
    it("retries on 502 and succeeds", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 502,
            text: () => Promise.resolve("bad gateway"),
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "abc", content: "ok" }),
          headers: new Headers(),
        });
      });

      const client = new MnemoClient(mockConfig, mockLogger);
      const result = await client.get("abc");
      expect(result.id).toBe("abc");
      expect(callCount).toBe(2);
    });

    it("retries on 429 with Retry-After header", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve("rate limited"),
            headers: new Headers({ "Retry-After": "1" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "abc" }),
          headers: new Headers(),
        });
      });

      const client = new MnemoClient(mockConfig, mockLogger);
      const result = await client.get("abc");
      expect(result.id).toBe("abc");
      expect(callCount).toBe(2);
    });

    it("does not retry on 400", async () => {
      const fetchMock = mockFetch(400, "bad request");
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      await expect(client.get("abc")).rejects.toThrow(MnemoError);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("does not retry on 500", async () => {
      const fetchMock = mockFetch(500, "server error");
      globalThis.fetch = fetchMock;

      const client = new MnemoClient(mockConfig, mockLogger);
      await expect(client.get("abc")).rejects.toThrow(MnemoError);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("throws after max retries exhausted", async () => {
      globalThis.fetch = mockFetch(503);
      const client = new MnemoClient(mockConfig, mockLogger);

      await expect(client.get("abc")).rejects.toThrow(MnemoError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });
  });

  describe("base URL handling", () => {
    it("strips trailing slash from base URL", async () => {
      const fetchMock = mockFetch(200, { id: "abc" });
      globalThis.fetch = fetchMock;

      const config = { ...mockConfig, apiUrl: "http://localhost:8080/" };
      const client = new MnemoClient(config, mockLogger);
      await client.get("abc");

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe(
        "http://localhost:8080/v1alpha2/mem9s/memories/abc",
      );
    });
  });
});
