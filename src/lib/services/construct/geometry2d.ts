import type { Affine2D, Vec2 } from "@/lib/services/construct/types";

/**
 * geometry2d — primitive 2D → SVG path data + affine transform.
 * Mọi primitive emit dạng lệnh tuyệt đối M/L/C/Z (cung tròn nắn thành cubic
 * bezier) để path-bool và transform nhận input đồng nhất.
 */

// ---------- Định dạng số deterministic ----------

/**
 * Format số với precision cố định: không "-0", không exponent, cắt 0 thừa.
 * Đây là formatter DUY NHẤT của toàn pipeline — bảo đảm determinism.
 */
export function fmt(value: number, precision: number): string {
  const fixed = value.toFixed(precision);
  const trimmed = precision > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
  return trimmed === "-0" ? "0" : trimmed;
}

// ---------- Affine 2D ----------

export const IDENTITY_2D: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Nhân 2 affine: kết quả áp dụng n TRƯỚC rồi m SAU (m ∘ n). */
export function mulAffine(m: Affine2D, n: Affine2D): Affine2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function applyAffine(m: Affine2D, [x, y]: Vec2): Vec2 {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

const DEG = Math.PI / 180;

export interface Placement2D {
  readonly at?: Vec2;
  readonly rotate?: number; // degrees
  readonly scale?: number | Vec2;
  readonly skew?: Vec2; // degrees [x, y]
  readonly mirror?: "x" | "y";
}

/**
 * Ghép placement chuẩn của spec thành affine duy nhất.
 * Thứ tự áp dụng lên điểm: mirror → scale → skew → rotate → translate
 * (khớp trực giác "đặt hình đã biến đổi vào vị trí at").
 */
export function placementToAffine(p: Placement2D): Affine2D {
  let m = IDENTITY_2D;
  const [tx, ty] = p.at ?? [0, 0];
  m = mulAffine(m, { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
  if (p.rotate) {
    const cos = Math.cos(p.rotate * DEG);
    const sin = Math.sin(p.rotate * DEG);
    m = mulAffine(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  if (p.skew && (p.skew[0] || p.skew[1])) {
    m = mulAffine(m, {
      a: 1,
      b: Math.tan(p.skew[1] * DEG),
      c: Math.tan(p.skew[0] * DEG),
      d: 1,
      e: 0,
      f: 0,
    });
  }
  if (p.scale !== undefined && p.scale !== 1) {
    const [sx, sy] = typeof p.scale === "number" ? [p.scale, p.scale] : p.scale;
    m = mulAffine(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
  }
  if (p.mirror) {
    m = mulAffine(
      m,
      p.mirror === "x" ? { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 } : { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
    );
  }
  return m;
}

// ---------- Path segments (dạng trung gian, transform được) ----------

export type Segment2D =
  | { readonly kind: "M"; readonly to: Vec2 }
  | { readonly kind: "L"; readonly to: Vec2 }
  | { readonly kind: "C"; readonly c1: Vec2; readonly c2: Vec2; readonly to: Vec2 }
  | { readonly kind: "Z" };

export function transformSegments(segments: readonly Segment2D[], m: Affine2D): Segment2D[] {
  return segments.map((seg) => {
    switch (seg.kind) {
      case "M":
      case "L":
        return { ...seg, to: applyAffine(m, seg.to) };
      case "C":
        return {
          kind: "C",
          c1: applyAffine(m, seg.c1),
          c2: applyAffine(m, seg.c2),
          to: applyAffine(m, seg.to),
        };
      case "Z":
        return seg;
    }
  });
}

export function segmentsToPathData(segments: readonly Segment2D[], precision: number): string {
  const parts: string[] = [];
  for (const seg of segments) {
    switch (seg.kind) {
      case "M":
        parts.push(`M ${fmt(seg.to[0], precision)} ${fmt(seg.to[1], precision)}`);
        break;
      case "L":
        parts.push(`L ${fmt(seg.to[0], precision)} ${fmt(seg.to[1], precision)}`);
        break;
      case "C":
        parts.push(
          `C ${fmt(seg.c1[0], precision)} ${fmt(seg.c1[1], precision)} ${fmt(seg.c2[0], precision)} ${fmt(seg.c2[1], precision)} ${fmt(seg.to[0], precision)} ${fmt(seg.to[1], precision)}`,
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

export function countSegments(segments: readonly Segment2D[]): number {
  return segments.length;
}

// ---------- Primitives ----------

/** Hằng số bezier xấp xỉ cung tròn 90°: (4/3)·tan(π/8). */
const KAPPA = 0.5522847498307936;

/** Hình chữ nhật tâm (0,0), bo góc rx tuỳ chọn. */
export function rectPath(w: number, h: number, rx = 0): Segment2D[] {
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(rx, w / 2, h / 2);
  if (r <= 0) {
    return [
      { kind: "M", to: [x, y] },
      { kind: "L", to: [x + w, y] },
      { kind: "L", to: [x + w, y + h] },
      { kind: "L", to: [x, y + h] },
      { kind: "Z" },
    ];
  }
  const k = r * KAPPA;
  return [
    { kind: "M", to: [x + r, y] },
    { kind: "L", to: [x + w - r, y] },
    { kind: "C", c1: [x + w - r + k, y], c2: [x + w, y + r - k], to: [x + w, y + r] },
    { kind: "L", to: [x + w, y + h - r] },
    { kind: "C", c1: [x + w, y + h - r + k], c2: [x + w - r + k, y + h], to: [x + w - r, y + h] },
    { kind: "L", to: [x + r, y + h] },
    { kind: "C", c1: [x + r - k, y + h], c2: [x, y + h - r + k], to: [x, y + h - r] },
    { kind: "L", to: [x, y + r] },
    { kind: "C", c1: [x, y + r - k], c2: [x + r - k, y], to: [x + r, y] },
    { kind: "Z" },
  ];
}

/** Ellipse tâm (0,0) bằng 4 cung cubic. */
export function ellipsePath(rx: number, ry: number): Segment2D[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { kind: "M", to: [rx, 0] },
    { kind: "C", c1: [rx, ky], c2: [kx, ry], to: [0, ry] },
    { kind: "C", c1: [-kx, ry], c2: [-rx, ky], to: [-rx, 0] },
    { kind: "C", c1: [-rx, -ky], c2: [-kx, -ry], to: [0, -ry] },
    { kind: "C", c1: [kx, -ry], c2: [rx, -ky], to: [rx, 0] },
    { kind: "Z" },
  ];
}

export function circlePath(r: number): Segment2D[] {
  return ellipsePath(r, r);
}

export function polygonPath(points: readonly Vec2[]): Segment2D[] {
  const [first, ...rest] = points;
  return [
    { kind: "M", to: first },
    ...rest.map((to): Segment2D => ({ kind: "L", to })),
    { kind: "Z" },
  ];
}

/**
 * Đa giác đều n cạnh, bán kính ngoại tiếp r, đỉnh đầu hướng LÊN
 * (SVG y-down → đỉnh đầu ở góc -90°).
 */
export function regularPolygonPath(sides: number, r: number): Segment2D[] {
  const points: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return polygonPath(points);
}

/** Sao n cánh xen kẽ rOuter/rInner, cánh đầu hướng lên. */
export function starPath(points: number, rOuter: number, rInner: number): Segment2D[] {
  const vertices: Vec2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    vertices.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return polygonPath(vertices);
}

/**
 * Polyline hở (line/strokeWidth xử lý ở emitter — không tham gia boolean).
 */
export function linePath(points: readonly Vec2[]): Segment2D[] {
  const [first, ...rest] = points;
  return [{ kind: "M", to: first }, ...rest.map((to): Segment2D => ({ kind: "L", to }))];
}

// ---------- Flatten (cho tessellation 3D profile) ----------

/**
 * Nắn segment thành polyline (mỗi cubic → `steps` đoạn thẳng).
 * Trả về các contour đóng riêng biệt (mỗi M mở contour mới).
 */
export function flattenToContours(
  segments: readonly Segment2D[],
  steps: number,
): Vec2[][] {
  const contours: Vec2[][] = [];
  let current: Vec2[] = [];
  let cursor: Vec2 = [0, 0];

  const push = (p: Vec2) => {
    const last = current[current.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) current.push(p);
  };

  for (const seg of segments) {
    switch (seg.kind) {
      case "M":
        if (current.length > 1) contours.push(current);
        current = [seg.to];
        cursor = seg.to;
        break;
      case "L":
        push(seg.to);
        cursor = seg.to;
        break;
      case "C": {
        const [x0, y0] = cursor;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          const x =
            u * u * u * x0 + 3 * u * u * t * seg.c1[0] + 3 * u * t * t * seg.c2[0] + t * t * t * seg.to[0];
          const y =
            u * u * u * y0 + 3 * u * u * t * seg.c1[1] + 3 * u * t * t * seg.c2[1] + t * t * t * seg.to[1];
          push([x, y]);
        }
        cursor = seg.to;
        break;
      }
      case "Z":
        // Contour đóng: bỏ điểm cuối nếu trùng điểm đầu
        if (current.length > 1) {
          const first = current[0];
          const last = current[current.length - 1];
          if (first[0] === last[0] && first[1] === last[1]) current.pop();
          contours.push(current);
          current = [];
        }
        break;
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

/** Convex hull 2D (Andrew monotone chain) — silhouette cho solid smooth. */
export function convexHull2D(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Diện tích có dấu (shoelace) — dương nếu CCW trong hệ y-down là CW thị giác. */
export function signedArea(contour: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % contour.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
