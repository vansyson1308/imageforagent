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

/** Xúc xắc CSG: khối trắng khoét pip cầu đỏ trên 3 mặt nhìn thấy (1-2-3). */
export const DICE_SPEC = {
  version: 1,
  solids: [
    { id: "body", type: "box", size: [260, 260, 260], at: [0, 130, 0], fill: "#f5f0e6" },
    // Mặt top (+y): 1 pip
    { id: "p1", type: "sphere", r: 34, segments: 12, at: [0, 262, 0], fill: "#c0392b", shading: "faceted" },
    // Mặt front (+z): 2 pip chéo
    { id: "p2a", type: "sphere", r: 30, segments: 12, at: [-60, 190, 132], fill: "#c0392b", shading: "faceted" },
    { id: "p2b", type: "sphere", r: 30, segments: 12, at: [60, 70, 132], fill: "#c0392b", shading: "faceted" },
    // Mặt right (+x): 3 pip chéo
    { id: "p3a", type: "sphere", r: 30, segments: 12, at: [132, 200, -60], fill: "#c0392b", shading: "faceted" },
    { id: "p3b", type: "sphere", r: 30, segments: 12, at: [132, 130, 0], fill: "#c0392b", shading: "faceted" },
    { id: "p3c", type: "sphere", r: 30, segments: 12, at: [132, 60, 60], fill: "#c0392b", shading: "faceted" },
    {
      id: "dice",
      type: "csg",
      op: "difference",
      of: ["body", "p1", "p2a", "p2b", "p3a", "p3b", "p3c"],
    },
  ],
  shadow: { opacity: 0.2 },
  light: { direction: [0.6, -1.7, 0.9] },
  camera: { orbit: { azimuth: 32, elevation: 24 } },
  place: { at: [960, 600], scale: 1.1 },
} as const;

/** HERO: người đẩy xe hàng — dùng đủ CSG + exact depth + shadow + parts FK. */
export const CART_SPEC = {
  version: 1,
  solids: [
    { id: "ground", type: "box", size: [1300, 20, 700], at: [0, -10, 0], fill: "#8fbf6a", shadow: false },
    { id: "bodyOuter", type: "box", size: [260, 110, 190], fill: "#b07a45" },
    { id: "bodyInner", type: "box", size: [236, 104, 166], at: [0, 20, 0], fill: "#7a5230" },
    { id: "cargo", type: "csg", op: "difference", of: ["bodyOuter", "bodyInner"], at: [40, 150, 0] },
    { id: "axle", type: "cylinder", r: 9, h: 250, rotate: [90, 0, 0], at: [40, 62, 0], fill: "#5a5a64", shading: "faceted" },
    { id: "handleL", type: "box", size: [190, 11, 13], at: [-120, 165, 62], rotate: [0, 0, 18], fill: "#8a6238" },
    { id: "handleR", type: "box", size: [190, 11, 13], at: [-120, 165, -62], rotate: [0, 0, 18], fill: "#8a6238" },
  ],
  parts: [
    { id: "wl", type: "wheel", radius: 62, width: 22, boreRadius: 8, spokes: 6, at: [40, 62, 106], fills: { tire: "#3a3a42", hub: "#c0392b", spokes: "#d9d9e0" } },
    { id: "wr", type: "wheel", radius: 62, width: 22, boreRadius: 8, spokes: 6, at: [40, 62, -106], fills: { tire: "#3a3a42", hub: "#c0392b", spokes: "#d9d9e0" } },
    {
      id: "hero",
      type: "figure",
      height: 310,
      headCount: 3,
      at: [-300, 0, 0],
      rotate: [0, -90, 0],
      pose: {
        spine: [22, 0, 0],
        shoulderL: [-62, 0, -18],
        shoulderR: [-62, 0, 18],
        elbowL: [-12, 0, 0],
        elbowR: [-12, 0, 0],
        hipL: [-18, 0, 0],
        kneeL: [24, 0, 0],
        hipR: [14, 0, 0],
      },
      fills: { shirt: "#c0392b", pants: "#2c3e50" },
    },
    { id: "tr", type: "tree", trunkH: 110, trunkR: 13, canopyR: 62, style: "blob", at: [480, 0, -180] },
  ],
  shadow: { opacity: 0.28 },
  light: { direction: [0.5, -1.7, 1.0] },
  camera: { orbit: { azimuth: 28, elevation: 17 } },
  place: { at: [960, 660], scale: 1.0 },
} as const;

/** Shading showcase: light.mode gradient + blob shadow trên bộ khối cơ bản. */
export const SHADING_SPEC = {
  version: 1,
  solids: [
    { id: "cube", type: "box", size: [180, 180, 180], at: [-260, 90, 0], fill: "#e07b39" },
    { id: "ball", type: "sphere", r: 100, segments: 20, at: [0, 100, 0], fill: "#3a86c8" },
    { id: "cone1", type: "cone", r: 95, h: 210, segments: 20, at: [250, 105, 0], fill: "#59a14f" },
  ],
  light: { direction: [0.8, -1.5, 0.6], mode: "gradient" },
  shadow: { style: "blob", opacity: 0.3 },
  camera: { orbit: { azimuth: 30, elevation: 20 } },
  place: { at: [960, 600], scale: 1.1 },
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
