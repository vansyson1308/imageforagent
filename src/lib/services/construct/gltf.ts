import type { Mat4, Mesh, Vec3 } from "@/lib/services/construct/types";
import type { ConstructSpec } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { expandParts } from "@/lib/services/construct/partsExpand";
import { createShapeResolver } from "@/lib/services/construct/resolve2d";
import { buildSolidMeshes, type ExportMesh } from "@/lib/services/construct/sceneMeshes";
import { triangulateFace } from "@/lib/services/construct/triangulate";
import { composePlacement4, cross3, faceNormal, normalize3 } from "@/lib/services/construct/math3d";
import { CAMERA_PRESETS, autoDistance } from "@/lib/services/construct/camera";
import { meshRadius } from "@/lib/services/construct/geometry3d";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";

/**
 * gltf — exporter glTF 2.0 (JSON + buffer nhúng base64) cho construct scene:
 * CẦU NỐI từ engine vector sang renderer 3D thật (Blender Cycles/EEVEE,
 * three.js, Unreal). Pure + deterministic.
 *
 * - Mỗi solid (kể cả solid sinh từ part "hero:head") = 1 node, mesh LOCAL
 *   (chính mesh renderer SVG dùng — sceneMeshes.ts) + TRS tách từ ma trận
 *   world → animation chỉ là sampler TRS, không bake đỉnh.
 * - CSG: mesh kết quả + placement của node csg (operand động → bake t=0).
 * - Vật liệu theo fill: baseColor sRGB→linear, hoặc KHR_materials_unlit
 *   (look phẳng giống vector). Camera khớp khung hình SVG (orbit + zoom +
 *   place); đèn = KHR_lights_punctual directional theo spec.light.
 * - Hệ trục: engine y-up right-handed = glTF; unitScale mặc định 0.01
 *   (figure 170 đơn vị ≈ người 1.7 m).
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

export interface GltfOptions {
  /** Đơn vị engine → mét. */
  readonly unitScale?: number;
  /** KHR_materials_unlit — màu phẳng như bản vector. */
  readonly unlit?: boolean;
  /** Canvas logic (khung camera) — default 16:9 1920×1080. */
  readonly canvas?: { readonly w: number; readonly h: number };
}

export interface GltfStats {
  readonly nodes: number;
  readonly meshes: number;
  readonly triangles: number;
  readonly materials: number;
  readonly bytes: number;
  readonly frames: number;
  readonly animatedNodes: number;
}

export interface GltfResult {
  readonly gltf: Record<string, unknown>;
  readonly stats: GltfStats;
  readonly warnings: string[];
}

// ---------- Scene → mesh + ma trận ----------

interface PreparedScene {
  readonly exportMeshes: ExportMesh[];
  readonly spec: ConstructSpec;
  readonly radius: number;
  readonly warnings: string[];
}

function prepareScene(spec: ConstructSpec): PreparedScene {
  const warnings: string[] = [];
  const expanded = expandParts(spec);
  warnings.push(...expanded.warnings);
  const full: ConstructSpec = { ...spec, shapes: expanded.shapes, solids: expanded.solids };
  const allIds = [...full.shapes.map((s) => s.id), ...full.solids.map((s) => s.id)];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) err(`Duplicate id "${id}".`, "Ids are global across shapes and solids — rename one.");
    seen.add(id);
  }
  const t0 = performance.now();
  const checkClock = (stage: string) => {
    if (performance.now() - t0 > CONSTRUCT_LIMITS.maxCompileMs) {
      err(`glTF export exceeded ${CONSTRUCT_LIMITS.maxCompileMs}ms at "${stage}".`, 'Reduce "segments" or scene size.');
    }
  };
  const resolver = createShapeResolver({
    shapeMap: new Map(full.shapes.map((s) => [s.id, s])),
    allIds,
    precision: full.precision,
    warnings,
    checkClock,
  });
  const meshes = buildSolidMeshes(
    {
      spec: full,
      resolver,
      solidMap: new Map(full.solids.map((s) => [s.id, s])),
      allIds,
      worldMatrixById: expanded.worldMatrixById,
      warnings,
      checkClock,
    },
    true,
  );
  if (meshes.exportMeshes!.length === 0) {
    err("Nothing to export — the scene has no 3D solids.", "glTF exports solids/parts; 2D shapes are SVG-only.");
  }
  if (full.shapes.length > 0) {
    warnings.push("2D shapes (backgrounds, clouds, foreground mist) are SVG-only and are not exported to glTF.");
  }
  const radius = meshRadius([...meshes.worldMeshById.values()].map((e) => e.mesh));
  return { exportMeshes: meshes.exportMeshes!, spec: full, radius, warnings };
}

