# DESIGN.md — @mem9/mcp-server

> Universal MCP Server for mem9 memory service.
> One server, all platforms: Cursor · Claude Code · Cowork · OpenAI Codex.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture](#3-architecture)
4. [MCP Protocol Integration](#4-mcp-protocol-integration)
5. [Tool Definitions](#5-tool-definitions)
6. [Configuration](#6-configuration)
7. [Authentication & Security](#7-authentication--security)
8. [Platform-Specific Integration](#8-platform-specific-integration)
9. [Transport Layer](#9-transport-layer)
10. [Error Handling](#10-error-handling)
11. [Testing Strategy](#11-testing-strategy)
12. [Project Structure](#12-project-structure)
13. [Implementation Plan](#13-implementation-plan)
14. [Future Considerations](#14-future-considerations)

---

## 1. Overview

### What

`@mem9/mcp-server` is a Model Context Protocol (MCP) server that wraps the mem9 mnemo-server REST API, exposing 5 standardized memory tools to any MCP-compatible AI agent platform.

### Why

Today, mem9 has platform-specific plugins for Claude Code (Hooks + Skills), OpenCode (Plugin SDK), and OpenClaw. Each requires separate development and maintenance. MCP provides a **universal protocol** adopted by all major AI agent platforms:

- **Cursor** — MCP is the primary extension mechanism
- **Claude Code** — Native MCP support via `claude mcp add`
- **OpenAI Codex** — MCP supported in plugins
- **Windsurf, VS Code Copilot, Cline, etc.** — Growing MCP adoption

By building one MCP server, we eliminate per-platform plugin development and instantly support any future MCP-compatible agent.

### Key Design Principles

1. **Thin wrapper** — The MCP server adds no business logic. All intelligence lives in mnemo-server.
2. **Stateless** — No local state. Every call is a pass-through to mnemo-server.
3. **Zero-config default** — Works out of the box with sensible defaults; advanced users can customize.
4. **Platform-agnostic** — No platform-specific code in the MCP server itself.

---

## 2. Goals & Non-Goals

### Goals

- [ ] Expose all 5 mem9 memory operations as MCP tools
- [ ] Support stdio transport (required by Cursor, Claude Code, Codex)
- [ ] Publishable as `npx @mem9/mcp-server` for zero-install usage
- [ ] Configurable via environment variables (MEM9_API_URL, MEM9_API_KEY)
- [ ] Structured error responses that agents can understand and act on
- [ ] Comprehensive logging for debugging
- [ ] < 50ms overhead per tool call (network to mnemo-server excluded)

### Non-Goals

- ❌ Business logic (deduplication, compression, summarization) — belongs in mnemo-server
- ❌ Embedding generation — handled by mnemo-server / TiDB
- ❌ Platform-specific hooks or lifecycle management — belongs in platform plugins
- ❌ User authentication UI — handled by platform plugin or manual config
- ❌ Memory auto-injection into system prompt — belongs in platform-specific layers

---

## 3. Architecture

### System Context

```
┌─────────────────────────────────────────────────────────┐
│                   AI Agent Platforms                      │
│                                                           │
│  ┌──────────┐  ┌────────────┐  ┌───────┐  ┌──────────┐ │
│  │  Cursor   │  │ Claude Code│  │Cowork │  │  Codex   │ │
│  └────┬─────┘  └─────┬──────┘  └───┬───┘  └────┬─────┘ │
│       │               │             │            │        │
│       └───────────────┴──────┬──────┴────────────┘        │
│                              │                             │
│                     MCP Protocol (stdio)                   │
└──────────────────────────────┼─────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  @mem9/mcp-server   │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │ Tool Router   │  │
                    │  └───────┬───────┘  │
                    │          │          │
                    │  ┌───────▼───────┐  │
                    │  │ HTTP Client   │  │
                    │  │ (mnemo-api)   │  │
                    │  └───────┬───────┘  │
                    │          │          │
                    └──────────┼──────────┘
                               │
                        HTTPS / HTTP
                               │
                    ┌──────────▼──────────┐
                    │   mnemo-server      │
                    │   (Go, REST API)    │
                    │                     │
                    │   ┌─────────────┐   │
                    │   │  TiDB/MySQL │   │
                    │   │  (vector +  │   │
                    │   │  relational)│   │
                    │   └─────────────┘   │
                    └─────────────────────┘
```

### Component Breakdown

```
@mem9/mcp-server
├── Transport Layer        # stdio adapter
├── MCP Protocol Handler   # JSON-RPC message routing
├── Tool Registry          # Tool definitions & input schemas
├── Tool Handlers          # Tool-specific request processing
├── Mnemo HTTP Client      # REST client for mnemo-server
├── Config Manager         # Environment variable loading
├── Error Mapper           # mnemo errors → MCP error responses
└── Logger                 # Structured logging (stderr)
```

### Data Flow (Single Tool Call)

```
Agent Platform
    │
    ├─ 1. MCP tools/call request (JSON-RPC over stdio)
    │     { method: "tools/call", params: { name: "memory_search", arguments: { query: "..." } } }
    │
    ▼
MCP Server
    │
    ├─ 2. Parse & validate tool input against JSON Schema
    ├─ 3. Map to mnemo-server API call
    │     GET /v1alpha2/mem9s/memories?q=...
    ├─ 4. Forward HTTP request to mnemo-server
    │
    ▼
mnemo-server
    │
    ├─ 5. Execute hybrid search (vector + keyword)
    ├─ 6. Return JSON response
    │
    ▼
MCP Server
    │
    ├─ 7. Transform response to MCP tool result
    ├─ 8. Return JSON-RPC response
    │
    ▼
Agent Platform
    │
    └─ 9. Agent processes memory results
```

---

## 4. MCP Protocol Integration

### Protocol Version

Target: **MCP specification 2025-03-26** (latest stable).

### Capabilities Declaration

```json
{
  "capabilities": {
    "tools": {
      "listChanged": false
    }
  },
  "serverInfo": {
    "name": "mem9-mcp-server",
    "version": "1.0.0"
  }
}
```

We declare `tools` capability only. We do NOT use:
- `resources` — memory items are accessed via tools, not as static resources
- `prompts` — no prompt templates; agent decides when/how to use tools
- `sampling` — no need for the server to request LLM completions

### Supported Methods

| Method | Purpose |
|--------|---------|
| `initialize` | Handshake, capability negotiation |
| `tools/list` | Return all 5 tool definitions |
| `tools/call` | Execute a memory operation |
| `ping` | Health check |

---

## 5. Tool Definitions

### 5.1 memory_store

**Purpose**: Store a new memory in mem9.

```json
{
  "name": "memory_store",
  "description": "Store a new memory. The content will be processed by the memory service (fact extraction and reconciliation) — it is not stored verbatim. Use this when you learn something worth remembering: user preferences, project conventions, important decisions, recurring patterns, or any context that would be useful in future sessions. Do NOT store trivial or transient information like current file paths, temporary debug notes, or information that only matters in the current session. Note: the response does not include the stored memory's ID. If you need to update or delete a memory you just stored, use memory_search to find it first.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "The memory content to store. Be specific and self-contained — this should make sense when retrieved later without additional context."
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional tags for categorization (e.g., ['coding-style', 'python', 'user-preference'])."
      },
      "metadata": {
        "type": "object",
        "description": "Optional key-value metadata (e.g., { 'project': 'web-app', 'source': 'code-review' }).",
        "additionalProperties": { "type": "string" }
      },
      "session_id": {
        "type": "string",
        "description": "Optional session identifier to associate this memory with a specific conversation or workflow."
      }
    },
    "required": ["content"]
  }
}
```

**Mnemo API mapping**: `POST /v1alpha2/mem9s/memories`

**Request body**:
```json
{
  "content": "<content>",
  "tags": ["<tag1>", "<tag2>"],
  "metadata": { "<key>": "<value>" },
  "session_id": "<session_id>",
  "sync": true
}
```

> **Design decision**: The MCP server always sends `sync: true` so that the tool call blocks until reconciliation completes. Without `sync`, mnemo-server returns `202 Accepted` immediately and the agent has no confirmation that the memory was processed. The response body is `{"status": "ok"}` — it does not include the memory ID.

---

### 5.2 memory_search

**Purpose**: Search memories by semantic similarity and/or keyword match.

```json
{
  "name": "memory_search",
  "description": "Search your memory for relevant information. Use this at the start of a task to recall relevant context, when you need to check if something was previously discussed, or when the user references past work. Supports both semantic (meaning-based) and keyword search.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language search query. Describe what you're looking for — the system handles both semantic and keyword matching."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results to return (default: 10, max: 50).",
        "default": 10
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional: filter results to only memories with these tags."
      }
    },
    "required": ["query"]
  }
}
```

**Mnemo API mapping**: `GET /v1alpha2/mem9s/memories?q=<query>&limit=<limit>&tags=<tags>`

**Response transformation**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 3 memories:\n\n[1] (id: 550e8400-e29b-41d4-a716-446655440001, score: 0.92, 14 days ago)\nUser prefers tabs over spaces in Python projects.\nTags: coding-style, python\n\n[2] (id: 550e8400-e29b-41d4-a716-446655440002, score: 0.85, 9 days ago)\nThe web-app project uses PostgreSQL 16 with pgvector.\nTags: project, database\n\n[3] (id: 550e8400-e29b-41d4-a716-446655440003, score: 0.78, 3 days ago)\nDeployment is via GitHub Actions → AWS ECS.\nTags: project, devops"
    }
  ]
}
```

> **Design decision**: Results are formatted as human-readable text rather than structured JSON. This is because agents process text more reliably, and it avoids the agent needing to parse nested JSON from a tool result.

> **Truncation strategy**: Individual memory content is truncated to 1000 characters with a `[truncated, use memory_get for full content]` suffix. Total response text is capped at 8000 characters. If the cap is hit, remaining results are omitted with a `[N more results omitted, narrow your query or use memory_get]` note.

---

### 5.3 memory_get

**Purpose**: Retrieve a specific memory by ID.

```json
{
  "name": "memory_get",
  "description": "Retrieve a specific memory by its ID. Use this when you have a memory ID from a previous search and need the full content.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The memory ID (UUID format)."
      }
    },
    "required": ["id"]
  }
}
```

**Mnemo API mapping**: `GET /v1alpha2/mem9s/memories/:id`

---

### 5.4 memory_update

**Purpose**: Update an existing memory.

```json
{
  "name": "memory_update",
  "description": "Update an existing memory. Use this when information has changed, needs correction, or should be enriched with additional context. Provide the memory ID and at least one field to update. This is a direct field update — content is NOT re-processed through reconciliation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The memory ID to update."
      },
      "content": {
        "type": "string",
        "description": "The updated memory content (replaces the existing content). Omit to keep current content."
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Updated tags (replaces the entire tag list). Omit to keep current tags."
      },
      "metadata": {
        "type": "object",
        "description": "Updated metadata (replaces existing metadata). Omit to keep current metadata.",
        "additionalProperties": { "type": "string" }
      }
    },
    "required": ["id"]
  }
}
```

**Mnemo API mapping**: `PUT /v1alpha2/mem9s/memories/:id`

---

### 5.5 memory_delete

**Purpose**: Delete a memory.

```json
{
  "name": "memory_delete",
  "description": "Delete a memory that is no longer relevant or accurate. Use this to clean up outdated information. This action is irreversible.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The memory ID to delete."
      }
    },
    "required": ["id"]
  }
}
```

**Mnemo API mapping**: `DELETE /v1alpha2/mem9s/memories/:id`

---

## 6. Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEM9_API_URL` | No | `https://api.mem9.ai` | mnemo-server base URL |
| `MEM9_API_KEY` | Yes | — | API key for authentication |
| `MEM9_AGENT_ID` | No | auto-detected | Agent identifier sent as `X-Mnemo-Agent-Id` header |
| `MEM9_LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `MEM9_TIMEOUT_MS` | No | `10000` | HTTP request timeout to mnemo-server (ms) |
| `MEM9_SEARCH_LIMIT` | No | `10` | Default search result limit |

### Agent ID Auto-Detection

When `MEM9_AGENT_ID` is not set, the MCP server attempts to detect the calling agent:

1. Check `CURSOR_WORKSPACE` env var → `"cursor"`
2. Check `CLAUDE_CODE_VERSION` env var → `"claude-code"`
3. Check `CODEX_CLI_VERSION` env var → `"codex"`
4. Fallback → `"mcp-unknown"`

This allows mnemo-server to track which agent stored which memory, enabling cross-agent collaboration insights.

> These environment variables are injected by each platform at runtime. If a platform changes variable names, the detection silently falls back to `"mcp-unknown"`. As a secondary signal, the MCP `initialize` handshake provides `clientInfo.name` which can be used to cross-check.

---

## 7. Authentication & Security

### API Key Flow

```
1. User provisions tenant via: curl -X POST mnemo-server/v1alpha1/mem9s
2. Receives API key
3. Sets MEM9_API_KEY in MCP server config
4. MCP server attaches to every request:
   - Header: X-API-Key: <key>
   - Header: X-Mnemo-Agent-Id: <agent-id>
