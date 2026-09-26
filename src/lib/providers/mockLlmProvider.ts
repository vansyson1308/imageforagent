import { costOf } from "@/lib/providers/pricing";
import { LlmError, type ChatMessage, type ChatOptions, type ChatResult, type LlmProvider } from "@/lib/providers/types";

/**
 * Scripted provider: no network, deterministic. Used by every automated test
 * and by the zero-key demo crew (`LLM_PROVIDER=mock`). The UI labels it
 * "mock", so it can never pass as a Nemotron run.
 */

export type MockReply = string | Record<string, unknown> | LlmError;

export interface MockCall {
  readonly messages: readonly ChatMessage[];
  readonly options: ChatOptions;
}

export type MockHandler = (messages: readonly ChatMessage[], options: ChatOptions, callIndex: number) => MockReply | Promise<MockReply>;

export class MockLlmProvider implements LlmProvider {
  readonly name: string;
  readonly calls: MockCall[] = [];
  private readonly handler: MockHandler;

  constructor(handler: MockHandler | readonly MockReply[], name = "mock") {
    this.name = name;
    if (typeof handler === "function") {
      this.handler = handler;
    } else {
      const queue = [...handler];
      this.handler = () => {
        const next = queue.shift();
        if (next === undefined) throw new LlmError("server", "Mock provider: reply queue exhausted.");
        return next;
      };
    }
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    if (options.signal?.aborted) throw new LlmError("aborted", "Request cancelled.");
    const index = this.calls.length;
    this.calls.push({ messages, options });
    const reply = await this.handler(messages, options, index);
    if (reply instanceof LlmError) throw reply;
    const text = typeof reply === "string" ? reply : JSON.stringify(reply);
    const promptTokens = Math.ceil(messages.reduce((n, m) => n + m.content.length + (m.images?.length ?? 0) * 1000, 0) / 4);
    const completionTokens = Math.ceil(text.length / 4);
    return {
      text,
      model: options.model,
      usage: { promptTokens, completionTokens },
      costUsd: costOf(options.model, promptTokens, completionTokens),
      latencyMs: 0,
      attempts: 1,
      finishReason: "stop",
      formatFallback: false,
    };
  }
}
