import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config/config.js";
import { createLogger, type Logger } from "./utils/logger.js";
import { MnemoClient } from "./client/mnemo-client.js";
import { registerTools } from "./tools/index.js";

export const SERVER_INFO = {
  name: "mem9-mcp-server",
  version: "0.1.0",
} as const;

export const SERVER_CAPABILITIES = {
  tools: {
    listChanged: false,
  },
} as const;

/** Build a configured MCP server instance. */
export function createServer(config: Config, logger: Logger): McpServer {
  const mcpServer = new McpServer(SERVER_INFO);

  const client = new MnemoClient(config, logger);
  registerTools(mcpServer, client, logger, { searchLimit: config.searchLimit });
  mcpServer.server.registerCapabilities(SERVER_CAPABILITIES);

  return mcpServer;
}

/** Create and start the MCP server. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info("starting mem9-mcp-server", {
    apiUrl: config.apiUrl,
    agentId: config.agentId,
  });

  const mcpServer = createServer(config, logger);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info("mem9-mcp-server started");
}
