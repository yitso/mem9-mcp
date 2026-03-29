import { describe, it, expect } from "vitest";
import {
  formatSearchResults,
  formatMemoryDetail,
} from "../../../src/utils/formatter.js";
import type { Memory } from "../../../src/client/mnemo-client.js";

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

describe("formatSearchResults", () => {
  it("returns 'No memories found.' for empty results", () => {
    expect(formatSearchResults([], 0)).toBe("No memories found.");
  });

  it("formats a single result with score and relative_age", () => {
    const mem = makeMemory({ score: 0.92, relative_age: "3 days ago" });
    const result = formatSearchResults([mem], 1);
    expect(result).toContain("Found 1 memory:");
    expect(result).toContain("[1]");
    expect(result).toContain("score: 0.92");
    expect(result).toContain("3 days ago");
    expect(result).toContain("Test memory content");
    expect(result).toContain("Tags: test");
  });

  it("formats multiple results", () => {
    const mems = [
      makeMemory({ id: "id-1", content: "First", score: 0.9 }),
      makeMemory({ id: "id-2", content: "Second", score: 0.8 }),
    ];
    const result = formatSearchResults(mems, 2);
    expect(result).toContain("Found 2 memories:");
    expect(result).toContain("[1]");
    expect(result).toContain("[2]");
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("truncates long content at 1000 characters", () => {
    const longContent = "x".repeat(2000);
    const mem = makeMemory({ content: longContent });
    const result = formatSearchResults([mem], 1);
    expect(result).toContain("[truncated, use memory_get for full content]");
    expect(result).not.toContain("x".repeat(1001));
  });

  it("omits results when total exceeds 8000 characters", () => {
    const mems = Array.from({ length: 20 }, (_, i) =>
      makeMemory({
        id: `id-${i}`,
        content: "A".repeat(500),
        tags: ["tag1", "tag2"],
      }),
    );
    const result = formatSearchResults(mems, 20);
    expect(result.length).toBeLessThanOrEqual(8100); // some tolerance for omission note
    expect(result).toContain("more results omitted");
  });
});

describe("formatMemoryDetail", () => {
  it("formats a memory with all fields", () => {
    const mem = makeMemory({
      relative_age: "5 days ago",
    });
    const result = formatMemoryDetail(mem);
    expect(result).toContain("ID: 550e8400");
    expect(result).toContain("Content: Test memory content");
    expect(result).toContain("Tags: test");
    expect(result).toContain("State: active");
    expect(result).toContain("Type: insight");
    expect(result).toContain("Age: 5 days ago");
    expect(result).toContain("Version: 1");
  });
});
