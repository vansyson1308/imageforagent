/**
 * Tavily over plain fetch (no SDK). Shapes follow the official client
 * `tavily-ai/tavily-python` (DECISIONS.md D5):
 *   POST {base}/search  {query, search_depth, max_results, include_answer, include_raw_content}
 *        → {results: [{title, url, content, score}]}
 *   POST {base}/extract {urls, extract_depth, format}
 *        → {results: [{url, raw_content}], failed_results: [...]}
 *   Authorization: Bearer <TAVILY_API_KEY>
 */

export const TAVILY_BASE_URL = "https://api.tavily.com";

export interface TavilyResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score: number;
}

export interface TavilyOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

async function post(opts: TavilyOptions, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${(opts.baseUrl || TAVILY_BASE_URL).replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new TavilyError(`Tavily ${path} → ${res.status}: ${text.slice(0, 200)}`, res.status);
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof TavilyError) throw e;
    throw new TavilyError(`Tavily ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const isHttpUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

export async function tavilySearch(opts: TavilyOptions, query: string, maxResults = 3, signal?: AbortSignal): Promise<TavilyResult[]> {
  const body = (await post(
    opts,
    "/search",
    { query: query.slice(0, 200), search_depth: "basic", max_results: Math.min(5, Math.max(1, maxResults)), include_answer: false, include_raw_content: false },
    signal,
  )) as { results?: unknown[] };
  return (body.results ?? [])
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { title: str(o.title, 200), url: str(o.url, 500), content: str(o.content, 800), score: typeof o.score === "number" ? o.score : 0 };
    })
    .filter((r) => isHttpUrl(r.url) && r.content.length > 0);
}

export async function tavilyExtract(opts: TavilyOptions, urls: readonly string[], signal?: AbortSignal): Promise<Array<{ url: string; rawContent: string }>> {
  const body = (await post(opts, "/extract", { urls: urls.slice(0, 3), extract_depth: "basic", format: "text" }, signal)) as { results?: unknown[] };
  return (body.results ?? [])
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { url: str(o.url, 500), rawContent: str(o.raw_content, 4000) };
    })
    .filter((r) => isHttpUrl(r.url) && r.rawContent.length > 0);
}
