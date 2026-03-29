import type { Memory } from "../client/mnemo-client.js";

const MAX_CONTENT_LENGTH = 1000;
const MAX_TOTAL_LENGTH = 8000;
const TRUNCATION_SUFFIX = " [truncated, use memory_get for full content]";
const OMISSION_NOTE = (remaining: number) =>
  `\n\n[${remaining} more results omitted, narrow your query or use memory_get]`;

/** Format a single memory for display. */
function formatMemory(mem: Memory, index: number): string {
  let content = mem.content;
  if (content.length > MAX_CONTENT_LENGTH) {
    content =
      content.slice(0, MAX_CONTENT_LENGTH - TRUNCATION_SUFFIX.length) +
      TRUNCATION_SUFFIX;
  }

  const parts: string[] = [];

  // Header line: index, id, score, relative_age
  const headerParts = [`id: ${mem.id}`];
  if (mem.score !== undefined && mem.score !== null) {
    headerParts.push(`score: ${mem.score.toFixed(2)}`);
  }
  if (mem.relative_age) {
    headerParts.push(mem.relative_age);
  }
  parts.push(`[${index}] (${headerParts.join(", ")})`);

  // Content
  parts.push(content);

  // Tags
  if (mem.tags?.length) {
    parts.push(`Tags: ${mem.tags.join(", ")}`);
  }

  return parts.join("\n");
}

/** Format search results as human-readable text with truncation. */
export function formatSearchResults(memories: Memory[], total: number): string {
  if (memories.length === 0) {
    return "No memories found.";
  }

  const header = `Found ${total} ${total === 1 ? "memory" : "memories"}:`;
  let result = header;
  let formattedCount = 0;

  for (let i = 0; i < memories.length; i++) {
    const entry = formatMemory(memories[i], i + 1);
    const candidate = result + "\n\n" + entry;

    if (candidate.length > MAX_TOTAL_LENGTH) {
      const remaining = memories.length - formattedCount;
      result += OMISSION_NOTE(remaining);
      break;
    }

    result = candidate;
    formattedCount++;
  }

  return result;
}

/** Format a single memory for get/update response. */
export function formatMemoryDetail(mem: Memory): string {
  const parts: string[] = [];
  parts.push(`ID: ${mem.id}`);
  parts.push(`Content: ${mem.content}`);
  if (mem.tags?.length) parts.push(`Tags: ${mem.tags.join(", ")}`);
  if (mem.state) parts.push(`State: ${mem.state}`);
  if (mem.memory_type) parts.push(`Type: ${mem.memory_type}`);
  if (mem.relative_age) parts.push(`Age: ${mem.relative_age}`);
  parts.push(`Version: ${mem.version}`);
  parts.push(`Updated: ${mem.updated_at}`);
  return parts.join("\n");
}
