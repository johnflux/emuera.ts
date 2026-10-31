/** Forwards the browser's LLM requests to an OpenAI-compatible API (OpenAI, OpenRouter or a local server). The page's
 * Content-Security-Policy only allows same-origin requests, and local servers often send no CORS headers. */
export const LLM_REQUEST_BYTES = 4 * 1024 * 1024;
const CHAT_TIMEOUT_MS = 5 * 60_000;
const MODELS_TIMEOUT_MS = 30_000;

export interface LlmProxyResult {
  ok: boolean;
  status: number;
  statusText: string;
  /** The upstream body, verbatim. */
  text: string;
}

export class LlmRequestError extends Error {}

export async function proxyLlm(data: Record<string, unknown>, signal?: AbortSignal): Promise<LlmProxyResult> {
  const { endpoint, apiKey, path, payload, provider } = data;
  if (typeof endpoint !== "string" || (path !== "chat/completions" && path !== "models"))
    throw new LlmRequestError("Expected an endpoint and a path of chat/completions or models");
  if (apiKey !== undefined && typeof apiKey !== "string") throw new LlmRequestError("API key must be a string");
  if (path === "chat/completions" && (!payload || typeof payload !== "object" || Array.isArray(payload)))
    throw new LlmRequestError("Expected a chat completion payload");
  let base: URL;
  try { base = new URL(endpoint.trim().replace(/\/+$/, "") + "/"); }
  catch { throw new LlmRequestError("The API base URL is not a valid URL"); }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new LlmRequestError("The API base URL must use http or https");
  if (base.username || base.password) throw new LlmRequestError("Put credentials in the API key field, not the URL");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/johnflux/emuera.ts";
    headers["X-Title"] = "Emuera.ts";
  }
  const init: RequestInit = { method: path === "models" ? "GET" : "POST", headers, redirect: "error" };
  if (path === "chat/completions") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(payload);
  }
  const timeout = AbortSignal.timeout(path === "models" ? MODELS_TIMEOUT_MS : CHAT_TIMEOUT_MS);
  init.signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(new URL(path, base), init); }
  catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const reason = timeout.aborted ? "timed out" : cause?.code ?? cause?.message ?? (error as Error).message;
    throw new LlmRequestError(`Could not reach ${base.origin}: ${reason}`);
  }
  return { ok: response.ok, status: response.status, statusText: response.statusText, text: await response.text() };
}