```

### Security Considerations

- **API key is stored in platform config** (e.g., Cursor settings, .mcp.json). These files should be gitignored.
- **MCP server never logs API keys** — even at debug level.
- **mnemo-server handles rate limiting** — MCP server does not implement its own.
- **No PII in tool descriptions** — tool descriptions are visible to the agent and may be logged by platforms.
- **Local transport (stdio) is preferred** — data stays on the user's machine except for the mnemo-server call.

### .gitignore Recommendation

```
# mem9 credentials
.env.mem9
.mcp.json
```

---

## 8. Platform-Specific Integration

### 8.1 Cursor

**Config location**: Settings → Features → MCP Servers

```json
{
  "mcpServers": {
    "mem9": {
      "command": "npx",
      "args": ["-y", "@mem9/mcp-server"],
      "env": {
        "MEM9_API_URL": "http://localhost:8080",
        "MEM9_API_KEY": "your-key"
      }
    }
  }
}
```

**Best practice**: Add a `.cursorrules` file to guide memory usage:

```
## Memory
You have access to persistent memory via mem9 tools.
- At the start of each task, use memory_search to recall relevant context.
- When you learn important project conventions, user preferences, or make significant decisions, use memory_store.
- When information changes, use memory_update instead of creating duplicates.
```

---

### 8.2 Claude Code

**Config**: `claude mcp add mem9 -- npx -y @mem9/mcp-server`

Or in `.mcp.json`:
```json
{
  "mcpServers": {
    "mem9": {
      "command": "npx",
      "args": ["-y", "@mem9/mcp-server"],
      "env": {
        "MEM9_API_URL": "http://localhost:8080",
        "MEM9_API_KEY": "your-key"
      }
    }
  }
}
```

**Note**: Claude Code also has the existing Hooks + Skills plugin. The two complement each other:
- Hooks → automatic memory load/save at session boundaries
- MCP → agent-initiated memory operations during a session

---

### 8.3 Claude Cowork

Same as Claude Code — Cowork shares the plugin and MCP infrastructure. No additional configuration needed.

**Key scenario**: Scheduled tasks in Cowork benefit most from MCP memory — the agent can search for context from previous scheduled runs before starting a new one.

---

### 8.4 OpenAI Codex

**Phase 1: Direct MCP** (no plugin packaging needed):
```
codex mcp add mem9 -- npx -y @mem9/mcp-server
```

> **Note**: Codex plugin packaging (`.codex-plugin/`, SKILL.md, openai.yaml) is deferred to Phase 2. The Codex plugin spec is still evolving, and `codex mcp add` provides full functionality today.

---

## 9. Transport Layer

### stdio

Used by: Cursor, Claude Code, Codex CLI.

- MCP server reads JSON-RPC from stdin, writes to stdout
- Logs go to stderr (never stdout, which would corrupt the protocol)
- Process lifecycle managed by the host platform

```
Platform ──stdin──→ MCP Server ──stdout──→ Platform
                        │
                    stderr → logs
