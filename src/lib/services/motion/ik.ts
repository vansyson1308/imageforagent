import { AppError } from "@/lib/services/apiError";
import type { Mat4, Vec3 } from "@/lib/services/construct/types";
import type { ConstructSpec, Part } from "@/lib/validation/constructSchema";
import type { Rig } from "@/lib/validation/motionSchema";
import { buildFigure, figureProportions, NEUTRAL_POSE, type JointName } from "@/lib/services/construct/partFigure";
import { expandParts, groupMatricesOf, partPlacementMatrix } from "@/lib/services/construct/partsExpand";
import {
  composePlacement4,
  cross3,
  invertAffine4,
  normalize3,
  sub3,
  transformPoint,
} from "@/lib/services/construct/math3d";

/**
 * ik — IK 2 xương GIẢI TÍCH cho part figure (không lặp, deterministic).
 * 1. Target (điểm hoặc solid đang chạy) → hệ LOCAL của part.
 * 2. Định lý cos trong mặt phẳng (gốc, target, pole) → vị trí khớp giữa.
 * 3. Hướng xương → góc khớp theo quy ước pose của figure
 *    R = Rz(c)·Rx(a) đưa (0,−1,0) tới d: a = −asin(d_z), c = atan2(d_x, −d_y)
 *    — gốc trong hệ cha, khớp giữa trong hệ đã xoay của gốc.
 * 4. Chân: cổ chân = nghịch đảo tổng xoay chuỗi ⇒ bàn chân phẳng.
 * Pose lưu = tuyệt đối − A-pose trung tính (pose figure CỘNG vào neutral).
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

type IkRig = Extract<Rig, { type: "ik" }>;
type FigurePart = Extract<Part, { type: "figure" }>;

const DEG = 180 / Math.PI;

const CHAINS: Record<IkRig["limb"], { root: JointName; mid: JointName; end: JointName }> = {
  armL: { root: "shoulderL", mid: "elbowL", end: "wristL" },
  armR: { root: "shoulderR", mid: "elbowR", end: "wristR" },
  legL: { root: "hipL", mid: "kneeL", end: "ankleL" },
  legR: { root: "hipR", mid: "kneeR", end: "ankleR" },
};

/** Khối xoay 3×3 (row-major) của Mat4. */
const rot3 = (m: Mat4): number[] => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
const mul3 = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};
const transpose3 = (a: number[]): number[] => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const apply3 = (a: number[], v: Vec3): Vec3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];

/** Rz(c)·Rx(a) dạng 3×3 (độ). */
function rzrx(aDeg: number, cDeg: number): number[] {
  const a = aDeg / DEG;
  const c = cDeg / DEG;
  const rx = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rz = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return mul3(rz, rx);
}

/** Góc (x, z) đưa xương nghỉ (0,−1,0) tới hướng d (trong hệ cha). */
export function boneAngles(d: Vec3): [number, number] {
  const n = normalize3(d);
  const a = -Math.asin(Math.max(-1, Math.min(1, n[2]))) * DEG;
  const c = Math.atan2(n[0], -n[1]) * DEG;
  return [a, c];
}

/** Euler (x, y, z) độ cho R = Rz·Ry·Rx (thứ tự poseRotation). */
function eulerZYX(R: number[]): [number, number, number] {
  const sy = Math.max(-1, Math.min(1, -R[6]));
  const beta = Math.asin(sy);
  const alpha = Math.atan2(R[7], R[8]);
  const gamma = Math.atan2(R[3], R[0]);
  return [alpha * DEG, beta * DEG, gamma * DEG];
}

/** Vị trí world của solid (kể cả "part:segment") + offset local. */
function solidWorldPoint(spec: ConstructSpec, ref: string, offset: Vec3): Vec3 {
  const expanded = expandParts(spec);
  const m = expanded.worldMatrixById.get(ref);
  if (m) return transformPoint(m, offset);
  const solid = expanded.solids.find((s) => s.id === ref);
  if (!solid) {
    err(
      `IK target solid "${ref}" not found.`,
      `Target a solid id or a part segment like "cart" or "wl:hub". Defined: ${expanded.solids.map((s) => s.id).slice(0, 20).join(", ")}.`,
    );
  }
  return transformPoint(composePlacement4(solid.at, solid.rotate, solid.scale), offset);
}

function windowWeight(rig: IkRig, t: number, duration: number): number {
  const start = rig.start;
  const end = rig.end ?? duration;
  if (t < start || t > end) return 0;
  if (rig.fade <= 0) return rig.weight;
  const f = Math.min(rig.fade, (end - start) / 2);
  const ramp = f <= 0 ? 1 : Math.min(1, (t - start) / f, (end - t) / f);
  // smoothstep — hoà mềm, không giật vận tốc
  const s = ramp * ramp * (3 - 2 * ramp);
  return rig.weight * s;
}

export interface IkSolution {
  readonly root: Vec3;
  readonly mid: Vec3;
  readonly end?: Vec3;
  /** true nếu target ngoài tầm với (duỗi thẳng về phía target). */
  readonly clamped: boolean;
}

