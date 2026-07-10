import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { GEAR_SPEC, HOUSE_SPEC, ROCKET_SPEC } from "./exampleSpecs";

/**
 * Giữ examples/construct-*.{json,svg} ĐỒNG BỘ với fixtures + compiler.
 * Đổi fixture/compiler → chạy: REGEN_EXAMPLES=1 npx vitest run tests/construct/examples.test.ts
 */

const EXAMPLES_DIR = join(process.cwd(), "examples");
const REGEN = process.env.REGEN_EXAMPLES === "1";

const CASES = [
  ["gear", GEAR_SPEC],
  ["house", HOUSE_SPEC],
  ["rocket", ROCKET_SPEC],
] as const;

describe("examples/construct-* đồng bộ với fixtures + compiler", () => {
  for (const [name, spec] of CASES) {
    const jsonPath = join(EXAMPLES_DIR, `construct-${name}.json`);
    const svgPath = join(EXAMPLES_DIR, `construct-${name}.svg`);

    it(`${name}: JSON khớp fixture, SVG khớp compile output`, () => {
      const compiled = compileConstruction(constructSpecSchema.parse(spec));

      if (REGEN) {
        writeFileSync(jsonPath, JSON.stringify(spec, null, 2) + "\n");
        writeFileSync(svgPath, compiled.svg + "\n");
        return;
      }

      expect(existsSync(jsonPath), `${jsonPath} thiếu — chạy REGEN_EXAMPLES=1`).toBe(true);
      expect(existsSync(svgPath), `${svgPath} thiếu — chạy REGEN_EXAMPLES=1`).toBe(true);
      expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual(spec);
      expect(readFileSync(svgPath, "utf8").trimEnd()).toBe(compiled.svg);
    });
  }
});
