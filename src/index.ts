import { createHttpServer } from "./httpServer.js";

const PORT = Number(process.env.PORT ?? 8080);

createHttpServer().listen(PORT, "0.0.0.0", () =>
  console.log(`jura-mcp listening on port ${PORT}`)
);
