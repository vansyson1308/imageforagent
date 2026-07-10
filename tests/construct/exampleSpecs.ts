/**
 * 3 spec mẫu chính thức — dùng chung cho tests (C6) và examples/ (C8).
 * Mỗi spec minh hoạ một tầng của phương pháp kỷ hà:
 * gear = boolean 2D · house = isometric preset + extrude + cutout ·
 * rocket = full-3D orbit tự do + smooth shading.
 */

/** Logo bánh răng: union đĩa + răng sao, trừ lỗ trục. */
export const GEAR_SPEC = {
  version: 1,
  shapes: [
    { id: "disc", type: "circle", r: 220 },
    { id: "teeth", type: "star", points: 12, rOuter: 262, rInner: 214 },
    { id: "gearBody", type: "boolean", op: "union", of: ["disc", "teeth"] },
    { id: "hub", type: "circle", r: 80 },
    {
      id: "gear",
      type: "boolean",
      op: "difference",
      of: ["gearBody", "hub"],
      fill: "#F4B23C",
      stroke: "#2B2B33",
      strokeWidth: 6,
    },
  ],
  place: { at: [960, 540] },
} as const;

/** Nhà isometric: ground + walls + mái extrude từ profile đầu hồi + cutout cửa. */
export const HOUSE_SPEC = {
  version: 1,
  shapes: [
    {
      // Thân nhà = MỘT ngũ giác lồi (tường + đầu hồi) — khối lồi thì
      // painter's sort không bao giờ sai nội bộ
      id: "bodyProfile",
      type: "polygon",
      points: [
        [-140, 84],
        [140, 84],
        [140, -84],
        [0, -179],
        [-140, -84],
      ],
    },
    { id: "door", type: "rect", w: 56, h: 92, rx: 4 },
    { id: "window", type: "circle", r: 24 },
  ],
  solids: [
    { id: "ground", type: "box", size: [620, 24, 620], at: [0, -12, 0], fill: "#8FBF6A" },
    { id: "body", type: "extrude", profile: "bodyProfile", depth: 210, at: [0, 84, 0], fill: "#F2E3C6" },
    // Mái = 2 tấm box nghiêng đúng góc dốc atan(95/140) ≈ 34.16°
    { id: "roofR", type: "box", size: [190, 12, 250], rotate: [0, 0, -34.16], at: [73.9, 221.3, 0], fill: "#C24D3A" },
    { id: "roofL", type: "box", size: [190, 12, 250], rotate: [0, 0, 34.16], at: [-73.9, 221.3, 0], fill: "#C24D3A" },
    { id: "chimney", type: "box", size: [40, 90, 40], at: [80, 250, 40], fill: "#8A8A94" },
  ],
  cutouts: [
    { solid: "body", face: "front", shape: "door", at: [-60, 72], mode: "overlay", fill: "#5B3A24" },
    { solid: "body", face: "front", shape: "window", at: [0, -55], mode: "overlay", fill: "#7FB4D9" },
  ],
  camera: { preset: "isometric" },
  light: { tones: 3 },
  place: { at: [960, 640], scale: 1.05 },
} as const;

/** Tên lửa full-3D: camera orbit tự do, thân trụ smooth, cánh extrude. */
export const ROCKET_SPEC = {
  version: 1,
  shapes: [
    {
      id: "finProfile",
      type: "polygon",
      points: [
        [0, 0],
        [95, 55],
        [95, 130],
        [0, 95],
      ],
    },
    { id: "porthole", type: "circle", r: 34 },
  ],
  solids: [
    { id: "body", type: "cylinder", r: 70, h: 300, segments: 32, shading: "smooth", fill: "#E8E4DC" },
    { id: "nose", type: "cone", r: 70, h: 120, at: [0, 210, 0], shading: "smooth", fill: "#D9482B" },
    {
      id: "finR",
      type: "extrude",
      profile: "finProfile",
      depth: 14,
      at: [66, -215, 0],
      rotate: [0, 90, 0],
      fill: "#D9482B",
    },
    {
      id: "finL",
      type: "extrude",
      profile: "finProfile",
      depth: 14,
      at: [-66, -215, 0],
      rotate: [0, -90, 0],
      fill: "#D9482B",
    },
    { id: "nozzle", type: "cone", r: 46, rTop: 30, h: 44, at: [0, -172, 0], shading: "smooth", fill: "#6B6B75" },
  ],
  cutouts: [
    // Solid smooth: mọi nhãn face đều resolve về silhouette (decal trên mặt nhìn thấy)
    { solid: "body", face: "front", shape: "porthole", at: [0, -60], mode: "overlay", fill: "#7FB4D9" },
  ],
  camera: { orbit: { azimuth: 30, elevation: 15 }, zoom: 1.2 },
  light: { direction: [-0.6, -1, -0.3], tones: 3, ambient: 0.35 },
  place: { at: [960, 560], scale: 1.1 },
} as const;
