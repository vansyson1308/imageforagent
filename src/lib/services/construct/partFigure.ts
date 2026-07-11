import type { Mat4, Vec3 } from "@/lib/services/construct/types";
import {
  IDENTITY_4,
  mul4,
  rotationX4,
  rotationY4,
  rotationZ4,
  translation4,
} from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";
import type { Part } from "@/lib/validation/constructSchema";
import type { GeneratedSolid, PartBuild } from "@/lib/services/construct/partWheel";

/**
 * partFigure — Layer 5b: nhân vật khớp nối bằng FORWARD KINEMATICS.
 * Nguyên lý gốc: mỗi khớp chỉ là MỘT phép xoay quanh pivot; ghép chuỗi
 * cha→con (mul4) là ra dáng người. Tỷ lệ theo đơn vị đầu (head-unit) nội
 * suy chibiness c = (8 − headCount)/6 — 8 đầu tả thực → 2 đầu chibi.
 *
 * Neutral = A-POSE (tay xuôi chếch ±20°): đọc là "người thư giãn", tránh
 * tay xuyên thân khi chibi. Pose user CỘNG THÊM vào A-pose.
 * Hệ local: gốc tại chân (đất), y-up, mặt hướng +z; xương chi dọc −y.
 */

type FigurePart = Extract<Part, { type: "figure" }>;

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Khớp hợp lệ (thứ tự cha trước con). */
const JOINT_NAMES = [
  "spine",
  "neck",
  "shoulderL",
  "shoulderR",
  "elbowL",
  "elbowR",
  "wristL",
  "wristR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
  "ankleL",
  "ankleR",
] as const;

type JointName = (typeof JOINT_NAMES)[number];

/** A-pose mặc định (độ, trục z): tay chếch ra ±20°. */
const NEUTRAL_POSE: Partial<Record<JointName, Vec3>> = {
  shoulderL: [0, 0, 20],
  shoulderR: [0, 0, -20],
};

function poseRotation(deg: Vec3): Mat4 {
  // Cùng thứ tự composePlacement4: Rx trước → Ry → Rz
  let m: Mat4 = IDENTITY_4;
  if (deg[0]) m = rotationX4(deg[0]);
  if (deg[1]) m = mul4(rotationY4(deg[1]), m);
  if (deg[2]) m = mul4(rotationZ4(deg[2]), m);
  return m;
}

