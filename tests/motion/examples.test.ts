import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { motionSpecSchema } from "@/lib/validation/motionSchema";

/**
 * examples/motion-*.json là tài liệu sống: phải parse, compile MỌI frame,
 * deterministic — và chuỗi hash frame được snapshot (docs không lệch code).
 */
const dir = path.resolve(__dirname, "../../examples");
const files = readdirSync(dir).filter((f) => /^motion-.*\.json$/.test(f));

describe("motion examples", () => {
  it("có ít nhất 2 example", () => expect(files.length).toBeGreaterThanOrEqual(2));

  it.each(files)("%s compile trọn clip, deterministic, không error", (file) => {
    const motion = motionSpecSchema.parse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    const run = () => {
      const c = createMotionCompiler(motion);
      return Array.from({ length: c.frameCount }, (_, i) => c.compileFrame(i).svg);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    const digest = createHash("sha256").update(a.join("\n")).digest("hex").slice(0, 16);
    expect({ file, frames: a.length, digest }).toMatchSnapshot();
  });
});
