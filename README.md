# @mem9/mcp-server

Universal MCP Server for mem9 memory service. One server, all platforms.

## Quick Start

```bash
# Requires a running mnemo-server and API key
git clone https://github.com/you06/mem9-mcp.git
cd mem9-mcp
npm install
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEM9_API_KEY` | Yes | - | API key for authentication (also serves as tenant ID) |
| `MEM9_API_URL` | No | `https://api.mem9.ai` | mnemo-server base URL |
| `MEM9_AGENT_ID` | No | auto-detected | Agent identifier |
| `MEM9_LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |
| `MEM9_TIMEOUT_MS` | No | `10000` | HTTP request timeout (ms) |
| `MEM9_SEARCH_LIMIT` | No | `10` | Default search result limit |

Agent ID is auto-detected from platform environment variables (`CURSOR_WORKSPACE`, `CLAUDE_CODE_VERSION`, `CODEX_CLI_VERSION`).

## Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory (processed via fact extraction) |
| `memory_search` | Search memories by semantic similarity and keywords |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_update` | Update an existing memory (direct field update) |
| `memory_delete` | Delete a memory |

## Development

```bash
npm install
npm run build
npm test
```

### Local Testing with Claude Code / Codex

Before publishing, you can test the MCP server locally by pointing to the built entry file:

**Claude Code:**

```bash
claude mcp add mem9 -e MEM9_API_KEY=your-key -e MEM9_API_URL=http://localhost:8080 -- node /path/to/mem9-mcp/dist/index.js
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "mem9": {
      "command": "node",
      "args": ["/path/to/mem9-mcp/dist/index.js"],
      "env": {
        "MEM9_API_URL": "http://localhost:8080",
        "MEM9_API_KEY": "your-key"
      }
    }
  }
}
```

**Codex:**

```bash
codex mcp add mem9 -- node /path/to/mem9-mcp/dist/index.js
```

Or in `.codex/config.toml`:

```toml
[mcp_servers.mem9]
command = "node"
args = ["/path/to/mem9-mcp/dist/index.js"]

[mcp_servers.mem9.env]
MEM9_API_URL = "http://localhost:8080"
MEM9_API_KEY = "your-key"
```

After code changes, run `npm run build` and restart the MCP client to pick up the new build.

## Platform Setup

### Cursor

Settings > Features > MCP Servers:

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

### Claude Code

```bash
claude mcp add mem9 -- npx -y @mem9/mcp-server
```

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

### OpenAI Codex

```bash
codex mcp add mem9 -- npx -y @mem9/mcp-server
```

Or in `.codex/config.toml`:

```toml
[mcp_servers.mem9]
command = "npx"
args = ["-y", "@mem9/mcp-server"]

[mcp_servers.mem9.env]
MEM9_API_URL = "http://localhost:8080"
MEM9_API_KEY = "your-key"
```

## License

Apache-2.0
