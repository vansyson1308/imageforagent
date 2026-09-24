import type { Mat4, Vec2, Vec3 } from "@/lib/services/construct/types";
import type { ConstructSpec, Part } from "@/lib/validation/constructSchema";
import { buildFigure, figureProportions } from "@/lib/services/construct/partFigure";
import { groupMatricesOf, partPlacementMatrix } from "@/lib/services/construct/partsExpand";
import { mul4, transformDirection, transformPoint } from "@/lib/services/construct/math3d";
import { CAMERA_PRESETS, autoDistance, projectViewPoint, viewMatrix, type Projection } from "@/lib/services/construct/camera";
import { prepareExportScene } from "@/lib/services/construct/sceneMeshes";

/**
 * pose2d — skeleton OpenPose (COCO-18) XUẤT THẲNG từ khớp FK của figure:
 * không ước lượng pose, không sai số detector — điều kiện "pose" chính xác
 * tuyệt đối cho ControlNet/VACE. Toạ độ là pixel canvas logic (sau camera
 * + place), cùng hệ với SVG frame. Pure + deterministic.
 * Quy ước OpenPose: "R/L" là bên phải/trái CỦA NHÂN VẬT (figure nhìn +z,
 * trái = +x local — khớp tên L/R của engine).
 */

type FigurePart = Extract<Part, { type: "figure" }>;

/** Thứ tự COCO-18 của OpenPose. */
export const COCO18 = [
  "nose", "neck", "rShoulder", "rElbow", "rWrist", "lShoulder", "lElbow", "lWrist",
  "rHip", "rKnee", "rAnkle", "lHip", "lKnee", "lAnkle", "rEye", "lEye", "rEar", "lEar",
] as const;

/** Cặp chi (0-based) + bảng màu chuẩn của bộ vẽ OpenPose/controlnet_aux. */
export const COCO18_LIMBS: readonly [number, number][] = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
export const COCO18_COLORS: readonly string[] = [
  "#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00", "#00ff00", "#00ff55", "#00ffaa",
  "#00ffff", "#00aaff", "#0055ff", "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055",
];

export interface PersonPose {
  readonly id: string;
  /** [x, y, confidence] × 18 — confidence 0 khi điểm quay lưng khỏi camera. */
  readonly keypoints: readonly [number, number, number][];
}

export interface PoseFrame {
  readonly canvas: { readonly w: number; readonly h: number };
  readonly people: readonly PersonPose[];
}

function sceneProjection(spec: ConstructSpec): { view: Mat4; projection: Projection } {
  const orbit = spec.camera.orbit ?? CAMERA_PRESETS[spec.camera.preset ?? "isometric"];
  const view = viewMatrix({ azimuth: orbit.azimuth, elevation: orbit.elevation, roll: orbit.roll ?? 0 });
  if (spec.camera.projection !== "perspective") return { view, projection: { kind: "orthographic", zoom: spec.camera.zoom } };
  // Cùng auto-distance như compile (bán kính mesh của scene)
  const distance = spec.camera.distance ?? autoDistance(prepareExportScene(spec).radius);
  return { view, projection: { kind: "perspective", zoom: spec.camera.zoom, distance } };
}

function toCanvas(spec: ConstructSpec, screen: Vec2): Vec2 {
  const r = (spec.place.rotate * Math.PI) / 180;
  const s = spec.place.scale;
  return [
    spec.place.at[0] + s * (Math.cos(r) * screen[0] - Math.sin(r) * screen[1]),
    spec.place.at[1] + s * (Math.sin(r) * screen[0] + Math.cos(r) * screen[1]),
  ];
}

