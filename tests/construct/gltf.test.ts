import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// @ts-expect-error — gltf-validator không ship types
import validator from "gltf-validator";
import { decomposeTrs, exportGltf } from "@/lib/services/construct/gltf";
import { exportMotionGltf } from "@/lib/services/motion/gltfMotion";
import { constructSpecSchema, type ConstructSpec } from "@/lib/validation/constructSchema";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { composePlacement4, mul4, transformPoint } from "@/lib/services/construct/math3d";
import { boxMesh, cylinderMesh, sphereMesh } from "@/lib/services/construct/geometry3d";
import { expandParts } from "@/lib/services/construct/partsExpand";
import { evaluateMotionAt, prepareMotion } from "@/lib/services/motion/evaluate";
import { CAMERA_PRESETS, projectViewPoint, viewMatrix } from "@/lib/services/construct/camera";
import type { Vec3 } from "@/lib/services/construct/types";

interface GltfDoc {
  buffers: { uri: string }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string }[];
  nodes: { translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[]; mesh?: number; skin?: number }[];
  meshes: { primitives: { attributes: { POSITION: number; JOINTS_0?: number } }[] }[];
  skins?: { joints: number[]; inverseBindMatrices: number }[];
  animations?: { samplers: { output: number }[]; channels: { sampler: number; target: { node: number; path: string } }[] }[];
}

const boxVerts = (s: readonly number[]): Vec3[] => boxMesh(s as unknown as Vec3).vertices as Vec3[];
const sphereVerts = (r: number, seg: number): Vec3[] => sphereMesh(r, seg).vertices as Vec3[];
const cylVerts = (r: number, h: number, seg: number): Vec3[] => cylinderMesh(r, h, seg).vertices as Vec3[];

interface Report {
  issues: { numErrors: number; numWarnings: number; messages: { code: string; message: string; pointer?: string; severity: number }[] };
}

async function validate(gltf: Record<string, unknown>): Promise<Report> {
  return validator.validateString(JSON.stringify(gltf), { maxIssues: 50 }) as Promise<Report>;
}

const examplesDir = path.resolve(__dirname, "../../examples");
const constructExamples = readdirSync(examplesDir).filter((f) => /^construct-.*\.json$/.test(f));