export function buildFigure(part: FigurePart): PartBuild {
  // ---------- Pose: validate tên khớp + chuẩn hoá scalar → [0,0,z] ----------
  const pose = new Map<JointName, Vec3>();
  for (const [name, value] of Object.entries(part.pose)) {
    if (!(JOINT_NAMES as readonly string[]).includes(name)) {
      err(
        `Figure "${part.id}": unknown joint "${name}".`,
        `Valid joints: ${JOINT_NAMES.join(", ")}.`,
      );
    }
    pose.set(name as JointName, typeof value === "number" ? [0, 0, value] : value);
  }
  const angleOf = (name: JointName): Vec3 => {
    const neutral = NEUTRAL_POSE[name] ?? ([0, 0, 0] as Vec3);
    const user = pose.get(name) ?? ([0, 0, 0] as Vec3);
    return [neutral[0] + user[0], neutral[1] + user[1], neutral[2] + user[2]];
  };

  // ---------- Tỷ lệ head-unit + chibiness ----------
  const head = part.height / part.headCount;
  const c = Math.min(1, Math.max(0, (8 - part.headCount) / 6));
  const neckLen = head * lerp(0.3, 0.08, c);
  // Thô theo head-unit, rồi RESCALE để tổng đúng height
  const torsoRaw = head * lerp(2.6, 1.4, c);
  const thighRaw = head * lerp(2.0, 1.0, c);
  const shinRaw = head * lerp(1.8, 1.0, c);
  const footHRaw = head * 0.22;
  const bodyBudget = part.height - head - neckLen;
  const s = bodyBudget / (torsoRaw + thighRaw + shinRaw + footHRaw);
  const torso = torsoRaw * s;
  const thigh = thighRaw * s;
  const shin = shinRaw * s;
  const footH = footHRaw * s;

  const upperArm = head * lerp(1.5, 0.9, c) * s;
  const forearm = head * lerp(1.5, 0.9, c) * s;
  const shoulderW = head * lerp(2.0, 1.3, c);
  const hipW = head * lerp(1.5, 1.1, c);
  const limbR = head * lerp(0.18, 0.3, c);
  const legR = limbR * 1.15;
  const torsoR = hipW * 0.52;
  const handR = limbR * 1.25;
  const headR = head * 0.5;

  const fills = {
    skin: part.fills?.skin ?? "#e8b88a",
    shirt: part.fills?.shirt ?? "#3a6ea5",
    pants: part.fills?.pants ?? "#41436a",
    shoes: part.fills?.shoes ?? "#2b2b33",
  };

  // ---------- FK: ma trận world (local part) từng khớp ----------
  const hipsY = footH + shin + thigh;
  const M = new Map<string, Mat4>();
  const joint = (name: JointName | "hips", parent: Mat4, pivot: Vec3): Mat4 => {
    const rot = name === "hips" ? IDENTITY_4 : poseRotation(angleOf(name));
    const m = mul4(parent, mul4(translation4(pivot), rot));
    M.set(name, m);
    return m;
  };

  const hips = joint("hips", IDENTITY_4, [0, hipsY, 0]);
  const spine = joint("spine", hips, [0, torso * 0.5, 0]);
  const neck = joint("neck", spine, [0, torso * 0.5, 0]);
  const shoulderL = joint("shoulderL", spine, [shoulderW * 0.4, torso * 0.42, 0]);
  const shoulderR = joint("shoulderR", spine, [-shoulderW * 0.4, torso * 0.42, 0]);
  const elbowL = joint("elbowL", shoulderL, [0, -upperArm, 0]);
  const elbowR = joint("elbowR", shoulderR, [0, -upperArm, 0]);
  const wristL = joint("wristL", elbowL, [0, -forearm, 0]);
  const wristR = joint("wristR", elbowR, [0, -forearm, 0]);
  const hipL = joint("hipL", hips, [hipW * 0.32, 0, 0]);
  const hipR = joint("hipR", hips, [-hipW * 0.32, 0, 0]);
  const kneeL = joint("kneeL", hipL, [0, -thigh, 0]);
  const kneeR = joint("kneeR", hipR, [0, -thigh, 0]);
  const ankleL = joint("ankleL", kneeL, [0, -shin, 0]);
  const ankleR = joint("ankleR", kneeR, [0, -shin, 0]);

  // ---------- Solids (~15): capsule = cylinder smooth + sphere khớp ----------
  const p = (seg: string) => `${part.id}:${seg}`;
  const D = {
    at: [0, 0, 0] as [number, number, number],
    rotate: [0, 0, 0] as [number, number, number],
    scale: 1,
    shading: "auto" as const,
    shadow: true,
  };
  const solids: GeneratedSolid[] = [];
  /** Cylinder (trục y) đại diện xương: đặt GIỮA đoạn từ khớp dọc −y. */
  const bone = (id: string, jointM: Mat4, len: number, r: number, fill: string) => {
    solids.push({
      solid: { ...D, id: p(id), type: "cylinder", r, h: len, segments: 12, fill },
      localM: mul4(jointM, translation4([0, -len / 2, 0])),
    });
  };
  const ball = (id: string, jointM: Mat4, r: number, fill: string, offset: Vec3 = [0, 0, 0]) => {
    solids.push({
      solid: { ...D, id: p(id), type: "sphere", r, segments: 12, fill },
      localM: mul4(jointM, translation4(offset)),
    });
  };

  // Thân: cylinder từ hips lên hết torso
  solids.push({
    solid: { ...D, id: p("torso"), type: "cylinder", r: torsoR, h: torso, segments: 14, fill: fills.shirt },
    localM: mul4(hips, translation4([0, torso * 0.5, 0])),
  });
  // Đầu + cổ (cổ mọc LÊN từ khớp neck — không dùng bone() vốn hướng −y)
  const neckBoneLen = neckLen + headR * 0.3;
  solids.push({
    solid: { ...D, id: p("neckBone"), type: "cylinder", r: limbR * 0.9, h: neckBoneLen, segments: 12, fill: fills.skin },
    localM: mul4(neck, translation4([0, neckBoneLen / 2, 0])),
  });
  ball("head", neck, headR, fills.skin, [0, neckLen + headR * 0.55, 0]);
  // Tay
  bone("upperArmL", shoulderL, upperArm, limbR, fills.shirt);
  bone("upperArmR", shoulderR, upperArm, limbR, fills.shirt);
  bone("forearmL", elbowL, forearm, limbR * 0.9, fills.skin);
  bone("forearmR", elbowR, forearm, limbR * 0.9, fills.skin);
  ball("handL", wristL, handR, fills.skin);
  ball("handR", wristR, handR, fills.skin);
  // Chân
  bone("thighL", hipL, thigh, legR, fills.pants);
  bone("thighR", hipR, thigh, legR, fills.pants);
  bone("shinL", kneeL, shin, legR * 0.85, fills.pants);
  bone("shinR", kneeR, shin, legR * 0.85, fills.pants);
  // Bàn chân: box chìa về +z (mặt trước)
  const footLen = head * 0.55;
  for (const [id, ankle] of [
    ["footL", ankleL],
    ["footR", ankleR],
  ] as const) {
    solids.push({
      solid: {
        ...D,
        id: p(id),
        type: "box",
        size: [legR * 2.1, footH, footLen],
        fill: fills.shoes,
      },
      localM: mul4(ankle, translation4([0, -footH / 2, footLen * 0.22])),
    });
  }

  return { shapes: [], solids };
}
