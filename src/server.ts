import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/config.js";
import { createLogger } from "./utils/logger.js";
import { MnemoClient } from "./client/mnemo-client.js";
import { registerTools } from "./tools/index.js";

/** Create and start the MCP server. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info("starting mem9-mcp-server", {
    apiUrl: config.apiUrl,
    agentId: config.agentId,
  });

  const mcpServer = new McpServer(
    { name: "mem9-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const client = new MnemoClient(config, logger);
  registerTools(mcpServer, client, logger);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info("mem9-mcp-server started");
}