function rotate(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v' = q v q* (công thức tối ưu)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Chiếu điểm world bằng camera glTF → toạ độ canvas logic. */
function gltfProject(gltf: Record<string, unknown>, pw: Vec3, unit: number, W = 1920, H = 1080): [number, number] {
  const nodes = gltf.nodes as { name: string; translation: number[]; rotation: number[] }[];
  const cam = nodes.find((n) => n.name === "camera")!;
  const camera = (gltf.cameras as Record<string, Record<string, number>>[])[0];
  const rel: Vec3 = [pw[0] * unit - cam.translation[0], pw[1] * unit - cam.translation[1], pw[2] * unit - cam.translation[2]];
  const inv = [-cam.rotation[0], -cam.rotation[1], -cam.rotation[2], cam.rotation[3]];
  const pc = rotate(inv, rel);
  let nx: number;
  let ny: number;
  if (camera.orthographic) {
    nx = pc[0] / camera.orthographic.xmag;
    ny = pc[1] / camera.orthographic.ymag;
  } else {
    const tanY = Math.tan(camera.perspective.yfov / 2);
    nx = pc[0] / -pc[2] / (tanY * camera.perspective.aspectRatio);
    ny = pc[1] / -pc[2] / tanY;
  }
  return [W / 2 + (nx * W) / 2, H / 2 - (ny * H) / 2];
}

/** Engine: world → view → screen → canvas (place, không xoay). */
function engineProject(spec: ConstructSpec, pw: Vec3, distance?: number): [number, number] {
  const orbit = spec.camera.orbit ?? CAMERA_PRESETS[spec.camera.preset ?? "isometric"];
  const view = viewMatrix({ azimuth: orbit.azimuth, elevation: orbit.elevation, roll: orbit.roll ?? 0 });
  const pv = transformPoint(view, pw);
  const projection =
    spec.camera.projection === "perspective"
      ? { kind: "perspective" as const, zoom: spec.camera.zoom, distance: distance! }
      : { kind: "orthographic" as const, zoom: spec.camera.zoom };
  const sp = projectViewPoint(pv, projection).screen;
  return [spec.place.at[0] + spec.place.scale * sp[0], spec.place.at[1] + spec.place.scale * sp[1]];
}

describe("glTF exporter", () => {
  it.each(constructExamples)("%s → glTF hợp lệ (Khronos validator: 0 error)", async (file) => {
    const spec = constructSpecSchema.parse(JSON.parse(readFileSync(path.join(examplesDir, file), "utf8")));
    let result;
    try {
      result = exportGltf(spec);
    } catch (e) {
      // Spec thuần 2D (gear) không có solid để export — lỗi có hint là đúng
      expect(String(e)).toMatch(/no 3D solids/);
      return;
    }
    const report = await validate(result.gltf);
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
    expect(result.stats.triangles).toBeGreaterThan(0);
  });

  it("deterministic: export hai lần byte-identical", () => {
    const spec = constructSpecSchema.parse(JSON.parse(readFileSync(path.join(examplesDir, "construct-cart.json"), "utf8")));
    expect(JSON.stringify(exportGltf(spec).gltf)).toBe(JSON.stringify(exportGltf(spec).gltf));
  });

  it("decomposeTrs tái tạo đúng ma trận placement (T·R·S)", () => {
    const m = composePlacement4([10, -20, 30], [25, -40, 70], [2, 3, 0.5]);
    const trs = decomposeTrs(m);
    expect(trs.sheared).toBe(false);
    const p: Vec3 = [1.5, -2, 4];
    const expected = transformPoint(m, p);
    const scaled: Vec3 = [p[0] * trs.s[0], p[1] * trs.s[1], p[2] * trs.s[2]];
    const r = rotate(trs.r, scaled);
    const got = [r[0] + trs.t[0], r[1] + trs.t[1], r[2] + trs.t[2]];
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
  });

  it("camera ORTHO glTF chiếu điểm world ra ĐÚNG pixel canvas của renderer SVG", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: [{ id: "b", type: "box", size: [200, 200, 200] }],
      camera: { orbit: { azimuth: 33, elevation: 21, roll: 4 }, zoom: 1.7 },
      place: { at: [700, 800], scale: 1.3 },
    });
    const { gltf } = exportGltf(spec, { unitScale: 0.01 });
    for (const p of [[0, 0, 0], [100, 50, -80], [-120, 200, 60]] as Vec3[]) {
      const a = gltfProject(gltf, p, 0.01);
      const b = engineProject(spec, p);
      expect(a[0]).toBeCloseTo(b[0], 2);
      expect(a[1]).toBeCloseTo(b[1], 2);
    }
  });

  it("camera PERSPECTIVE khớp renderer (place ở giữa canvas)", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: [{ id: "b", type: "box", size: [200, 200, 200] }],
      camera: { orbit: { azimuth: -25, elevation: 30 }, projection: "perspective", distance: 900, zoom: 1.2 },
    });
    const { gltf } = exportGltf(spec, { unitScale: 0.01 });
    for (const p of [[0, 0, 0], [100, 80, -90], [-100, -60, 100]] as Vec3[]) {
      const a = gltfProject(gltf, p, 0.01);
      const b = engineProject(spec, p, 900);
      expect(a[0]).toBeCloseTo(b[0], 1);
      expect(a[1]).toBeCloseTo(b[1], 1);
    }
  });

  it("trần mặt giống compile SVG (chặn DoS qua exporter)", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, type: "sphere", r: 10, segments: 64, at: [i * 30, 0, 0] })),
    });
    expect(() => exportGltf(spec)).toThrow(/faces \(max/);
  });

  it("vật liệu: sRGB → linear, unlit tuỳ chọn", () => {
    const spec = constructSpecSchema.parse({ version: 1, solids: [{ id: "b", type: "box", size: [10, 10, 10], fill: "#808080" }] });
    const { gltf } = exportGltf(spec, { unlit: true });
    const mat = (gltf.materials as { pbrMetallicRoughness: { baseColorFactor: number[] }; extensions?: object }[])[0];
    expect(mat.pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(0.2159, 3);
    expect(mat.extensions).toEqual({ KHR_materials_unlit: {} });
    expect(gltf.extensionsUsed).toContain("KHR_materials_unlit");
  });

  it("motion walk → glTF animation hợp lệ, node figure có sampler", async () => {
    const motion = motionSpecSchema.parse(JSON.parse(readFileSync(path.join(examplesDir, "motion-stroll.json"), "utf8")));
    const result = exportMotionGltf(motion);
    const report = await validate(result.gltf);
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
    const anims = result.gltf.animations as { channels: { target: { node: number; path: string } }[] }[];
    expect(anims).toHaveLength(1);
    expect(result.stats.frames).toBe(36);
    expect(result.stats.animatedNodes).toBeGreaterThan(10);
    // Camera dolly (zoom) không animate được trong glTF core → cảnh báo trung thực
    expect(result.warnings.join()).toMatch(/lens params/);
    const nodes = result.gltf.nodes as { name: string }[];
    const animatedNames = new Set(anims[0].channels.map((c) => nodes[c.target.node].name));
    expect(animatedNames.has("pip:kneeL")).toBe(true); // skin: animation trên XƯƠNG
    expect(animatedNames.has("ground")).toBe(false);
  });

  it("SKIN đúng hình học: đỉnh skinned (joint·IBM·v) tại frame k khớp mesh world của engine", () => {
    const motion = motionSpecSchema.parse(JSON.parse(readFileSync(path.join(examplesDir, "motion-stroll.json"), "utf8")));
    const unit = 0.01;
    const { gltf } = exportMotionGltf(motion, {}, { unitScale: unit });
    const g = gltf as unknown as GltfDoc;
    const buf = Buffer.from((g.buffers[0].uri as string).split(",")[1], "base64");
    const read = (ai: number): number[] => {
      const a = g.accessors[ai];
      const v = g.bufferViews[a.bufferView];
      const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type as "SCALAR"]! * a.count;
      const size = a.componentType === 5126 ? 4 : a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
      return Array.from({ length: n }, (_, i) => {
        const o = v.byteOffset + i * size;
        return a.componentType === 5126 ? buf.readFloatLE(o) : a.componentType === 5121 ? buf.readUInt8(o) : a.componentType === 5123 ? buf.readUInt16LE(o) : buf.readUInt32LE(o);
      });
    };
    const frame = 20;
    // TRS local của node tại frame (animation ghi đè TRS tĩnh)
    const local = g.nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
    for (const ch of g.animations![0].channels) {
      const smp = g.animations![0].samplers[ch.sampler];
      const out = read(smp.output);
      const k = ch.target.path === "rotation" ? 4 : 3;
      (local[ch.target.node] as Record<string, number[]>)[ch.target.path[0]] = out.slice(frame * k, frame * k + k);
    }
    const trsMat = (l: { t: number[]; r: number[]; s: number[] }) => {
      const [x, y, z, w] = l.r;
      const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      return [R[0] * l.s[0], R[1] * l.s[1], R[2] * l.s[2], l.t[0], R[3] * l.s[0], R[4] * l.s[1], R[5] * l.s[2], l.t[1], R[6] * l.s[0], R[7] * l.s[1], R[8] * l.s[2], l.t[2], 0, 0, 0, 1];
    };
    const parentOf = new Map<number, number>();
    g.nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
    const globalOf = (i: number): number[] => {
      const m = trsMat(local[i]);
      const p = parentOf.get(i);
      return p === undefined ? m : (mul4(globalOf(p), m) as number[]);
    };
    const meshNode = g.nodes.findIndex((n) => n.skin !== undefined);
    const skin = g.skins![g.nodes[meshNode].skin!];
    const ibm = read(skin.inverseBindMatrices);
    const jointMats = skin.joints.map((j, k) => {
      const cm = ibm.slice(k * 16, k * 16 + 16);
      const rowMajor = Array.from({ length: 16 }, (_, i) => cm[(i % 4) * 4 + Math.floor(i / 4)]);
      return mul4(globalOf(j), rowMajor);
    });
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const prim of g.meshes[g.nodes[meshNode].mesh!].primitives) {
      const pos = read(prim.attributes.POSITION);
      const jn = read(prim.attributes.JOINTS_0!);
      for (let v = 0; v < pos.length / 3; v++) {
        const p = transformPoint(jointMats[jn[v * 4]], [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
        for (let c = 0; c < 3; c++) {
          lo[c] = Math.min(lo[c], p[c]);
          hi[c] = Math.max(hi[c], p[c]);
        }
      }
    }
    // Engine: mesh world của mọi solid "pip:*" tại cùng frame
    const scene = evaluateMotionAt(prepareMotion(motion), frame / motion.fps);
    const expanded = expandParts(scene);
    const elo = [Infinity, Infinity, Infinity];
    const ehi = [-Infinity, -Infinity, -Infinity];
    for (const sol of expanded.solids.filter((x) => x.id.startsWith("pip:"))) {
      const m = expanded.worldMatrixById.get(sol.id)!;
      // Mẫu điểm: đỉnh mesh thật của primitive
      const verts = sol.type === "box" ? boxVerts(sol.size) : sol.type === "sphere" ? sphereVerts(sol.r, sol.segments) : cylVerts(sol.type === "cylinder" ? sol.r : 1, sol.type === "cylinder" ? sol.h : 1, sol.type === "cylinder" ? sol.segments : 12);
      for (const v of verts) {
        const p = transformPoint(m, v);
        for (let c = 0; c < 3; c++) {
          elo[c] = Math.min(elo[c], p[c] * unit);
          ehi[c] = Math.max(ehi[c], p[c] * unit);
        }
      }
    }
    for (let c = 0; c < 3; c++) {
      expect(lo[c]).toBeCloseTo(elo[c], 4);
      expect(hi[c]).toBeCloseTo(ehi[c], 4);
    }
  });

  it("holdFrames 2 → sampler STEP (giữ pose on twos)", () => {
    const motion = motionSpecSchema.parse({
      version: 1,
      duration: 1,
      holdFrames: 2,
      scene: { version: 1, solids: [{ id: "b", type: "box", size: [10, 10, 10] }] },
      tracks: [{ target: "solids.b.at.0", keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
    });
    const anims = exportMotionGltf(motion).gltf.animations as { samplers: { interpolation: string }[] }[];
    expect(anims[0].samplers.every((s) => s.interpolation === "STEP")).toBe(true);
  });
});
