import { describe, expect, it } from "vitest";
import { ensureRenderableLibrary } from "@/lib/services/director/cast";
import { renderArtwork } from "@/lib/services/svgRenderer";
import type { CastMember } from "@/lib/services/director/schemas";

// bench 2026-10-15 on 394a797: two crew runs died in the hero-prop recognition render on a library that no longer
// parsed ("Opening and ending tag mismatch: defs and svg"; "Couldn't find end of Start Tag ellipse"). Every step that
// adds to the library is now followed by this guard: only the broken symbol is replaced, the run goes on.
const canvas = { w: 1920, h: 1080 };
const member = (id: string, kind: CastMember["kind"]) => ({ id, kind, name: id, look: `a ${id}`, colors: ["#c33", "#fc9", "#333"] }) as unknown as CastMember;
const good = `<symbol id="kite" viewBox="0 0 400 400"><path d="M200 20 L380 200 L200 380 L20 200 Z" fill="#d33"/></symbol>`;
const members = [member("kite", "prop"), member("maya", "character"), member("beach", "set")];
const renders = (defs: string) => renderArtwork(defs, `<rect width="1920" height="1080" fill="#fff"/><use href="#kite" x="0" y="0" width="400" height="400"/>`, "16:9", "1K").then(() => true, () => false);

describe("a library that no longer renders is salvaged symbol by symbol, never fails the run", () => {
  it("leaves a library that renders untouched", async () => {
    expect(await ensureRenderableLibrary(good, members, canvas, "16:9")).toBeNull();
  });

  it.each([
    ["an unclosed start tag (Couldn't find end of Start Tag ellipse)", `<symbol id="maya" viewBox="0 0 400 400"><ellipse cx="200" cy="100" rx="40" ry="50" fill="#fc9"</symbol>`],
    ["an unclosed element (Opening and ending tag mismatch: defs and svg)", `<symbol id="maya" viewBox="0 0 400 400"><g><circle cx="200" cy="100" r="40" fill="#fc9"/></symbol>`],
  ])("%s: only that symbol is replaced; the rest stays exactly as drawn", async (_, broken) => {
    const defs = `${good}\n${broken}`;
    expect(await renders(defs)).toBe(false);
    const fixed = await ensureRenderableLibrary(defs, members, canvas, "16:9");
    expect(fixed).not.toBeNull();
    expect(fixed!.broken).toEqual(["maya"]);
    expect(fixed!.defs).toContain(good);
    expect(fixed!.defs).toMatch(/<symbol\b[^>]*id="maya"/);
    expect(await renders(fixed!.defs)).toBe(true);
  });
});
