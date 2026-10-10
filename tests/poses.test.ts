import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildCritter, buildDoll, critterSchema, dollSchema, variantId, type DrawPose } from "@/lib/services/director/dollKit";
import { renderArtwork } from "@/lib/services/svgRenderer";

/**
 * Owner QC (D31 follow-up): poses must actually look different. Each pose is
 * rendered alone on a flat background and reduced to a silhouette mask; body
 * poses are compared by silhouette overlap (IoU), head turns by how many head
 * pixels change. Measured 2026-10-10 (child · elder · bald adult):
 *   fixed kit  stand/sit 0.53·0.51·0.40, stand/kneel 0.54·0.59·0.40, sit/kneel 0.64·0.53·0.51,
 *              stand/bow 0.68·0.77·0.73, head change on a turn 0.47·0.27·0.17, left/right 0.67·0.36·0.23
 *   old kit    sit/kneel 0.89·0.90·0.79, stand/bow 0.79·0.82·0.75, head change 0.12·0.13·0.07, left/right 0.15·0.14·0.09
 * so the old kit (a scaled standing figure, a 0.16R face shift) fails these bounds.
 */
const W = 120;
const H = 180;
const BG = "#ffffff";

async function render(defs: string, sym: string): Promise<{ mask: Uint8Array; rgb: Buffer }> {
  const png = await renderArtwork(defs, `<rect width="1080" height="1080" fill="${BG}"/><use href="#${sym}" x="180" y="0" width="720" height="1080"/>`, "1:1", "1K");
  const size = (await sharp(png).metadata()).width ?? 1080;
  const k = size / 1080;
  const { data } = await sharp(png).extract({ left: Math.round(180 * k), top: 0, width: Math.round(720 * k), height: size }).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = Math.abs(data[i * 3] - 255) + Math.abs(data[i * 3 + 1] - 255) + Math.abs(data[i * 3 + 2] - 255) > 24 ? 1 : 0;
  return { mask, rgb: data };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  let u = 0;
  for (let k = 0; k < a.length; k++) {
    i += a[k] & b[k];
    u += a[k] | b[k];
  }
  return u ? i / u : 1;
}

/** share of pixels in the top `rows` rows whose colour changes noticeably */
function headChange(a: Buffer, b: Buffer, rows: number): number {
  let changed = 0;
  let px = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (a[i] + a[i + 1] + a[i + 2] < 750 || b[i] + b[i + 1] + b[i + 2] < 750) {
        px++;
        if (d > 60) changed++;
      }
    }
  return px ? changed / px : 0;
}

const DOLLS = {
  child: dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", bottomColor: "#5b6b3a", accent: "#d9483b", accessories: [] }),
  elder: dollSchema.parse({ age: "elder", skin: "#e9c09c", hairStyle: "bun", hairColor: "#d8d4cc", top: "kimono", topColor: "#7fb3a3", accent: "#c97d60", accessories: ["glasses"] }),
  adultBald: dollSchema.parse({ age: "adult", skin: "#c68863", hairStyle: "bald", hairColor: "#3a2a20", top: "shirt", topColor: "#3b6ea5", bottom: "pants", bottomColor: "#2f3442", accent: "#e0b84a", accessories: [] }),
};
const FOX = critterSchema.parse({ fur: "#d9823b", belly: "#f6e7cf", ears: "pointy", tail: "bushy", muzzle: "pointed", accent: "#c0392b", accessories: [] });
const POSES: DrawPose[] = ["stand", "sit", "kneel", "bow", "look-left", "look-right"];

async function renderAll(build: (p: DrawPose) => string, id: string) {
  const out = {} as Record<DrawPose, { mask: Uint8Array; rgb: Buffer }>;
  for (const p of POSES) out[p] = await render(build(p), variantId(id, p, "neutral"));
  return out;
}

describe("kit poses differ for real (owner QC)", () => {
  for (const [name, spec] of Object.entries(DOLLS)) {
    it(`doll ${name}: sit, kneel and bow change the silhouette; look-left/right turn the head`, async () => {
      const r = await renderAll((p) => buildDoll("d", spec, { pose: p }), "d");
      const m = (a: DrawPose, b: DrawPose) => Math.round(iou(r[a].mask, r[b].mask) * 100) / 100;
      expect(m("stand", "sit"), "stand vs sit IoU").toBeLessThanOrEqual(0.56);
      expect(m("stand", "kneel"), "stand vs kneel IoU").toBeLessThanOrEqual(0.62);
      expect(m("sit", "kneel"), "sit vs kneel IoU").toBeLessThanOrEqual(0.7);
      expect(m("stand", "bow"), "stand vs bow IoU").toBeLessThanOrEqual(0.78);
      const rows = Math.round(H * 0.36);
      expect(headChange(r.stand.rgb, r["look-left"].rgb, rows), "head pixels changed, look-left").toBeGreaterThanOrEqual(0.15);
      expect(headChange(r.stand.rgb, r["look-right"].rgb, rows), "head pixels changed, look-right").toBeGreaterThanOrEqual(0.15);
      expect(headChange(r["look-left"].rgb, r["look-right"].rgb, rows), "look-left vs look-right").toBeGreaterThanOrEqual(0.2);
    }, 60_000);
  }

  it("critter: sits on its haunches, bows its head, turns its muzzle (kneel = sit for animals)", async () => {
    const r = await renderAll((p) => buildCritter("f", FOX, { pose: p }), "f");
    const m = (a: DrawPose, b: DrawPose) => Math.round(iou(r[a].mask, r[b].mask) * 100) / 100;
    expect(m("stand", "sit"), "stand vs sit IoU").toBeLessThanOrEqual(0.8);
    expect(m("sit", "kneel")).toBe(1);
    expect(m("stand", "bow"), "stand vs bow IoU").toBeLessThanOrEqual(0.92);
    const rows = Math.round(H * 0.4);
    expect(headChange(r.stand.rgb, r["look-left"].rgb, rows), "head pixels changed, look-left").toBeGreaterThanOrEqual(0.08);
    expect(headChange(r["look-left"].rgb, r["look-right"].rgb, rows), "look-left vs look-right").toBeGreaterThanOrEqual(0.1);
  }, 60_000);

  it("standing is unchanged (the series identity hash and the acting tests depend on it)", () => {
    const a = buildDoll("d", DOLLS.child);
    expect(a).not.toContain("translate(");
    expect(buildDoll("d", DOLLS.child, { pose: "look-right" })).toContain('<g transform="translate(');
  });
});
