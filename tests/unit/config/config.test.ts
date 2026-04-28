import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, detectAgentId } from "../../../src/config/config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all MEM9 env vars
    delete process.env.MEM9_API_URL;
    delete process.env.MEM9_API_KEY;
    delete process.env.MEM9_AGENT_ID;
    delete process.env.MEM9_LOG_LEVEL;
    delete process.env.MEM9_TIMEOUT_MS;
    delete process.env.MEM9_SEARCH_LIMIT;
    delete process.env.CURSOR_WORKSPACE;
    delete process.env.CLAUDE_CODE_VERSION;
    delete process.env.CODEX_CLI_VERSION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if MEM9_API_KEY is missing", () => {
    expect(() => loadConfig()).toThrow("MEM9_API_KEY is required");
  });

  it("returns defaults when only MEM9_API_KEY is set", () => {
    process.env.MEM9_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiUrl).toBe("https://api.mem9.ai");
    expect(config.apiKey).toBe("test-key");
    expect(config.agentId).toBe("mcp-unknown");
    expect(config.logLevel).toBe("info");
    expect(config.timeoutMs).toBe(10000);
    expect(config.searchLimit).toBe(10);
  });

  it("respects all overrides", () => {
    process.env.MEM9_API_KEY = "my-key";
    process.env.MEM9_API_URL = "http://localhost:8080";
    process.env.MEM9_AGENT_ID = "my-agent";
    process.env.MEM9_LOG_LEVEL = "debug";
    process.env.MEM9_TIMEOUT_MS = "5000";
    process.env.MEM9_SEARCH_LIMIT = "20";
    const config = loadConfig();
    expect(config.apiUrl).toBe("http://localhost:8080");
    expect(config.apiKey).toBe("my-key");
    expect(config.agentId).toBe("my-agent");
    expect(config.logLevel).toBe("debug");
    expect(config.timeoutMs).toBe(5000);
    expect(config.searchLimit).toBe(20);
  });

  it("rejects malformed numeric values", () => {
    process.env.MEM9_API_KEY = "test-key";
    process.env.MEM9_TIMEOUT_MS = "not-a-number";
    expect(() => loadConfig()).toThrow("MEM9_TIMEOUT_MS must be a positive integer.");

    process.env.MEM9_TIMEOUT_MS = "10000";
    process.env.MEM9_SEARCH_LIMIT = "abc";
    expect(() => loadConfig()).toThrow("MEM9_SEARCH_LIMIT must be a positive integer.");
  });

  it("rejects non-canonical integer strings", () => {
    process.env.MEM9_API_KEY = "test-key";

    process.env.MEM9_TIMEOUT_MS = "1.5";
    expect(() => loadConfig()).toThrow("MEM9_TIMEOUT_MS must be a positive integer.");

    process.env.MEM9_TIMEOUT_MS = "1e3";
    expect(() => loadConfig()).toThrow("MEM9_TIMEOUT_MS must be a positive integer.");

    process.env.MEM9_TIMEOUT_MS = "10000";
    process.env.MEM9_SEARCH_LIMIT = "10foo";
    expect(() => loadConfig()).toThrow("MEM9_SEARCH_LIMIT must be a positive integer.");
  });

  it("rejects zero or negative timeout values", () => {
    process.env.MEM9_API_KEY = "test-key";
    process.env.MEM9_TIMEOUT_MS = "0";
    expect(() => loadConfig()).toThrow("MEM9_TIMEOUT_MS must be a positive integer.");

    process.env.MEM9_TIMEOUT_MS = "-1";
    expect(() => loadConfig()).toThrow("MEM9_TIMEOUT_MS must be a positive integer.");
  });

  it("rejects zero, negative, or oversized search limits", () => {
    process.env.MEM9_API_KEY = "test-key";
    process.env.MEM9_SEARCH_LIMIT = "0";
    expect(() => loadConfig()).toThrow("MEM9_SEARCH_LIMIT must be a positive integer.");

    process.env.MEM9_SEARCH_LIMIT = "-1";
    expect(() => loadConfig()).toThrow("MEM9_SEARCH_LIMIT must be a positive integer.");

    process.env.MEM9_SEARCH_LIMIT = "51";
    expect(() => loadConfig()).toThrow(
      "MEM9_SEARCH_LIMIT must be less than or equal to 50.",
    );
  });

  it("falls back to 'info' for invalid log level", () => {
    process.env.MEM9_API_KEY = "test-key";
    process.env.MEM9_LOG_LEVEL = "verbose";
    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });
});

describe("detectAgentId", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CURSOR_WORKSPACE;
    delete process.env.CLAUDE_CODE_VERSION;
    delete process.env.CODEX_CLI_VERSION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 'cursor' when CURSOR_WORKSPACE is set", () => {
    process.env.CURSOR_WORKSPACE = "/some/path";
    expect(detectAgentId()).toBe("cursor");
  });

  it("returns 'claude-code' when CLAUDE_CODE_VERSION is set", () => {
    process.env.CLAUDE_CODE_VERSION = "1.0.0";
    expect(detectAgentId()).toBe("claude-code");
  });

  it("returns 'codex' when CODEX_CLI_VERSION is set", () => {
    process.env.CODEX_CLI_VERSION = "0.1.0";
    expect(detectAgentId()).toBe("codex");
  });

  it("returns 'mcp-unknown' when no platform env var is set", () => {
    expect(detectAgentId()).toBe("mcp-unknown");
  });

  it("prefers CURSOR_WORKSPACE over others when multiple are set", () => {
    process.env.CURSOR_WORKSPACE = "/path";
    process.env.CLAUDE_CODE_VERSION = "1.0";
    expect(detectAgentId()).toBe("cursor");
  });
});
