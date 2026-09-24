import { describe, expect, it } from "vitest";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { extractPoses, poseSkeletonSvg, toOpenPoseJson, COCO18 } from "@/lib/services/construct/pose2d";
import { segmentationColor } from "@/lib/services/construct/passes";
import { sanitizeSvg } from "@/lib/services/svgRenderer";

const fills = (svg: string) => [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);

const scene = (extra: Record<string, unknown> = {}) =>
  constructSpecSchema.parse({
    version: 1,
    solids: [
      { id: "near", type: "box", size: [100, 100, 100], at: [0, 50, 300], fill: "#ff0000" },
      { id: "far", type: "box", size: [100, 100, 100], at: [0, 50, -300], fill: "#00ff00" },
    ],
    parts: [{ id: "hero", type: "figure", height: 300, at: [250, 0, 0] }],
    shadow: { opacity: 0.3 },
    atmosphere: { vignette: {} },
    camera: { orbit: { azimuth: 0, elevation: 10 } },
    ...extra,
  });

describe("control passes", () => {
  it("depth: GẦN = SÁNG, mặt lớn có ramp tuyến tính, không filter/bóng, qua sanitizer", () => {
    const { svg } = compileConstruction(scene(), { pass: "depth" });
    expect(svg).not.toMatch(/<filter|radialGradient/);
    // Không còn gradient shading của engine — chỉ ramp depth "cg-d*"
    for (const m of svg.matchAll(/linearGradient id="([^"]+)"/g)) expect(m[1]).toMatch(/^cg-d\d+$/);
    expect(() => sanitizeSvg(svg, "frame")).not.toThrow();
    const grays = [...fills(svg), ...[...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1])].map((h) => parseInt(h.slice(1, 3), 16));
    expect(Math.max(...grays)).toBeGreaterThan(Math.min(...grays) + 100);
    // Mọi fill là xám (r = g = b)
    for (const h of fills(svg)) expect(h.slice(1, 3) === h.slice(3, 5) && h.slice(3, 5) === h.slice(5, 7)).toBe(true);
  });

  it("segmentation: cả figure MỘT màu, đối tượng khác màu khác, ổn định", () => {
    const { svg } = compileConstruction(scene(), { pass: "segmentation" });
    const set = new Set(fills(svg));
    expect(set).toEqual(new Set([segmentationColor("near"), segmentationColor("far"), segmentationColor("hero")]));
    expect(segmentationColor("hero")).toBe(segmentationColor("hero"));
  });

  it("normal: mặt nhìn thẳng camera ≈ #8080ff", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: [{ id: "b", type: "box", size: [100, 100, 100] }],
      camera: { orbit: { azimuth: 0, elevation: 0 } },
    });
    expect(fills(compileConstruction(spec, { pass: "normal" }).svg)).toContain("#8080ff");
  });

  it("pass mặc định (không option) byte-identical với trước", () => {
    expect(compileConstruction(scene()).svg).toBe(compileConstruction(scene(), {}).svg);
  });

  it("OpenPose COCO-18: 18 điểm, trái nhân vật ở BÊN PHẢI ảnh khi quay mặt vào camera", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      parts: [{ id: "hero", type: "figure", height: 300 }],
      camera: { orbit: { azimuth: 0, elevation: 0 } },
    });
    const pose = extractPoses(spec);
    expect(pose.people).toHaveLength(1);
    const k = Object.fromEntries(COCO18.map((n, i) => [n, pose.people[0].keypoints[i]]));
    expect(k.lShoulder[0]).toBeGreaterThan(k.rShoulder[0]);
    expect(k.nose[1]).toBeLessThan(k.neck[1]);
    expect(k.lAnkle[1]).toBeGreaterThan(k.lKnee[1]);
    // Figure đứng trên y=0 → cổ chân gần place.at.y = 540 (ortho, zoom 1)
    expect(k.lAnkle[1]).toBeLessThan(540);
    expect(k.lAnkle[1]).toBeGreaterThan(500);
    // Nhìn thẳng: mắt thấy; tai ở mép — nhìn từ sau: mắt/mũi confidence 0
    expect(k.lEye[2]).toBe(1);
    const back = extractPoses(constructSpecSchema.parse({ ...spec, camera: { orbit: { azimuth: 180, elevation: 0 } } }));
    expect(back.people[0].keypoints[0][2]).toBe(0);
    const json = toOpenPoseJson(pose) as { people: { pose_keypoints_2d: number[] }[] };
    expect(json.people[0].pose_keypoints_2d).toHaveLength(54);
    expect(() => sanitizeSvg(poseSkeletonSvg(pose), "frame")).not.toThrow();
  });
});