```

---

## 10. Error Handling

### Error Mapping

| mnemo-server HTTP Status | MCP Error Code | User-facing Message |
|--------------------------|----------------|---------------------|
| 400 Bad Request | InvalidParams | "Invalid request: {detail}" |
| 401 Unauthorized | InvalidRequest | "Authentication failed. Check MEM9_API_KEY." |
| 404 Not Found | InvalidParams | "Memory not found: {id}" |
| 409 Conflict | InvalidRequest | "Version conflict. Memory was modified by another agent. Fetch latest and retry." |
| 429 Too Many Requests | InvalidRequest | "Rate limited. Please retry in {n} seconds." |
| 500 Internal Server Error | InternalError | "Memory service error. Please try again." |
| Network Error | InternalError | "Cannot reach memory service at {url}. Is mnemo-server running?" |

### Retry Strategy

The MCP server implements automatic retry for transient errors:

| Error Type | Retry? | Max Retries | Backoff |
|------------|--------|-------------|---------|
| Network errors (ECONNREFUSED, ETIMEDOUT, etc.) | Yes | 2 | Exponential (100ms, 200ms) |
| 429 Too Many Requests | Yes | 2 | `Retry-After` header value, else exponential (1s, 2s) |
| 502 Bad Gateway | Yes | 2 | Exponential (100ms, 200ms) |
| 503 Service Unavailable | Yes | 2 | Exponential (100ms, 200ms) |
| 504 Gateway Timeout | Yes | 2 | Exponential (100ms, 200ms) |
| 500 Internal Server Error | No | — | — |
| Other 4xx Client Errors | No | — | — |

> **Design decision**: 500 errors indicate a bug in mnemo-server and should surface immediately. 429 is transient (rate limiting) and should be retried using the `Retry-After` header if present. Gateway errors (502/503/504) and network errors are transient and worth retrying automatically.

### Error Response Format

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Cannot reach memory service at http://localhost:8080. Is mnemo-server running?\n\nTroubleshooting:\n1. Verify mnemo-server is running: curl http://localhost:8080/health\n2. Check MEM9_API_URL is correct\n3. Ensure no firewall is blocking the connection"
    }
  ],
  "isError": true
}
```