/** Ma trận world của mọi solid được export tại một scene (per frame). */
function matricesOf(spec: ConstructSpec, ids: readonly string[]): Map<string, Mat4> {
  const expanded = expandParts(spec);
  const byId = new Map(expanded.solids.map((s) => [s.id, s]));
  const out = new Map<string, Mat4>();
  for (const id of ids) {
    const solid = byId.get(id);
    if (!solid) continue;
    out.set(id, expanded.worldMatrixById.get(id) ?? composePlacement4(solid.at, solid.rotate, solid.scale));
  }
  return out;
}

/** Chữ ký hình học (bỏ placement/màu/effects) — phát hiện geometry animate. */
function geometrySignatures(spec: ConstructSpec): Map<string, string> {
  const expanded = expandParts(spec);
  const out = new Map<string, string>();
  for (const s of expanded.solids) {
    const geom: Record<string, unknown> = { ...s };
    for (const k of ["at", "rotate", "scale", "fill", "effects", "shadow", "group", "shading"]) delete geom[k];
    out.set(s.id, JSON.stringify(geom));
  }
  return out;
}

// ---------- Toán TRS ----------

type Quat = [number, number, number, number];

export interface Trs {
  readonly t: Vec3;
  readonly r: Quat;
  readonly s: Vec3;
  readonly sheared: boolean;
}

/** Tách ma trận row-major affine → T·R·S (quaternion xyzw). */
export function decomposeTrs(m: Mat4): Trs {
  const col = (j: number): Vec3 => [m[j], m[4 + j], m[8 + j]];
  const c0 = col(0);
  const c1 = col(1);
  const c2 = col(2);
  let sx = Math.hypot(...c0);
  const sy = Math.hypot(...c1);
  const sz = Math.hypot(...c2);
  const det =
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1]);
  if (det < 0) sx = -sx;
  const r0: Vec3 = [c0[0] / sx, c0[1] / sx, c0[2] / sx];
  const r1: Vec3 = [c1[0] / sy, c1[1] / sy, c1[2] / sy];
  const r2: Vec3 = [c2[0] / sz, c2[1] / sz, c2[2] / sz];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sheared = Math.abs(dot(r0, r1)) > 1e-4 || Math.abs(dot(r0, r2)) > 1e-4 || Math.abs(dot(r1, r2)) > 1e-4;
  // R[row][col]: cột j = r_j
  const R = (row: number, c: number) => [r0, r1, r2][c][row];
  const trace = R(0, 0) + R(1, 1) + R(2, 2);
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(R(2, 1) - R(1, 2)) / s, (R(0, 2) - R(2, 0)) / s, (R(1, 0) - R(0, 1)) / s, 0.25 * s];
  } else if (R(0, 0) > R(1, 1) && R(0, 0) > R(2, 2)) {
    const s = Math.sqrt(1 + R(0, 0) - R(1, 1) - R(2, 2)) * 2;
    q = [0.25 * s, (R(0, 1) + R(1, 0)) / s, (R(0, 2) + R(2, 0)) / s, (R(2, 1) - R(1, 2)) / s];
  } else if (R(1, 1) > R(2, 2)) {
    const s = Math.sqrt(1 + R(1, 1) - R(0, 0) - R(2, 2)) * 2;
    q = [(R(0, 1) + R(1, 0)) / s, 0.25 * s, (R(1, 2) + R(2, 1)) / s, (R(0, 2) - R(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + R(2, 2) - R(0, 0) - R(1, 1)) * 2;
    q = [(R(0, 2) + R(2, 0)) / s, (R(1, 2) + R(2, 1)) / s, 0.25 * s, (R(1, 0) - R(0, 1)) / s];
  }
  const n = Math.hypot(...q) || 1;
  q = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  return { t: [m[3], m[7], m[11]], r: q, s: [sx, sy, sz], sheared };
}

/** Quaternion từ ma trận xoay 3×3 cho bởi 3 cột. */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  // prettier-ignore
  const m: Mat4 = [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    0, 0, 0, 1,
  ];
  return decomposeTrs(m).r as Quat;
}

// ---------- Camera ----------

