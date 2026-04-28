import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_CAPABILITIES, SERVER_INFO } from "../../src/server.js";
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

describe("createServer", () => {
  it("advertises the expected server metadata and capabilities", async () => {
    const server = createServer(mockConfig, mockLogger);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: {} },
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    expect(client.getServerVersion()).toEqual(SERVER_INFO);
    expect(client.getServerCapabilities()).toEqual(SERVER_CAPABILITIES);
    expect(client.getServerCapabilities()).toEqual({
      tools: { listChanged: false },
    });

    await server.close();
  });
});
