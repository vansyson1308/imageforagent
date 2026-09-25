/**
 * LLM provider contract — every model call in the Director goes through this
 * interface (never a vendor SDK from a route or a component). Two
 * implementations: `nemotronProvider` (Nebius Token Factory, OpenAI-compatible,
 * plain fetch) and `mockLlmProvider` (scripted, for tests and zero-key demos).
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** Images for a vision model — `data:image/png|jpeg|webp;base64,…` URIs only. */
  readonly images?: readonly string[];
}

export type ResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly name: string;
      /** Plain JSON Schema (draft-07 subset). */
      readonly schema: Record<string, unknown>;
    };

export interface ChatOptions {
  readonly model: string;
  readonly responseFormat?: ResponseFormat;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /**
   * Reasoning ("thinking") toggle. `false` sends
   * `chat_template_kwargs.enable_thinking=false` — direct-output calls
   * (critic scores, JSON edits) must not spend their budget on reasoning.
   * Undefined = model default.
   */
  readonly thinking?: boolean;
  /** Per-attempt timeout (ms). */
  readonly timeoutMs?: number;
  /** Cancels in-flight requests and pending retries. */
  readonly signal?: AbortSignal;
}

export interface ChatUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface ChatResult {
  readonly text: string;
  /** Model identity reported by the provider (may differ from the requested alias). */
  readonly model: string;
  readonly usage: ChatUsage;
  readonly costUsd: number;
  readonly latencyMs: number;
  /** HTTP attempts spent (1 = first try succeeded). */
  readonly attempts: number;
  readonly finishReason: string | null;
  /** Set when the json_schema request was downgraded to json_object. */
  readonly formatFallback: boolean;
}

export interface LlmProvider {
  /** "nemotron" | "mock" — surfaced in traces and the UI (never disguised). */
  readonly name: string;
  chat(messages: readonly ChatMessage[], options: ChatOptions): Promise<ChatResult>;
}

/** Error kinds the Director reacts to differently (retry / fallback / abort). */
export type LlmErrorKind = "auth" | "bad_request" | "rate_limit" | "server" | "timeout" | "network" | "aborted" | "parse";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

/** Model tiers of the crew (SPEC §3). */
export type ModelTier = "strong" | "mid" | "fast" | "vision";
