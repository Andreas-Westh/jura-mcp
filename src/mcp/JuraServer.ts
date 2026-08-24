import { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools.js";

export const createJuraServer = (): McpServer => {
  const server = new McpServer(
    { name: "jura-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerTools(server);
  return server;
};
