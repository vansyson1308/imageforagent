/**
 * Minimal HTTP client for a running Storyboard Studio (local or hosted):
 * demo unlock → project → Director run over SSE → trace + film.mp4.
 * Used by the showcase and eval scripts; also an end-to-end check of the demo.
 */

export interface RemoteOptions {
  readonly base: string;
  readonly passcode?: string;
}

export interface SseEvent {
  readonly type: string;
  readonly [k: string]: unknown;
}

export class StudioClient {
  private cookie = "";
  constructor(private readonly opts: RemoteOptions) {}

  private url(p: string) {
    return `${this.opts.base.replace(/\/+$/, "")}${p}`;
  }

  private headers(json = true): Record<string, string> {
    return { ...(json && { "content-type": "application/json" }), ...(this.cookie && { cookie: this.cookie }) };
  }

  async unlock(): Promise<void> {
    const status = await (await fetch(this.url("/api/demo/unlock"))).json();
    if (!status.demo) return;
    if (!this.opts.passcode) throw new Error("Demo mode is on: pass --passcode (or DEMO_PASSCODE).");
    const res = await fetch(this.url("/api/demo/unlock"), { method: "POST", headers: this.headers(), body: JSON.stringify({ passcode: this.opts.passcode }) });
    if (!res.ok) throw new Error(`unlock → ${res.status} ${await res.text()}`);
    this.cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  }

  async json<T = Record<string, unknown>>(method: string, p: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(p), { method, headers: this.headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text) as T;
  }

  /** In demo mode a session holds ≤ N projects: on QUOTA_EXCEEDED, unlock a fresh session and retry once. */
  async createProject(name: string): Promise<string> {
    try {
      return (await this.json<{ id: string }>("POST", "/api/projects", { name })).id;
    } catch (e) {
      if (!this.opts.passcode || !/QUOTA_EXCEEDED/.test(String(e))) throw e;
      this.cookie = "";
      await this.unlock();
      return (await this.json<{ id: string }>("POST", "/api/projects", { name })).id;
    }
  }

  /** Runs the Director and resolves with the run id once the stream ends. */
  async direct(projectId: string, body: Record<string, unknown>, onEvent: (e: SseEvent) => void): Promise<string> {
    const res = await fetch(this.url(`/api/projects/${projectId}/director`), { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`director → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const runId = res.headers.get("x-director-run") ?? "";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const data = buf.slice(0, i).match(/^data: (.+)$/m)?.[1];
        buf = buf.slice(i + 2);
        if (data) onEvent(JSON.parse(data));
      }
    }
    return runId;
  }

  async download(p: string): Promise<Buffer> {
    const res = await fetch(this.url(p), { headers: this.headers(false), redirect: "follow" });
    if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