export function applyIk(spec: ConstructSpec, rig: IkRig, t: number, duration: number): IkSolution | null {
  const w = windowWeight(rig, t, duration);
  if (w <= 0) return null;
  const part = spec.parts.find((p) => p.id === rig.part);
  if (!part) {
    err(`IK rig: no part with id "${rig.part}".`, `Defined parts: ${spec.parts.map((p) => p.id).join(", ") || "(none)"}.`);
  }
  if (part.type !== "figure") err(`IK rig: part "${rig.part}" is a ${part.type}, not a figure.`, 'IK drives a part of type "figure".');
  const fig = part as FigurePart;
  const chain = CHAINS[rig.limb];
  const isLeg = rig.limb.startsWith("leg");

  // ---------- Target → hệ part ----------
  const targetWorld: Vec3 = Array.isArray(rig.target)
    ? (rig.target as unknown as Vec3)
    : solidWorldPoint(spec, rig.target.solid, rig.target.offset as unknown as Vec3);
  const partM = partPlacementMatrix(fig, groupMatricesOf(spec));
  const inv = invertAffine4(partM);
  if (!inv) err(`IK rig on "${fig.id}": part placement is degenerate.`, "Use a non-zero scale.");
  let target = transformPoint(inv, targetWorld);
  const dims = figureProportions(fig.height, fig.headCount);
  // Chân: target là ĐẾ chân → cổ chân cao hơn footH
  if (isLeg) target = [target[0], target[1] + dims.footH, target[2]];

  // ---------- Khung xương hiện tại (pose sau tracks) ----------
  const build = buildFigure(fig);
  const joints = new Map(build.joints!.map((j) => [j.name, j]));
  const rootJ = joints.get(chain.root)!;
  const midJ = joints.get(chain.mid)!;
  const endJ = joints.get(chain.end)!;
  const parentWorld = joints.get(rootJ.parent!)!.world;
  // Khung cha của khớp gốc: world(parent) · translation(pivot gốc)
  const pivot: Vec3 = [rootJ.local[3], rootJ.local[7], rootJ.local[11]];
  const P = transformPoint(parentWorld, pivot);
  const L1 = Math.hypot(midJ.local[3], midJ.local[7], midJ.local[11]);
  const L2 = Math.hypot(endJ.local[3], endJ.local[7], endJ.local[11]);

  // ---------- Định lý cos ----------
  const toT = sub3(target, P);
  let d = Math.hypot(...toT);
  const minD = Math.abs(L1 - L2) + 1e-6;
  const maxD = (L1 + L2) * 0.9999;
  const clamped = d > maxD;
  d = Math.min(maxD, Math.max(minD, d));
  const dir: Vec3 = normalize3(toT[0] === 0 && toT[1] === 0 && toT[2] === 0 ? [0, -1, 0] : toT);
  const pole: Vec3 = (rig.pole as unknown as Vec3 | undefined) ?? (isLeg ? [0, 0, 1] : [0, -0.3, -1]);
  // Hướng gập = thành phần của pole vuông góc trục gốc→target
  const pd = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2];
  let b = sub3(pole, [dir[0] * pd, dir[1] * pd, dir[2] * pd]);
  if (Math.hypot(...b) < 1e-6) b = normalize3(cross3(dir, [1, 0, 0]));
  b = normalize3(b);
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const J: Vec3 = [
    P[0] + L1 * (cosA * dir[0] + sinA * b[0]),
    P[1] + L1 * (cosA * dir[1] + sinA * b[1]),
    P[2] + L1 * (cosA * dir[2] + sinA * b[2]),
  ];
  const E: Vec3 = [P[0] + dir[0] * d, P[1] + dir[1] * d, P[2] + dir[2] * d];

  // ---------- Hướng xương → góc khớp ----------
  const Rp = rot3(parentWorld);
  const upper = apply3(transpose3(Rp), sub3(J, P));
  const [a1, c1] = boneAngles(upper);
  const Rroot = rzrx(a1, c1);
  const Rmid0 = mul3(Rp, Rroot);
  const lower = apply3(transpose3(Rmid0), sub3(E, J));
  const [a2, c2] = boneAngles(lower);

  const setJoint = (name: JointName, abs: [number, number, number]) => {
    const neutral = NEUTRAL_POSE[name] ?? [0, 0, 0];
    const want: [number, number, number] = [abs[0] - neutral[0], abs[1] - neutral[1], abs[2] - neutral[2]];
    const cur = fig.pose[name];
    const base: [number, number, number] = cur === undefined ? [0, 0, 0] : typeof cur === "number" ? [0, 0, cur] : [cur[0], cur[1], cur[2]];
    fig.pose[name] = [base[0] + (want[0] - base[0]) * w, base[1] + (want[1] - base[1]) * w, base[2] + (want[2] - base[2]) * w];
  };
  setJoint(chain.root, [a1, 0, c1]);
  setJoint(chain.mid, [a2, 0, c2]);
  if (isLeg) {
    // Bàn chân phẳng: R_ankle = (Rp·Rhip·Rknee)ᵀ
    const Rchain = mul3(Rmid0, rzrx(a2, c2));
    setJoint(chain.end, eulerZYX(transpose3(Rchain)));
  }
  return { root: P, mid: J, end: E, clamped };
}