interface CameraFrame {
  readonly t: Vec3;
  readonly r: Quat;
  readonly camera: Record<string, unknown>;
  readonly zoomKey: string;
}

function cameraFrame(spec: ConstructSpec, radius: number, canvas: { w: number; h: number }, unit: number): CameraFrame {
  const orbit = spec.camera.orbit ?? CAMERA_PRESETS[spec.camera.preset ?? "isometric"];
  const DEG = Math.PI / 180;
  const az = orbit.azimuth * DEG;
  const el = orbit.elevation * DEG;
  const roll = (orbit.roll ?? 0) * DEG;
  // View V = Rz(roll)·Rx(el)·Ry(−az): world→view. Camera world = Vᵀ → trục
  // camera trong world = các HÀNG của V (≡ cột của Vᵀ).
  const ry = (a: number): number[] => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const rx = (a: number): number[] => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rz = (a: number): number[] => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const mul3 = (a: number[], b: number[]) => {
    const o = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return o;
  };
  const V = mul3(rz(roll), mul3(rx(el), ry(-az)));
  const right: Vec3 = [V[0], V[1], V[2]];
  const up: Vec3 = [V[3], V[4], V[5]];
  const back: Vec3 = [V[6], V[7], V[8]]; // +z view = từ scene về camera

  const s = spec.place.scale;
  const zoom = spec.camera.zoom;
  // Điểm view-space hiện ở GIỮA canvas (place.at lệch tâm → camera lệch theo)
  const vx = (canvas.w / 2 - spec.place.at[0]) / (s * zoom);
  const vy = -(canvas.h / 2 - spec.place.at[1]) / (s * zoom);

  let D: number;
  let camera: Record<string, unknown>;
  if (spec.camera.projection === "perspective") {
    D = spec.camera.distance ?? autoDistance(radius);
    // screen = x·D/(D−z)·zoom ⇒ tiêu cự f = D·zoom·s (px canvas)
    const yfov = 2 * Math.atan(canvas.h / 2 / (D * zoom * s));
    camera = {
      type: "perspective",
      perspective: { yfov, aspectRatio: canvas.w / canvas.h, znear: Math.max(0.001, D * 0.01 * unit), zfar: (D + radius * 4) * unit },
    };
  } else {
    D = Math.max(1, radius * 4);
    camera = {
      type: "orthographic",
      orthographic: {
        xmag: (canvas.w / 2 / (zoom * s)) * unit,
        ymag: (canvas.h / 2 / (zoom * s)) * unit,
        znear: 0.001,
        zfar: (D + radius * 4) * unit,
      },
    };
  }
  const pos: Vec3 = [
    (right[0] * vx + up[0] * vy + back[0] * D) * unit,
    (right[1] * vx + up[1] * vy + back[1] * D) * unit,
    (right[2] * vx + up[2] * vy + back[2] * D) * unit,
  ];
  return { t: pos, r: quatFromBasis(right, up, back), camera, zoomKey: JSON.stringify(camera) };
}

// ---------- Màu ----------

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------- Buffer builder ----------

