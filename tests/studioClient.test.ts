import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StudioClient, type SseEvent } from "../scripts/director/client";

/**
 * D26 from the client side: the bench/showcase client re-attaches to a run
 * whose stream dropped (no new run, no double spend) and delivers replayed
 * steps once.
 */
let server: Server;
let base = "";
let posts = 0;
const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const step = (seq: number) => ({ type: "step", step: { seq, role: "artist", action: "draw", costUsd: 0.01 }, totals: { tokens: seq, costUsd: seq / 100 } });

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/projects/p1/director") {
      posts++;
      res.writeHead(200, { "content-type": "text/event-stream", "x-director-run": "run1" });
      res.end(sse([{ type: "run", runId: "run1", models: {} }, step(1)])); // the stream drops before "done"
      return;
    }
    if (req.method === "GET" && req.url === "/api/projects/p1/director/runs/run1/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse([{ type: "run", runId: "run1", models: {} }, step(1), step(2), { type: "done", summary: { status: "done" } }]));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("StudioClient.direct", () => {
  it("re-attaches to the same run after a dropped stream and delivers each step once", async () => {
    const got: SseEvent[] = [];
    const runId = await new StudioClient({ base }).direct("p1", { story: "x" }, (e) => got.push(e));
    expect(runId).toBe("run1");
    expect(posts).toBe(1); // never a second run
    expect(got.filter((e) => e.type === "step").map((e) => (e.step as { seq: number }).seq)).toEqual([1, 2]);
    expect(got.at(-1)?.type).toBe("done");
  }, 20_000);
});
