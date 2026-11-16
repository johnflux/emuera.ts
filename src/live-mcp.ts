import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createQaMcpServer, type QaTools } from "./qa-driver.js";

type Command = {
  id: string; operation: string; args: unknown; delivered: boolean;
  resolve(value: unknown): void; reject(error: Error): void;
};
type Connection = {
  id: string; name: string; seen: number; session?: string;
  key: string; revoked: boolean;
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createQaMcpServer>;
  command?: Command;
};
export class PairingError extends Error {}

/** Approval is bound to the browser's unguessable game session, never to a client-supplied name. */
export class LiveMcp {
  private connection: Connection | undefined;
  private nextPrompt = 0;
  private timer = setInterval(() => this.expire(), 5000).unref();

  private expire(): void {
    const connection = this.connection;
    if (connection && (connection.session || connection.revoked) && Date.now() - connection.seen > 60_000) {
      if (!connection.revoked) this.revoke();
      this.connection = undefined;
      void connection.server.close().catch(error => console.error("MCP connection cleanup failed:", error));
    }
  }
  revoke(): void {
    const connection = this.connection;
    if (!connection) return;
    connection.revoked = true;
    connection.command?.reject(new Error("Agent access was revoked"));
    delete connection.command;
    delete connection.session;
    this.nextPrompt = Date.now() + 60_000;
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    this.revoke();
    await this.connection?.server.close();
    this.connection = undefined;
  }
  authorizes(authorization: string | undefined, session: unknown): boolean {
    this.expire();
    const connection = this.connection;
    return !!connection && !connection.revoked && connection.session === session
      && authorization === `Bearer ${connection.key}`;
  }
  attached(session: string): boolean {
    this.expire();
    return !!this.connection && !this.connection.revoked && this.connection.session === session;
  }
  detach(session: string): void {
    if (this.attached(session)) this.revoke();
  }
  private async invoke(connection: Connection, operation: string, args: unknown = {}): Promise<unknown> {
    this.expire();
    if (connection !== this.connection || connection.revoked) throw new Error("Agent access is disconnected; reconnect and ask the player to approve access");
    if (!connection.session) throw new Error("Waiting for player approval in the game. No game access has been granted.");
    if (connection.command) throw new Error("Another live command is still running");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (connection.command?.id === command.id) delete connection.command;
        reject(new Error("Game window did not finish the command within 30 seconds; its outcome may be unknown. Observe before retrying mutations."));
      }, 30_000);
      const command: Command = {
        id: randomUUID(), operation, args, delivered: false,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      };
      connection.command = command;
    });
  }
  private tools(connection: () => Connection): QaTools {
    const invoke = (operation: string, args?: unknown) => this.invoke(connection(), operation, args);
    let revision = 0;
    return {
      games: () => invoke("games"),
      context: () => invoke("context"),
      reload: async scan => {
        const result = await invoke("reload", { action: "reload", scan, since: revision });
        if (typeof result !== "object" || result === null || !("revision" in result) || typeof result.revision !== "number")
          throw new Error("Invalid script reload status from game");
        revision = result.revision;
        return result;
      },
      start: async () => { throw new Error("Live mode controls the approved running game. Use qa_observe, or launch --isolated for a separate QA run."); },
      observe: () => invoke("observe"),
      act: action => invoke("act", action),
      input: (value, timeout) => invoke("input", { value, timeout }),
      debug: command => invoke("debug", command),
      loadSave: async () => { throw new Error("qa_load_save is isolated-mode only. Use the game's normal load controls in live mode."); },
      screenshot: async () => {
        const result = await invoke("screenshot");
        if (typeof result !== "string" || !result.startsWith("iVBORw0KGgo") || result.length > 16 * 1024 * 1024)
          throw new Error("Game window returned an invalid PNG screenshot");
        return Buffer.from(result, "base64");
      },
      report: async () => {
        const observation = await invoke("observe");
        const directory = await mkdtemp(path.join(tmpdir(), "era-live-"));
        const report = path.join(directory, "report.json");
        await writeFile(report, JSON.stringify({ isolated: false, observation }, null, 2), { mode: 0o600 });
        return { report, isolated: false };
      },
      close: async () => { if (connection() === this.connection) this.revoke(); },
    };
  }
  async handle(request: IncomingMessage, response: ServerResponse, data?: unknown): Promise<void> {
    this.expire();
    const sessionId = request.headers["mcp-session-id"];
    if (sessionId) {
      const connection = this.connection;
      if (!connection || sessionId !== connection.transport.sessionId || connection.revoked) {
        response.writeHead(404).end("MCP session expired or access revoked");
        return;
      }
      await connection.transport.handleRequest(request, response, data);
      if (request.method === "DELETE") {
        this.revoke();
        await connection.server.close();
        this.connection = undefined;
      }
      return;
    }
    const initialized = InitializeRequestSchema.safeParse(data);
    if (request.method !== "POST" || !initialized.success) {
      response.writeHead(400).end("Initialize MCP before making requests");
      return;
    }
    if ((this.connection && !this.connection.revoked) || Date.now() < this.nextPrompt) {
      response.writeHead(429, { "Retry-After": "60" }).end("An agent is already connected, or pairing is cooling down");
      return;
    }
    this.nextPrompt = Date.now() + 60_000;
    await this.connection?.server.close();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomBytes(32).toString("hex"),
      enableJsonResponse: true,
    });
    const server = createQaMcpServer(this.tools(() => connection), true);
    const connection: Connection = {
      id: randomUUID(), name: initialized.data.params.clientInfo.name.slice(0, 100),
      seen: Date.now(), key: randomBytes(32).toString("hex"), revoked: false,
      transport, server,
    };
    this.connection = connection;
    await server.connect(transport);
    await transport.handleRequest(request, response, data);
  }
  poll(session: string, data: Record<string, unknown>): unknown {
    this.expire();
    const connection = this.connection;
    if (!connection || connection.revoked) return { connected: false };
    if (data.decision !== undefined) {
      if (data.id !== connection.id || (connection.session && (connection.session !== session || data.decision !== "allow")))
        throw new PairingError("This pairing request is no longer available");
      if (data.decision === "allow") {
        connection.session = session;
      } else if (data.decision === "deny") {
        this.revoke();
        return { connected: false };
      } else throw new PairingError("Invalid pairing decision");
    }
    if (!connection.session) return { connected: false, pending: { id: connection.id, name: connection.name } };
    if (connection.session !== session) return { connected: false };
    connection.seen = Date.now();
    if (data.revoke === true) {
      this.revoke();
      return { connected: false };
    }
    const command = connection.command;
    if (command && data.resultId === command.id) {
      delete connection.command;
      if (typeof data.error === "string") command.reject(new Error(data.error));
      else command.resolve(data.result);
    }
    const next = connection.command;
    const deliver = next && !next.delivered;
    if (deliver) next.delivered = true;
    return {
      connected: true, name: connection.name, key: connection.key,
      ...(deliver ? { command: { id: next.id, operation: next.operation, args: next.args } } : {}),
    };
  }
}
