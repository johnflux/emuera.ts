import path from "node:path";
import { pathToFileURL } from "node:url";
import { proxyLlm } from "./llm.js";

export const AISEKAI_ID = "eratohotw-aisekai-v0-6";
const OUTBOX = /^sav\/ai_q_\d+_\d+\.txt$/i;
const INBOX = /^sav\/(ai_(?:response|hist_res|cmd_res|desc_res|models_list))\.(?:txt|xml)$/i;
export interface AiSekaiSettings {
  provider: string; endpoint: string; model: string; apiKey: string; jsonMode: boolean;
}
export function aiSekaiSettings(value: unknown): AiSekaiSettings | null {
  if (!value || typeof value !== "object") return null;
  const { provider, endpoint, model, apiKey, jsonMode } = value as Record<string, unknown>;
  if (typeof provider !== "string" || typeof endpoint !== "string" || typeof model !== "string"
    || typeof apiKey !== "string" || typeof jsonMode !== "boolean") return null;
  return { provider, endpoint, model, apiKey, jsonMode };
}

interface Completion { messages: unknown[]; maxTokens: number; temperature: number; json: boolean }
interface Model {
  id?: string; name?: string; context_length?: number; context_window?: number; max_context_length?: number;
  max_output_tokens?: number; max_completion_tokens?: number;
  top_provider?: { context_length?: number; max_completion_tokens?: number };
}
function nativeClient(settings: AiSekaiSettings | null, signal: AbortSignal) {
  const request = async (route: "chat/completions" | "models" | "key", payload?: object) => {
    signal.throwIfAborted();
    if (!settings) throw new Error("Configure a provider in LLM Settings.");
    return proxyLlm({ provider: settings.provider, endpoint: settings.endpoint, apiKey: settings.apiKey, path: route, payload }, signal, route === "key");
  };
  const models = async (): Promise<Model[]> => {
    const result = await request("models");
    if (!result.ok) throw new Error(`Model lookup failed (HTTP ${result.status}).`);
    const data = JSON.parse(result.text);
    const list = data?.data ?? data?.models ?? data;
    if (!Array.isArray(list)) throw new Error("The provider did not return a model list.");
    return list;
  };
  const provider = settings?.provider ?? "app", model = settings?.model ?? "";
  return {
    provider, model,
    async complete({ messages, maxTokens, temperature, json }: Completion) {
      const payload = { model, messages, temperature, max_tokens: maxTokens };
      const structured = json && settings?.jsonMode;
      let result = await request("chat/completions", structured ? { ...payload, response_format: { type: "json_object" } } : payload);
      if (structured && [400, 422].includes(result.status) && /response_format|json/i.test(result.text))
        result = await request("chat/completions", payload);
      if (!result.ok) throw new Error(`AI completion failed (HTTP ${result.status}).`);
      const data = JSON.parse(result.text);
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("The model returned no reply.");
      return { text, usage: data.usage, model: data.model || model, provider };
    },
    async listModels() {
      return (await models()).flatMap(row => {
        const id = row?.id ?? row?.name;
        return typeof id === "string" ? [{ id, name: row.name || id }] : [];
      });
    },
    async testConnection() {
      // OpenRouter's public model list can succeed even with an invalid key.
      const result = await request(provider === "openrouter" ? "key" : "models");
      if (result.status === 401 || result.status === 403)
        return { ok: false, message: `Authentication failed (HTTP ${result.status}). Check your API key in LLM Settings.` };
      if (!result.ok) return { ok: false, message: `Connection test failed (HTTP ${result.status}).` };
      return { ok: true, message: provider === "openrouter" ? "OpenRouter is reachable and the API key is valid." : "Provider reachable." };
    },
    async getModelContext() {
      const row = (await models()).find(row => (row?.id ?? row?.name) === model);
      const tokens = Number(row?.context_length ?? row?.top_provider?.context_length ?? row?.context_window ?? row?.max_context_length) || 0;
      const maxOut = Number(row?.top_provider?.max_completion_tokens ?? row?.max_output_tokens ?? row?.max_completion_tokens) || 0;
      return { ok: tokens > 0, provider, model, tokens, maxOut, message: tokens
        ? `${model}: ${tokens.toLocaleString("en-US")} context tokens.` : `The provider does not report a context length for ${model}.` };
    },
  };
}
type Client = ReturnType<typeof nativeClient>;
interface Bridge { request(text: string, client: Client, options: { signal: AbortSignal }): Promise<Record<string, string>> }
export function loadAiSekaiBridge(root: string, saveDirectory: string): Promise<Bridge> {
  return import(pathToFileURL(path.join(root, "ai_bridge", "bridge.mjs")).href).then(module => {
    if (typeof module.createBridge !== "function") throw new Error("This AiSekai installation needs the importable AI bridge update.");
    return module.createBridge({ rootDir: root, embedded: true, saveDirectory });
  });
}

export class AiSekaiSession {
  private replies = new Map<string, string>();
  private abort = new AbortController();
  private settings: AiSekaiSettings | null = null;
  constructor(private load: () => Promise<Bridge>) {}

  run<T>(settings: unknown, execute: () => T): T {
    this.settings = aiSekaiSettings(settings);
    try { return execute(); }
    finally { this.settings = null; }
  }

  read(file: string): string | null | undefined {
    const match = INBOX.exec(file.replaceAll("\\", "/"));
    return match ? this.replies.get(match[1]!.toLowerCase()) ?? null : undefined;
  }

  send(file: string, text: string): boolean {
    if (!OUTBOX.test(file.replaceAll("\\", "/"))) return false;
    // Capture this step's settings, not the settings of whichever tab acts next.
    const client = nativeClient(this.settings, this.abort.signal);
    const reqId = /^REQ_ID=([^\r\n]+)/m.exec(text)?.[1];
    const type = /^TYPE=(\w+)/m.exec(text)?.[1];
    const channel = type === "CHAT" ? "ai_response" : type === "DESC" ? "ai_desc_res"
      : type === "HISTORY" || type === "CMDFX" ? "ai_hist_res" : "ai_cmd_res";
    if (reqId) this.replies.delete(channel);
    void this.load().then(bridge => {
      this.abort.signal.throwIfAborted();
      return bridge.request(text, client, { signal: this.abort.signal });
    }).then(files => {
      if (this.abort.signal.aborted) return;
      for (const [name, content] of Object.entries(files)) {
        const match = INBOX.exec(`sav/${name}`);
        if (match) this.replies.set(match[1]!, content);
      }
    }).catch(error => {
      if (this.abort.signal.aborted) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (reqId) {
        const detail = reason.replace(/[\r\n]+/g, " ");
        this.replies.set(channel, `STATUS=ERROR\nMESSAGE=${detail}\nERROR=${detail}\nREQ_ID=${reqId}\n`);
      }
      else console.warn(`AiSekai bridge (${type ?? "unknown message"}): ${reason}`);
    });
    return true;
  }

  close(): void { this.abort.abort(); this.settings = null; this.replies.clear(); }
}
