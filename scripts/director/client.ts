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

  /**
   * Runs the Director and resolves with the run id once the run is done.
   * Runs execute on the server (D26): a dropped stream is re-attached via the
   * run's events endpoint (replay, then tail) instead of starting a new run,
   * and replayed steps are delivered once (deduplicated by step seq).
   */
  async direct(projectId: string, body: Record<string, unknown>, onEvent: (e: SseEvent) => void, maxReattach = 6): Promise<string> {
    const res = await fetch(this.url(`/api/projects/${projectId}/director`), { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`director → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const runId = res.headers.get("x-director-run") ?? "";
    const seen = new Set<number>();
    let done = false;
    const deliver = (e: SseEvent) => {
      if (e.type === "step") {
        const seq = Number((e.step as { seq?: number } | undefined)?.seq);
        if (Number.isFinite(seq)) {
          if (seen.has(seq)) return;
          seen.add(seq);
        }
      }
      if (e.type === "done") done = true;
      onEvent(e);
    };
    let stream: Response = res;
    for (let attempt = 0; ; attempt++) {
      try {
        await readSse(stream, deliver);
      } catch (e) {
        if (!runId || attempt >= maxReattach) throw e;
      }
      if (done) return runId;
      if (!runId || attempt >= maxReattach) throw new Error(`run ${runId || "?"}: stream ended before the run finished`);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
      const again = await fetch(this.url(`/api/projects/${projectId}/director/runs/${runId}/events`), { headers: this.headers(false) }).catch(() => null);
      if (again?.ok && again.body) stream = again;
      else if (again && (again.status === 404 || again.status === 401)) throw new Error(`run ${runId}: events → ${again.status}`);
    }
  }

  /**
   * Re-render a finished film at a higher quality WITHOUT any model call
   * (SPEC v2: showcase films at 1080p/24 fps; the Director renders at 1K/12).
   * Motion specs are pure functions of time, so a clip re-evaluated at 24 fps
   * and a frame re-rendered at 2K are the same drawing, sharper and smoother.
   */
  async remaster(projectId: string, opts: { resolution: "1K" | "2K" | "4K"; fps: number }): Promise<{ clips: number; stills: number }> {
    await this.json("PATCH", `/api/projects/${projectId}`, { resolution: opts.resolution });
    const p = await this.json<{ frames: Array<{ id: string; motionSpec?: string | null; artworkSvg?: string | null }> }>("GET", `/api/projects/${projectId}`);
    let clips = 0;
    for (const f of p.frames) {
      if (!f.motionSpec) continue;
      const motion = JSON.parse(f.motionSpec) as Record<string, unknown>;
      motion.fps = opts.fps;
      delete motion.holdFrames;
      for (let tries = 0; ; tries++) {
        try {
          await this.json("PUT", `/api/frames/${f.id}/motion`, { motion });
          break;
        } catch (e) {
          if (tries < 5 && /→ 429/.test(String(e))) await new Promise((r) => setTimeout(r, 11_000));
          else throw e;
        }
      }
      clips++;
    }
    const stills = p.frames.filter((f) => !f.motionSpec && f.artworkSvg).map((f) => f.id);
    if (stills.length) await this.json("POST", "/api/render", { projectId, frameIds: stills });
    return { clips, stills: stills.length };
  }

  async download(p: string): Promise<Buffer> {
    const res = await fetch(this.url(p), { headers: this.headers(false), redirect: "follow" });
    if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Read an SSE response to its end, delivering each `data:` event. */
async function readSse(res: Response, onEvent: (e: SseEvent) => void): Promise<void> {
  const reader = res.body!.getReader();
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
}