class BinBuilder {
  private chunks: Buffer[] = [];
  private length = 0;
  readonly bufferViews: Record<string, unknown>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  private push(data: Buffer, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.length += pad;
    }
    const view: Record<string, unknown> = { buffer: 0, byteOffset: this.length, byteLength: data.length };
    if (target) view.target = target;
    this.chunks.push(data);
    this.length += data.length;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  floatAccessor(values: readonly number[], type: "SCALAR" | "VEC3" | "VEC4", opts: { target?: number; minMax?: boolean } = {}): number {
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    const view = this.push(buf, opts.target);
    const n = type === "SCALAR" ? 1 : type === "VEC3" ? 3 : 4;
    const acc: Record<string, unknown> = { bufferView: view, componentType: 5126, count: values.length / n, type };
    if (opts.minMax) {
      // min/max theo float32 thật (validator so với dữ liệu đã làm tròn)
      const f = (v: number) => Math.fround(v);
      const min = Array.from({ length: n }, () => Infinity);
      const max = Array.from({ length: n }, () => -Infinity);
      for (let i = 0; i < values.length; i++) {
        const c = i % n;
        min[c] = Math.min(min[c], f(values[i]));
        max[c] = Math.max(max[c], f(values[i]));
      }
      acc.min = min;
      acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  indexAccessor(indices: readonly number[], vertexCount: number): number {
    const wide = vertexCount > 65535;
    const buf = Buffer.alloc(indices.length * (wide ? 4 : 2));
    indices.forEach((v, i) => (wide ? buf.writeUInt32LE(v, i * 4) : buf.writeUInt16LE(v, i * 2)));
    const view = this.push(buf, 34963);
    this.accessors.push({ bufferView: view, componentType: wide ? 5125 : 5123, count: indices.length, type: "SCALAR" });
    return this.accessors.length - 1;
  }

  finish(): Buffer {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.chunks.push(Buffer.alloc(pad));
    return Buffer.concat(this.chunks);
  }
}

// ---------- Mesh → primitives ----------

interface Primitive {
  readonly fill: string;
  readonly positions: number[];
  readonly normals: number[];
  readonly indices: number[];
}

function meshPrimitives(em: ExportMesh, unit: number, defaultFill: string): { prims: Primitive[]; degraded: boolean } {
  const mesh: Mesh = em.local;
  const byFill = new Map<string, Primitive>();
  let degraded = false;
  // Smooth solids: normal đỉnh trung bình các mặt bên (không nhãn), nắp phẳng
  const smoothNormals = new Map<number, Vec3>();
  if (em.smoothKind) {
    for (const face of mesh.faces) {
      if (face.label) continue;
      const n = faceNormal(face.vertices.map((i) => mesh.vertices[i]));
      for (const vi of face.vertices) {
        const cur = smoothNormals.get(vi) ?? [0, 0, 0];
        smoothNormals.set(vi, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
      }
    }
    for (const [k, v] of smoothNormals) smoothNormals.set(k, normalize3(v));
  }
  for (const face of mesh.faces) {
    const outer = face.vertices.map((i) => mesh.vertices[i]);
    const holes = (face.holes ?? []).map((ring) => ring.map((i) => mesh.vertices[i]));
    const n = faceNormal(outer);
    if (!Number.isFinite(n[0]) || (n[0] === 0 && n[1] === 0 && n[2] === 0)) continue;
    const fill = face.fill ?? em.fill ?? defaultFill;
    let prim = byFill.get(fill);
    if (!prim) {
      prim = { fill, positions: [], normals: [], indices: [] };
      byFill.set(fill, prim);
    }
    const useSmooth = em.smoothKind !== null && !face.label && holes.length === 0;
    if (useSmooth || (holes.length === 0 && outer.length === 3)) {
      // Fan trực tiếp trên đỉnh gốc (mặt lồi) — normal đỉnh khi smooth
      const base = prim.positions.length / 3;
      face.vertices.forEach((vi) => {
        const v = mesh.vertices[vi];
        prim!.positions.push(v[0] * unit, v[1] * unit, v[2] * unit);
        const nn = useSmooth ? smoothNormals.get(vi) ?? n : n;
        prim!.normals.push(nn[0], nn[1], nn[2]);
      });
      for (let i = 1; i + 1 < face.vertices.length; i++) prim.indices.push(base, base + i, base + i + 1);
      continue;
    }
    const tri = triangulateFace(outer, holes, n);
    if (tri.degraded) degraded = true;
    for (const t of tri.triangles) {
      // Giữ winding CCW theo normal mặt (triangulate có thể đảo)
      const tn = cross3(
        [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]],
        [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]],
      );
      const order = tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
      const base = prim.positions.length / 3;
      for (const k of order) {
        prim.positions.push(t[k][0] * unit, t[k][1] * unit, t[k][2] * unit);
        prim.normals.push(n[0], n[1], n[2]);
      }
      prim.indices.push(base, base + 1, base + 2);
    }
  }
  return { prims: [...byFill.values()].filter((p) => p.indices.length > 0), degraded };
}

// ---------- Export ----------

export interface GltfAnimationInput {
  /** Scene đã đánh giá tại từng frame (cùng topology với frame 0). */
  readonly scenes: readonly ConstructSpec[];
  readonly fps: number;
  /** STEP khi animate on twos (giữ pose), LINEAR khi on ones. */
  readonly step: boolean;
}

function fmtQuat(q: Quat): Quat {
  return [q[0], q[1], q[2], q[3]];
}

export function exportGltf(spec: ConstructSpec, opts: GltfOptions = {}, anim?: GltfAnimationInput): GltfResult {
  const unit = opts.unitScale ?? 0.01;
  const canvas = opts.canvas ?? { w: 1920, h: 1080 };
  const scene0 = anim?.scenes[0] ?? spec;
  const prep = prepareScene(scene0);
  const warnings = [...prep.warnings];
  const bin = new BinBuilder();

  // Vật liệu: fill → index; gradient tác giả → màu stop giữa
  const gradientColor = new Map(
    prep.spec.gradients.map((g) => [g.id, g.stops[Math.floor(g.stops.length / 2)].color] as const),
  );
  const materials: Record<string, unknown>[] = [];
  const materialIndex = new Map<string, number>();
  const materialOf = (fill: string): number => {
    const cached = materialIndex.get(fill);
    if (cached !== undefined) return cached;
    let hex = fill;
    const url = /^url\(#([\w-]+)\)$/.exec(fill);
    if (url) {
      const g = gradientColor.get(url[1]);
      if (!g) warnings.push(`Fill "${fill}" has no gradient in the spec — exported as neutral grey.`);
      hex = g ?? "#c0c0c0";
    }
    const rgb = hexRgb(hex) ?? [192, 192, 192];
    const mat: Record<string, unknown> = {
      name: fill,
      pbrMetallicRoughness: {
        baseColorFactor: [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]), 1],
        metallicFactor: 0,
        roughnessFactor: 0.8,
      },
    };
    if (opts.unlit) mat.extensions = { KHR_materials_unlit: {} };
    materials.push(mat);
    materialIndex.set(fill, materials.length - 1);
    return materials.length - 1;
  };

  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  let triangles = 0;
  let anyDegraded = false;
  let anySheared = false;
  const meshNodeOf = new Map<string, number>();
  for (const em of prep.exportMeshes) {
    const { prims, degraded } = meshPrimitives(em, unit, "#c0c0c0");
    if (degraded) anyDegraded = true;
    if (prims.length === 0) continue;
    const primitives = prims.map((p) => {
      triangles += p.indices.length / 3;
      return {
        attributes: {
          POSITION: bin.floatAccessor(p.positions, "VEC3", { target: 34962, minMax: true }),
          NORMAL: bin.floatAccessor(p.normals, "VEC3", { target: 34962 }),
        },
        indices: bin.indexAccessor(p.indices, p.positions.length / 3),
        material: materialOf(p.fill),
        mode: 4,
      };
    });
    meshes.push({ name: em.solidId, primitives });
    const trs = decomposeTrs(em.matrix);
    if (trs.sheared) anySheared = true;
    nodes.push({
      name: em.solidId,
      mesh: meshes.length - 1,
      translation: [trs.t[0] * unit, trs.t[1] * unit, trs.t[2] * unit],
      rotation: fmtQuat(trs.r),
      scale: [...trs.s],
    });
    meshNodeOf.set(em.solidId, nodes.length - 1);
  }
  if (anyDegraded) warnings.push("Some concave faces triangulated in degraded (fan) mode — check the mesh in your 3D tool.");
  if (anySheared) warnings.push("A non-uniformly scaled FK chain produced shear — TRS export approximates it.");
  if (scene0.place.rotate !== 0) warnings.push('"place.rotate" (canvas rotation) is not exported — roll the camera instead.');

