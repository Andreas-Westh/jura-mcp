import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  localhostAllowedHostnames,
} from "@modelcontextprotocol/server";
import { createServer, type Server } from "node:http";
import { createJuraServer } from "./mcp/JuraServer.js";

const allowedHostnames =
  process.env.ALLOWED_HOSTNAMES?.split(",") ?? localhostAllowedHostnames();

export const createHttpServer = (): Server => {
  const serveMcp = toNodeHandler(
    createMcpHandler(createJuraServer, {
      onerror: (error) => console.error(error),
    })
  );
  const validateHost = hostHeaderValidation(allowedHostnames);
  const validateOrigin = originValidation(allowedHostnames);

  return createServer((request, response) => {
    if (!validateHost(request, response)) return;
    if (!validateOrigin(request, response)) return;
    void serveMcp(request, response);
  });
};
