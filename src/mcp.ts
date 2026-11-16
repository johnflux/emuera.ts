import { randomBytes } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { QaDriver, createQaMcpServer } from "./qa-driver.js";
import { startServer } from "./server.js";

export { QaDriver, createQaMcpServer } from "./qa-driver.js";

async function closeApp(app: HttpServer): Promise<void> {
  app.closeAllConnections();
  await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log = console.error;
  let app: HttpServer | undefined;
  let driver: QaDriver | undefined;
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      if (transport?.sessionId) {
        // Revocation and qa_finish deliberately invalidate the HTTP session before stdio exits.
        try { await transport.terminateSession(); }
        catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== 404) throw error;
        }
      }
    } finally {
      await client?.close();
      try { await driver?.close(); }
      finally { if (app) await closeApp(app); }
    }
  })();
  try {
    const args = process.argv.slice(2);
    let server: Server | ReturnType<typeof createQaMcpServer>;
    if (args[0] === "--connect" && args.length === 2) {
      const url = new URL(args[1]!);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || url.username || url.password || url.pathname !== "/mcp" || url.search || url.hash)
        throw new Error("--connect requires a loopback http://127.0.0.1:PORT/mcp URL");
      client = new Client({ name: "era-stdio-adapter", version: "1.0.0" });
      transport = new StreamableHTTPClientTransport(url);
      await client.connect(transport);
      const remote = client;
      server = new Server({ name: "era-live", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => remote.listTools());
      server.setRequestHandler(CallToolRequestSchema, request => remote.callTool(request.params));
    } else {
      if (args.length && !(args.length === 1 && args[0] === "--isolated"))
        throw new Error("Usage: mcp [--isolated | --connect http://127.0.0.1:PORT/mcp]");
      const token = randomBytes(32).toString("hex");
      const gamesDir = process.env.ERA_QA_GAMES_DIR ?? process.env.ERA_GAMES_DIR ?? fileURLToPath(new URL("../GAMES/", import.meta.url));
      app = await startServer(0, gamesDir, true, [], { token });
      const address = app.address();
      if (!address || typeof address === "string") throw new Error("QA server did not bind");
      driver = new QaDriver(`http://127.0.0.1:${address.port}`, token);
      server = createQaMcpServer(driver);
    }
    const protocol = "server" in server ? server.server : server;
    protocol.onclose = () => { void close().catch(error => { console.error("MCP shutdown failed:", error); process.exitCode = 1; }); };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
      void server.close().then(close).catch(error => { console.error("MCP shutdown failed:", error); process.exitCode = 1; });
    });
    await server.connect(new StdioServerTransport());
  } catch (error) {
    console.error("MCP startup failed:", error);
    await close();
    process.exitCode = 1;
  }
}