  // Camera + light
  const cams: Record<string, unknown>[] = [];
  const cam0 = cameraFrame(prep.spec, prep.radius, canvas, unit);
  cams.push({ name: "camera", ...cam0.camera });
  nodes.push({ name: "camera", camera: 0, translation: [...cam0.t], rotation: fmtQuat(cam0.r) });
  const cameraNode = nodes.length - 1;

  const dir = normalize3(prep.spec.light.direction);
  // Directional light chiếu dọc −Z local ⇒ trục z node = −dir
  const zAxis: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const helper: Vec3 = Math.abs(zAxis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const xAxis = normalize3(cross3(helper, zAxis));
  const yAxis = cross3(zAxis, xAxis);
  nodes.push({
    name: "sun",
    rotation: fmtQuat(quatFromBasis(xAxis, yAxis, zAxis)),
    extensions: { KHR_lights_punctual: { light: 0 } },
  });

  // Animation
  const animations: Record<string, unknown>[] = [];
  let animatedNodes = 0;
  const frames = anim?.scenes.length ?? 1;
  if (anim && anim.scenes.length > 1) {
    const ids = prep.exportMeshes.map((e) => e.solidId).filter((id) => meshNodeOf.has(id));
    const csgIds = new Set(prep.spec.solids.filter((s) => s.type === "csg").map((s) => s.id));
    const sig0 = geometrySignatures(anim.scenes[0]);
    const geomWarned = new Set<string>();
    const tracks = new Map<string, { t: number[]; r: number[]; s: number[] }>();
    for (const id of ids) tracks.set(id, { t: [], r: [], s: [] });
    const camTrack = { t: [] as number[], r: [] as number[] };
    let zoomWarned = false;
    anim.scenes.forEach((sc, fi) => {
      const mats = matricesOf(sc, ids.filter((id) => !csgIds.has(id)));
      for (const id of csgIds) {
        const node = sc.solids.find((s) => s.id === id);
        if (node) mats.set(id, composePlacement4(node.at, node.rotate, node.scale));
      }
      if (fi > 0) {
        const sig = geometrySignatures(sc);
        for (const [id, s] of sig) {
          if (sig0.get(id) !== s && !geomWarned.has(id)) {
            geomWarned.add(id);
            warnings.push(`Geometry of "${id}" changes over time — glTF node animation carries transforms only; its mesh is baked at t=0.`);
          }
        }
      }
      for (const id of ids) {
        const m = mats.get(id)!;
        const trs = decomposeTrs(m);
        const tr = tracks.get(id)!;
        tr.t.push(trs.t[0] * unit, trs.t[1] * unit, trs.t[2] * unit);
        // Chọn dấu quaternion liên tục (slerp đường ngắn)
        const prev = tr.r.length >= 4 ? tr.r.slice(-4) : null;
        let q = trs.r;
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        tr.r.push(...q);
        tr.s.push(...trs.s);
      }
      const cf = cameraFrame(sc, prep.radius, canvas, unit);
      if (cf.zoomKey !== cam0.zoomKey && !zoomWarned) {
        zoomWarned = true;
        warnings.push("Camera zoom/fov changes over time — glTF core cannot animate lens params; exported at the t=0 value (dolly the camera in your 3D tool).");
      }
      camTrack.t.push(...cf.t);
      const prev = camTrack.r.length >= 4 ? camTrack.r.slice(-4) : null;
      let q = cf.r;
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      camTrack.r.push(...q);
    });

    const times = anim.scenes.map((_, i) => i / anim.fps);
    const input = bin.floatAccessor(times, "SCALAR", { minMax: true });
    const samplers: Record<string, unknown>[] = [];
    const channels: Record<string, unknown>[] = [];
    const interpolation = anim.step ? "STEP" : "LINEAR";
    const constant = (arr: number[], n: number) => arr.every((v, i) => Math.abs(v - arr[i % n]) < 1e-7);
    const addChannel = (node: number, path: string, values: number[], type: "VEC3" | "VEC4") => {
      samplers.push({ input, output: bin.floatAccessor(values, type), interpolation });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    for (const id of ids) {
      const tr = tracks.get(id)!;
      const node = meshNodeOf.get(id)!;
      let moved = false;
      if (!constant(tr.t, 3)) {
        addChannel(node, "translation", tr.t, "VEC3");
        moved = true;
      }
      if (!constant(tr.r, 4)) {
        addChannel(node, "rotation", tr.r, "VEC4");
        moved = true;
      }
      if (!constant(tr.s, 3)) {
        addChannel(node, "scale", tr.s, "VEC3");
        moved = true;
      }
      if (moved) animatedNodes++;
    }
    if (!constant(camTrack.t, 3)) addChannel(cameraNode, "translation", camTrack.t, "VEC3");
    if (!constant(camTrack.r, 4)) addChannel(cameraNode, "rotation", camTrack.r, "VEC4");
    if (channels.length > 0) animations.push({ name: "shot", samplers, channels });
  }

  const data = bin.finish();
  const extensionsUsed = ["KHR_lights_punctual", ...(opts.unlit ? ["KHR_materials_unlit"] : [])];
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "storyboard-studio construct (glTF exporter v1)" },
    extensionsUsed,
    extensions: {
      KHR_lights_punctual: { lights: [{ name: "sun", type: "directional", color: [1, 0.98, 0.94], intensity: 3 }] },
    },
    scene: 0,
    scenes: [{ name: "construct", nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    cameras: cams,
    accessors: bin.accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: data.length, uri: `data:application/octet-stream;base64,${data.toString("base64")}` }],
    ...(animations.length > 0 && { animations }),
  };

  return {
    gltf,
    stats: {
      nodes: nodes.length,
      meshes: meshes.length,
      triangles,
      materials: materials.length,
      bytes: data.length,
      frames,
      animatedNodes,
    },
    warnings,
  };
}
