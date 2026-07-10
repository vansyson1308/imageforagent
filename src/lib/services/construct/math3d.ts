import type { Mat4, Vec3 } from "@/lib/services/construct/types";

/**
 * math3d — Vec3/Mat4 tự viết (không dùng gl-matrix — đó là transitive dep
 * riêng của path-bool). Quy ước:
 * - World y-up, right-handed.
 * - Mat4 row-major 16 phần tử, điểm là VECTOR CỘT: p' = M·p.
 * - mul4(a, b) = a·b — áp dụng b TRƯỚC, a SAU.
 */

const DEG = Math.PI / 180;

// ---------- Vec3 ----------

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize3(v: Vec3): Vec3 {
  const len = length3(v);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---------- Mat4 ----------

// prettier-ignore
export const IDENTITY_4: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** a·b — điểm đi qua b trước rồi a. */
export function mul4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

export function translation4(t: Vec3): Mat4 {
  // prettier-ignore
  return [
    1, 0, 0, t[0],
    0, 1, 0, t[1],
    0, 0, 1, t[2],
    0, 0, 0, 1,
  ];
}

export function scaling4(s: Vec3): Mat4 {
  // prettier-ignore
  return [
    s[0], 0, 0, 0,
    0, s[1], 0, 0,
    0, 0, s[2], 0,
    0, 0, 0, 1,
  ];
}

export function rotationX4(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, c, -s, 0,
    0, s, c, 0,
    0, 0, 0, 1,
  ];
}

export function rotationY4(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  // prettier-ignore
  return [
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

export function rotationZ4(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  // prettier-ignore
  return [
    c, -s, 0, 0,
    s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Ghép placement solid: scale → rotate X → Y → Z → translate
 * (khớp trực giác "xoay khối đã scale rồi đặt vào at").
 */
export function composePlacement4(
  at: Vec3,
  rotateDeg: Vec3,
  scale: number | Vec3,
): Mat4 {
  const s: Vec3 = typeof scale === "number" ? [scale, scale, scale] : scale;
  let m = scaling4(s);
  if (rotateDeg[0]) m = mul4(rotationX4(rotateDeg[0]), m);
  if (rotateDeg[1]) m = mul4(rotationY4(rotateDeg[1]), m);
  if (rotateDeg[2]) m = mul4(rotationZ4(rotateDeg[2]), m);
  return mul4(translation4(at), m);
}

/** Biến đổi điểm (w=1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** Biến đổi hướng (w=0) — dùng cho normal khi matrix là rotation thuần. */
export function transformDirection(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

/**
 * Normal mặt đa giác theo Newell's method — ổn định với đa giác gần suy biến,
 * đúng cho mọi đa giác phẳng (CCW nhìn từ ngoài → normal hướng ra ngoài).
 */
export function faceNormal(vertices: readonly Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1, z1] = vertices[i];
    const [x2, y2, z2] = vertices[(i + 1) % vertices.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return normalize3([nx, ny, nz]);
}

export function centroid3(vertices: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [vx, vy, vz] of vertices) {
    x += vx;
    y += vy;
    z += vz;
  }
  const n = vertices.length;
  return [x / n, y / n, z / n];
}