> **Design decision**: Error messages include troubleshooting steps. Since the agent sees these, it can relay helpful guidance to the user rather than just a cryptic error code.

---

## 11. Testing Strategy

### Unit Tests

| Component | Coverage Target | Key Scenarios |
|-----------|----------------|---------------|
| Tool Registry | 100% | All 5 tools registered with correct schemas |
| Input Validation | 100% | Required fields, type checks, edge cases |
| Error Mapper | 100% | All HTTP status codes → MCP errors |
| Config Manager | 100% | Defaults, overrides, missing required vars |

### Integration Tests

| Test | Setup | Validates |
|------|-------|-----------|
| Full tool roundtrip | Mock mnemo-server | store → search → get → update → delete |
| Auth failure | Mock 401 response | Correct error propagation |
| Network timeout | Mock slow response | Timeout handling |
| Large result set | Mock 50 results | Pagination / truncation |
| Concurrent calls | Parallel tool calls | No state corruption |

### E2E Tests

| Platform | Test |
|----------|------|
| Cursor | Install via MCP config → memory_store → memory_search → verify |
| Claude Code | `claude mcp add` → tool call in session → verify |
| Codex | Plugin install → tool invocation → verify |

### Performance Benchmarks

| Metric | Target |
|--------|--------|
| Tool call overhead (excl. network) | < 50ms |
| Memory usage (idle) | < 30MB |
| Startup time | < 2s |
| Concurrent tool calls | 10+ without degradation |

