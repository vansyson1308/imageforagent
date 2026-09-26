import { costOf, priceOverrides, type PricePair } from "@/lib/providers/pricing";
import { LlmError, type ChatMessage, type ChatOptions, type ChatResult, type LlmProvider, type ResponseFormat } from "@/lib/providers/types";

/**
 * Nebius Token Factory provider for NVIDIA Nemotron over the OpenAI-compatible
 * API, using plain `fetch` (no SDK dependency):
 *   POST {NEBIUS_BASE_URL}/chat/completions   Authorization: Bearer <key>
 *   GET  {NEBIUS_BASE_URL}/models
 * Images are `image_url` content parts with base64 data URLs. Reasoning is
 * turned off with `chat_template_kwargs.enable_thinking=false`. Both are
 * recorded in docs/hackathon/DECISIONS.md D4.
 *
 * Retries: 429, 5xx, timeouts and network errors, with exponential backoff
 * (Retry-After honoured, capped). 400/401/403 are not retried. The one
 * exception is a 400/422 on a `json_schema` request: the model is remembered
 * as "no json_schema" and the request is repeated with `json_object`.
 */

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

export interface NemotronProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so backoff costs no wall time. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly maxRetries?: number;
  readonly defaultTimeoutMs?: number;
  readonly prices?: Record<string, PricePair>;
}

const IMAGE_DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("aborted", "Request cancelled."));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new LlmError("aborted", "Request cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Removes `<think>…</think>` reasoning blocks that some templates inline into content. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (!m.images || m.images.length === 0) return { role: m.role, content: m.content };
  for (const img of m.images) {
    if (!IMAGE_DATA_URI.test(img)) throw new LlmError("bad_request", "Images must be data:image/png|jpeg|webp;base64 URIs.");
  }
  return {
    role: m.role,
    content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))],
  };
}

function toWireFormat(f: ResponseFormat | undefined): Record<string, unknown> | undefined {
  if (!f || f.type === "text") return undefined;
  if (f.type === "json_object") return { type: "json_object" };
  return { type: "json_schema", json_schema: { name: f.name, schema: f.schema, strict: true } };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p && typeof (p as { text: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .join("");
  }
  return "";
}

const RETRYABLE = new Set<LlmError["kind"]>(["rate_limit", "server", "timeout", "network"]);

export class NemotronProvider implements LlmProvider {
  readonly name = "nemotron";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly maxRetries: number;
  private readonly defaultTimeoutMs: number;
  private readonly prices: Record<string, PricePair>;
  /** Models that rejected `json_schema` — later calls go straight to json_object. */
  private readonly noJsonSchema = new Set<string>();

  constructor(opts: NemotronProviderOptions) {
    if (!opts.apiKey) throw new LlmError("auth", "NEBIUS_API_KEY is not set.");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? abortableSleep;
    this.maxRetries = opts.maxRetries ?? 3;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 180_000;
    this.prices = opts.prices ?? priceOverrides();
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });
    if (!res.ok) throw new LlmError(res.status === 401 || res.status === 403 ? "auth" : "server", `GET /models → ${res.status}`, res.status);
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    const started = Date.now();
    let format = options.responseFormat;
    let formatFallback = false;
    if (format?.type === "json_schema" && this.noJsonSchema.has(options.model)) {
      format = { type: "json_object" };
      formatFallback = true;
    }
    const wireMessages = messages.map(toWireMessage);
    let attempts = 0;
    let retries = 0;
    for (;;) {
      attempts++;
      try {
        const out = await this.once(wireMessages, options, format);
        const promptTokens = out.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(wireMessages).length / 4);
        const completionTokens = out.usage?.completion_tokens ?? Math.ceil(out.text.length / 4);
        return {
          text: stripReasoning(out.text),
          model: out.model || options.model,
          usage: { promptTokens, completionTokens },
          costUsd: costOf(options.model, promptTokens, completionTokens, this.prices),
          latencyMs: Date.now() - started,
          attempts,
          finishReason: out.finishReason,
          formatFallback,
        };
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        if (err.kind === "bad_request" && format?.type === "json_schema" && (err.status === 400 || err.status === 422)) {
          this.noJsonSchema.add(options.model);
          format = { type: "json_object" };
          formatFallback = true;
          continue;
        }
        if (!RETRYABLE.has(err.kind) || retries >= this.maxRetries || options.signal?.aborted) throw err;
        const retryAfter = (err as LlmError & { retryAfterMs?: number }).retryAfterMs;
        const backoff = Math.min(30_000, retryAfter ?? 1000 * 2 ** retries + Math.floor(Math.random() * 250));
        retries++;
        await this.sleep(backoff, options.signal);
      }
    }
  }

  private async once(
    messages: Record<string, unknown>[],
    options: ChatOptions,
    format: ResponseFormat | undefined,
  ): Promise<{ text: string; model: string; finishReason: string | null; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    };
    const rf = toWireFormat(format);
    if (rf) body.response_format = rf;
    if (options.thinking !== undefined) body.chat_template_kwargs = { enable_thinking: options.thinking };

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) ctrl.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, options.timeoutMs ?? this.defaultTimeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (timedOut) throw new LlmError("timeout", `Request timed out after ${options.timeoutMs ?? this.defaultTimeoutMs} ms.`);
        if (options.signal?.aborted) throw new LlmError("aborted", "Request cancelled.");
        throw new LlmError("network", `Network error: ${e instanceof Error ? e.message : String(e)}`);
      }
      const raw = await res.text().catch(() => "");
      if (!res.ok) {
        const detail = raw.slice(0, 300).replace(/\s+/g, " ");
        const kind: LlmError["kind"] =
          res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : res.status >= 500 ? "server" : "bad_request";
        const err = new LlmError(kind, `Token Factory ${res.status}: ${detail}`, res.status) as LlmError & { retryAfterMs?: number };
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
        throw err;
      }
      let json: {
        model?: string;
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new LlmError("server", "Token Factory returned a non-JSON body.", res.status);
      }
      const choice = json.choices?.[0];
      if (!choice) throw new LlmError("server", "Token Factory response has no choices.", res.status);
      return {
        text: contentText(choice.message?.content),
        model: json.model ?? options.model,
        finishReason: choice.finish_reason ?? null,
        usage: json.usage,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
