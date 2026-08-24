import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { createJuraServer } from "./mcp/JuraServer.js";

const PORT = Number(process.env.PORT ?? 3000);

const handler = createMcpHandler(createJuraServer, {
  onerror: (error) => console.error(error),
});
const serveMcp = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

createServer((request, response) => {
  if (!validateHost(request, response)) return;
  if (!validateOrigin(request, response)) return;
  void serveMcp(request, response);
}).listen(PORT, "127.0.0.1", () =>
  console.log(`jura-mcp listening on http://127.0.0.1:${PORT}`)
);
