import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createJuraServer } from "./mcp/JuraServer.js";

serveStdio(createJuraServer, { onerror: (error) => console.error(error) });