---

## 12. Project Structure

```
@mem9/mcp-server/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                         # Apache-2.0
│
├── src/
│   ├── index.ts                    # Entry point, transport selection
│   │
│   ├── server.ts                   # MCP server setup, capability declaration
│   │
│   ├── tools/
│   │   ├── index.ts                # Tool registry (list all tools)
│   │   ├── memory-store.ts         # memory_store handler
│   │   ├── memory-search.ts        # memory_search handler
│   │   ├── memory-get.ts           # memory_get handler
│   │   ├── memory-update.ts        # memory_update handler
│   │   └── memory-delete.ts        # memory_delete handler
│   │
│   ├── client/
│   │   └── mnemo-client.ts         # HTTP client for mnemo-server
│   │
│   ├── config/
│   │   └── config.ts               # Env var loading + validation
│   │
│   ├── errors/
│   │   └── error-mapper.ts         # HTTP errors → MCP errors
│   │
│   ├── transport/
│   │   └── stdio.ts                # stdio transport adapter
│   │
│   └── utils/
│       ├── logger.ts               # Structured logging (to stderr)
│       └── formatter.ts            # Memory result formatting
│
├── tests/
│   ├── unit/
│   │   ├── tools/                  # Per-tool unit tests
│   │   ├── client/                 # HTTP client tests
│   │   ├── config/                 # Config tests
│   │   └── errors/                 # Error mapper tests
│   │
│   ├── integration/
│   │   ├── roundtrip.test.ts       # Full CRUD cycle
│   │   └── error-scenarios.test.ts # Error propagation
│   │
│   └── fixtures/
│       └── mock-responses.ts       # Reusable mock data
│
└── docs/
    ├── cursor-setup.md             # Cursor installation guide
    ├── claude-code-setup.md        # Claude Code installation guide
    └── codex-setup.md              # Codex installation guide
```

### Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | MCP TypeScript SDK | ^1.28.0 |
| `zod` | Runtime input validation | ^3.x |
| `undici` or native `fetch` | HTTP client for mnemo-server | built-in |

> **Minimal dependency principle**: Only 2 runtime dependencies. No Express, no Axios, no bloat.

---

## 13. Implementation Plan

### Sprint Breakdown

**Day 1-2: Foundation**
- [ ] Project scaffolding (package.json, tsconfig, linting)
- [ ] Config manager (env var loading + validation)
- [ ] Mnemo HTTP client (all 5 API endpoints)
- [ ] Unit tests for config + client

**Day 3-4: MCP Tools**
- [ ] MCP server setup with `@modelcontextprotocol/sdk`
- [ ] Tool registry (all 5 tool definitions + JSON schemas)
- [ ] Tool handlers (memory_store, memory_search, memory_get, memory_update, memory_delete)
- [ ] Error mapper
- [ ] Result formatter (memory objects → human-readable text)
- [ ] Unit tests for all tools + error mapper

**Day 5: Transport + Integration**
- [ ] stdio transport
- [ ] Integration tests (mock mnemo-server, full CRUD roundtrip)
- [ ] `npx` execution setup (bin entry in package.json)

**Day 6: Platform Testing**
- [ ] E2E test with Cursor
- [ ] E2E test with Claude Code
- [ ] E2E test with Codex (via `codex mcp add`)

**Day 7: Polish + Ship**
- [ ] README.md with setup guides for each platform
- [ ] Platform-specific docs (cursor-setup.md, etc.)
- [ ] npm publish `@mem9/mcp-server`
- [ ] Verify Codex E2E via `codex mcp add`

### Definition of Done

- [ ] All 5 tools work on Cursor, Claude Code, and Codex (via `codex mcp add`)
- [ ] `npx @mem9/mcp-server` works without prior install
- [ ] 90%+ unit test coverage
- [ ] Integration tests pass against mock server
- [ ] Published to npm
- [ ] Setup docs for all 3 platforms

---

