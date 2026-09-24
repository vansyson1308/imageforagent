import type { Mat4, Vec3 } from "@/lib/services/construct/types";
import {
  IDENTITY_4,
  mul4,
  rotationX4,
  rotationY4,
  rotationZ4,
  scaling4,
  translation4,
} from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";
import type { Part } from "@/lib/validation/constructSchema";
import type { FigureJoint, GeneratedSolid, PartBuild } from "@/lib/services/construct/partWheel";

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
export const JOINT_NAMES = [
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

export type JointName = (typeof JOINT_NAMES)[number];

/** A-pose mặc định (độ, trục z): tay chếch ra ±20°. */
export const NEUTRAL_POSE: Partial<Record<JointName, Vec3>> = {
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

/**
 * Tỷ lệ head-unit nội suy chibiness c = (8 − headCount)/6, RESCALE thân để
 * tổng đúng height. Export cho motion rigs (walk cần chiều dài chân để
 * chu kỳ bước khớp tốc độ — bàn chân không trượt).
 */
export function figureProportions(height: number, headCount: number) {
  const head = height / headCount;
  const c = Math.min(1, Math.max(0, (8 - headCount) / 6));
  const neckLen = head * lerp(0.3, 0.08, c);
  // Thô theo head-unit, rồi RESCALE để tổng đúng height
  const torsoRaw = head * lerp(2.6, 1.4, c);
  const thighRaw = head * lerp(2.0, 1.0, c);
  const shinRaw = head * lerp(1.8, 1.0, c);
  const footHRaw = head * 0.22;
  const bodyBudget = height - head - neckLen;
  const s = bodyBudget / (torsoRaw + thighRaw + shinRaw + footHRaw);
  const torso = torsoRaw * s;
  const thigh = thighRaw * s;
  const shin = shinRaw * s;
  const footH = footHRaw * s;
  return {
    head,
    neckLen,
    torso,
    thigh,
    shin,
    footH,
    /** Chiều cao khớp hông so với đất ở tư thế đứng thẳng. */
    hipsY: footH + shin + thigh,
    upperArm: head * lerp(1.5, 0.9, c) * s,
    forearm: head * lerp(1.5, 0.9, c) * s,
    shoulderW: head * lerp(2.0, 1.3, c),
    hipW: head * lerp(1.5, 1.1, c),
    limbR: head * lerp(0.18, 0.3, c),
    legR: head * lerp(0.18, 0.3, c) * 1.15,
    torsoR: head * lerp(1.5, 1.1, c) * 0.52,
    handR: head * lerp(0.18, 0.3, c) * 1.25,
    headR: head * 0.5,
  };
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
  const {
    head, neckLen, torso, thigh, shin, footH, upperArm, forearm,
    shoulderW, hipW, limbR, legR, torsoR, handR, headR,
  } = figureProportions(part.height, part.headCount);

  const fills = {
    skin: part.fills?.skin ?? "#e8b88a",
    shirt: part.fills?.shirt ?? "#3a6ea5",
    pants: part.fills?.pants ?? "#41436a",
    shoes: part.fills?.shoes ?? "#2b2b33",
  };

  // ---------- FK: ma trận world (local part) từng khớp ----------
  const hipsY = footH + shin + thigh;
  const M = new Map<string, Mat4>();
  const joints: FigureJoint[] = [];
  const jointOf = new Map<Mat4, string>();
  const joint = (name: JointName | "hips", parent: Mat4, pivot: Vec3): Mat4 => {
    const rot = name === "hips" ? IDENTITY_4 : poseRotation(angleOf(name));
    const local = mul4(translation4(pivot), rot);
    const m = mul4(parent, local);
    M.set(name, m);
    joints.push({ name, parent: jointOf.get(parent) ?? null, local, world: m });
    jointOf.set(m, name);
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
  /** Solid gắn vào khớp: localM = world(khớp) · offset (skin glTF dùng joint + offset). */
  const attach = (solid: GeneratedSolid["solid"], jointM: Mat4, offset: Mat4) => {
    solids.push({ solid, localM: mul4(jointM, offset), joint: jointOf.get(jointM), offset });
  };
  /** Cylinder (trục y) đại diện xương: đặt GIỮA đoạn từ khớp dọc −y. */
  const bone = (id: string, jointM: Mat4, len: number, r: number, fill: string) => {
    attach({ ...D, id: p(id), type: "cylinder", r, h: len, segments: 12, fill }, jointM, translation4([0, -len / 2, 0]));
  };
  const ball = (id: string, jointM: Mat4, r: number, fill: string, offset: Vec3 = [0, 0, 0]) => {
    attach({ ...D, id: p(id), type: "sphere", r, segments: 12, fill }, jointM, translation4(offset));
  };

  // Thân: cylinder từ hips lên hết torso
  attach(
    { ...D, id: p("torso"), type: "cylinder", r: torsoR, h: torso, segments: 14, fill: fills.shirt },
    hips,
    translation4([0, torso * 0.5, 0]),
  );
  // Đầu + cổ (cổ mọc LÊN từ khớp neck — không dùng bone() vốn hướng −y)
  const neckBoneLen = neckLen + headR * 0.3;
  attach(
    { ...D, id: p("neckBone"), type: "cylinder", r: limbR * 0.9, h: neckBoneLen, segments: 12, fill: fills.skin },
    neck,
    translation4([0, neckBoneLen / 2, 0]),
  );
  const headCenter: Vec3 = [0, neckLen + headR * 0.55, 0];
  ball("head", neck, headR, fills.skin, headCenter);
  // Khuôn mặt (tuỳ chọn): mắt + miệng là sphere dẹt gắn khớp neck, mặt
  // hướng +z. Biểu cảm = SCALE của offset → animate được cả trong glTF
  if (part.face) {
    const f = part.face;
    // Mặt SAU của chi tiết chạm đúng mặt cầu thật (nằm ngoài lưới facet
    // của đầu) → không xuyên khối: NNS xếp chi tiết SAU mọi mặt của đầu,
    // silhouette smooth của đầu không vẽ đè lên mắt/miệng
    const onHead = (x: number, y: number, halfDepth: number): Vec3 => [
      headCenter[0] + x,
      headCenter[1] + y,
      headCenter[2] + Math.sqrt(Math.max(0, headR * headR - x * x - y * y)) + halfDepth,
    ];
    const eyeR = headR * 0.13;
    for (const [id, side] of [
      ["eyeL", 1],
      ["eyeR", -1],
    ] as const) {
      attach(
        { ...D, id: p(id), type: "sphere", r: eyeR, segments: 10, fill: f.eyes, shading: "none", shadow: false, decalOf: p("head") },
        neck,
        mul4(
          translation4(onHead(side * headR * 0.34, headR * 0.12, eyeR * 0.3)),
          scaling4([1, Math.max(0.08, 1 - f.blink * 0.92), 0.3]),
        ),
      );
    }
    const mouthR = headR * 0.24;
    attach(
      { ...D, id: p("mouth"), type: "sphere", r: mouthR, segments: 10, fill: f.mouth, shading: "none", shadow: false, decalOf: p("head") },
      neck,
      mul4(
        translation4(onHead(0, -headR * 0.38, mouthR * 0.25)),
        scaling4([0.55 + 0.65 * f.mouthWide, 0.1 + 0.75 * f.mouthOpen, 0.25]),
      ),
    );
  }
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
    attach(
      { ...D, id: p(id), type: "box", size: [legR * 2.1, footH, footLen], fill: fills.shoes },
      ankle,
      translation4([0, -footH / 2, footLen * 0.22]),
    );
  }

  return { shapes: [], solids, joints };
}
