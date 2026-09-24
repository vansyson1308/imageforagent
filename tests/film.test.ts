import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { LOGICAL_CANVAS } from "@/lib/services/svgRenderer";
import { buildTimeline, timelineDuration } from "@/lib/services/timeline";
import { buildShot } from "../examples/film/shots";
import { SHOTS } from "../examples/film/screenplay";
import { renderScore } from "../examples/film/score";

/**
 * "Đèn Ông Sao" — the film made with this engine is part of the test suite:
 * every shot must stay a valid motion spec that compiles, the cut must stay
 * feature-length, and the score must stay deterministic.
 */
const built = SHOTS.map(buildShot);

describe("film — Đèn Ông Sao", () => {
  it("every shot builds a schema-valid motion spec; ids are unique", () => {
    expect(new Set(SHOTS.map((s) => s.id)).size).toBe(SHOTS.length);
    for (const b of built) expect(() => motionSpecSchema.parse(b.json), b.def.id).not.toThrow();
  });

  it("the cut runs ≥ 20 minutes on the project timeline (24 fps, transitions overlapped)", () => {
    const tl = buildTimeline(
      built.map((b, i) => ({
        index: i + 1,
        description: b.def.desc,
        clip: { fps: b.motion.fps, frameCount: Math.round(b.motion.duration * b.motion.fps), duration: b.motion.duration },
        voice: null,
        transition: { kind: b.def.transition?.[0] ?? "cut", duration: b.def.transition?.[1] ?? 0.5 },
        scene: b.def.scene,
      })),
      1.5,
    );
    expect(timelineDuration(tl)).toBeGreaterThanOrEqual(20 * 60);
    expect(SHOTS.length).toBeGreaterThanOrEqual(100);
  });

  it("every shot's first, middle and last frames compile (DCI Flat canvas)", () => {
    for (const b of built) {
      const c = createMotionCompiler(motionSpecSchema.parse(b.json), {}, { canvas: LOGICAL_CANVAS["1.85:1"] });
      for (const i of [0, Math.floor(c.frameCount / 2), c.frameCount - 1]) {
        expect(() => c.compileFrame(i), `${b.def.id} frame ${i}`).not.toThrow();
      }
    }
  }, 120_000);

  it("builds are deterministic (same screenplay → same JSON)", () => {
    const again = SHOTS.map(buildShot);
    const h = (xs: typeof built) => createHash("sha1").update(JSON.stringify(xs.map((b) => b.json))).digest("hex");
    expect(h(again)).toBe(h(built));
  });

  it("the score is deterministic and peak-limited", () => {
    const cues = [
      { start: 0, end: 4, mood: "prologue" as const },
      { start: 4, end: 8, mood: "festival" as const },
    ];
    const a = renderScore(cues, 8, { sampleRate: 16000 });
    const b = renderScore(cues, 8, { sampleRate: 16000 });
    const digest = (x: typeof a) => createHash("sha1").update(Buffer.from(x.channels[0].buffer)).update(Buffer.from(x.channels[1].buffer)).digest("hex");
    expect(digest(a)).toBe(digest(b));
    let peak = 0;
    for (const ch of a.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.9);
    expect(peak).toBeGreaterThan(0.05);
  });
});