## 14. Future Considerations

### Phase 2: Smart Features (Post-Launch)

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Codex plugin packaging** | `.codex-plugin/`, SKILL.md, openai.yaml for marketplace distribution | Better Codex integration and discoverability |
| **Auto-recall prompt** | MCP `resources` that auto-injects top-N relevant memories into agent context | Cursor users get memory without .cursorrules |
| **Memory dedup** | Server-side deduplication on store | Prevent memory bloat from repeated agent saves |
| **Batch operations** | `memory_store_batch`, `memory_search_multi` | Efficiency for agents that process multiple memories |
| **Memory stats tool** | `memory_stats` — count, last updated, storage usage | Agent can report memory health to user |
| **Export tool** | `memory_export` — dump all memories as JSON/Markdown | Portability, backup |

### Phase 3: Advanced Protocol Features

| Feature | MCP Mechanism | Use Case |
|---------|---------------|----------|
| **Memory as Resources** | `resources/list` + `resources/read` | Agents browse memories like files |
| **Change notifications** | `notifications/resources/updated` | Multi-agent: agent A stores → agent B gets notified |
| **Prompt templates** | `prompts/list` + `prompts/get` | Pre-built "recall project context" prompt for onboarding |

### Ecosystem Expansion

As MCP adoption grows, the same server will automatically work with:
- **Windsurf** (Codeium) — already supports MCP
- **VS Code Copilot** — MCP support expected
- **Cline** — already supports MCP
- **Zed** — MCP support in progress
- **Any future MCP-compatible agent**

> The investment in MCP is future-proof: every new agent that adopts MCP gets mem9 support for free.

---

## Appendix A: MCP Message Examples

### Initialize Handshake

**Client → Server**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {
      "name": "cursor",
      "version": "1.0.0"
    }
  }
}
```

**Server → Client**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "tools": { "listChanged": false }
    },
    "serverInfo": {
      "name": "mem9-mcp-server",
      "version": "1.0.0"
    }
  }
}
```

### Tool Call: memory_search

**Client → Server**:
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "database configuration for web-app project",
      "limit": 5
    }
  }
}
```

**Server → Client** (success):
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Found 2 memories:\n\n[1] (id: 550e8400-e29b-41d4-a716-446655440001, score: 0.92, 14 days ago)\nThe web-app project uses PostgreSQL 16 with pgvector extension for vector search. Connection string format: postgresql://user:pass@host:5432/webapp\nTags: project, database, config\n\n[2] (id: 550e8400-e29b-41d4-a716-446655440002, score: 0.81, 9 days ago)\nDatabase migrations are managed via Prisma. Run `npx prisma migrate dev` for local development.\nTags: project, database, tooling"
      }
    ]
  }
}
```

**Server → Client** (error):
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Error: Cannot reach memory service at http://localhost:8080. Is mnemo-server running?\n\nTroubleshooting:\n1. Verify mnemo-server is running: curl http://localhost:8080/health\n2. Check MEM9_API_URL is correct\n3. Ensure no firewall is blocking the connection"
      }
    ],
    "isError": true
  }
}
```

---

## Appendix B: Comparison with Existing Plugins

| Aspect | Claude Code Plugin (Hooks) | OpenCode Plugin (SDK) | MCP Server (This Design) |
|--------|---------------------------|----------------------|--------------------------|
| Language | Bash + curl | TypeScript | TypeScript |
| Memory injection | Automatic (session lifecycle) | Automatic (system.transform) | Agent-initiated (tool calls) |
| Memory saving | Automatic (session stop) | Automatic (session.idle) | Agent-initiated (tool calls) |
| Platforms | Claude Code only | OpenCode only | Any MCP-compatible platform |
| Maintenance | Per-platform | Per-platform | Single codebase |
| Works alongside | ✅ Yes, MCP complements hooks | ✅ Yes, MCP complements SDK | N/A (is the universal layer) |

**Conclusion**: The MCP server does not replace existing plugins — it complements them and extends coverage to all other platforms.