export function extractPoses(spec: ConstructSpec, canvas: { w: number; h: number } = { w: 1920, h: 1080 }): PoseFrame {
  const { view, projection } = sceneProjection(spec);
  const groupM = groupMatricesOf(spec);
  const people: PersonPose[] = [];
  for (const part of spec.parts) {
    if (part.type !== "figure") continue;
    const fig = part as FigurePart;
    const partM = partPlacementMatrix(fig, groupM);
    const build = buildFigure(fig);
    const J = new Map(build.joints!.map((j) => [j.name, mul4(partM, j.world)]));
    const at = (name: string): Vec3 => transformPoint(J.get(name)!, [0, 0, 0]);
    const dims = figureProportions(fig.height, fig.headCount);
    const neckM = J.get("neck")!;
    const headC = transformPoint(neckM, [0, dims.neckLen + dims.headR * 0.55, 0]);
    const R = dims.headR;
    const onHead = (x: number, y: number, z: number): Vec3 => transformPoint(neckM, [x, dims.neckLen + R * 0.55 + y, z]);
    const shL = at("shoulderL");
    const shR = at("shoulderR");
    const points: Record<(typeof COCO18)[number], Vec3> = {
      nose: onHead(0, -R * 0.1, R),
      neck: [(shL[0] + shR[0]) / 2, (shL[1] + shR[1]) / 2, (shL[2] + shR[2]) / 2],
      rShoulder: shR,
      rElbow: at("elbowR"),
      rWrist: at("wristR"),
      lShoulder: shL,
      lElbow: at("elbowL"),
      lWrist: at("wristL"),
      rHip: at("hipR"),
      rKnee: at("kneeR"),
      rAnkle: at("ankleR"),
      lHip: at("hipL"),
      lKnee: at("kneeL"),
      lAnkle: at("ankleL"),
      rEye: onHead(-R * 0.34, R * 0.12, R * 0.93),
      lEye: onHead(R * 0.34, R * 0.12, R * 0.93),
      rEar: onHead(-R, 0, 0),
      lEar: onHead(R, 0, 0),
    };
    // Mặt: điểm quay lưng camera (vector tâm đầu → điểm có z_view < 0) ⇒ c = 0
    const facing = (p: Vec3) => {
      const d = transformDirection(view, [p[0] - headC[0], p[1] - headC[1], p[2] - headC[2]]);
      return d[2] > -R * 0.05;
    };
    const faceKeys = new Set(["nose", "rEye", "lEye", "rEar", "lEar"]);
    const keypoints = COCO18.map((name): [number, number, number] => {
      const p = points[name];
      const sp = projectViewPoint(transformPoint(view, p), projection).screen;
      const c = toCanvas(spec, sp);
      const visible = faceKeys.has(name) ? facing(p) : true;
      return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100, visible ? 1 : 0];
    });
    people.push({ id: fig.id, keypoints });
  }
  return { canvas, people };
}

/** JSON đúng định dạng OpenPose (pose_keypoints_2d phẳng [x,y,c,…]). */
export function toOpenPoseJson(frame: PoseFrame): Record<string, unknown> {
  return {
    version: 1.3,
    canvas_width: frame.canvas.w,
    canvas_height: frame.canvas.h,
    people: frame.people.map((p) => ({ person_id: [-1], name: p.id, pose_keypoints_2d: p.keypoints.flat() })),
  };
}

/**
 * Ảnh skeleton kiểu OpenPose (nền đen, chi màu chuẩn α 0.6, khớp tròn) —
 * đúng dạng ảnh điều kiện mà ControlNet-openpose nhận. SVG fragment.
 */
export function poseSkeletonSvg(frame: PoseFrame): string {
  const unit = Math.max(frame.canvas.w, frame.canvas.h) / 512;
  const parts: string[] = [`<rect width="${frame.canvas.w}" height="${frame.canvas.h}" fill="#000000"/>`];
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  for (const person of frame.people) {
    COCO18_LIMBS.forEach(([a, b], i) => {
      const pa = person.keypoints[a];
      const pb = person.keypoints[b];
      if (pa[2] === 0 || pb[2] === 0) return;
      parts.push(
        `<path d="M${f(pa[0])} ${f(pa[1])}L${f(pb[0])} ${f(pb[1])}" stroke="${COCO18_COLORS[i]}" stroke-opacity="0.6" stroke-width="${f(unit * 8)}" stroke-linecap="round" fill="none"/>`,
      );
    });
    person.keypoints.forEach((k, i) => {
      if (k[2] === 0) return;
      parts.push(`<circle cx="${f(k[0])}" cy="${f(k[1])}" r="${f(unit * 4)}" fill="${COCO18_COLORS[i]}"/>`);
    });
  }
  return parts.join("\n");
}
