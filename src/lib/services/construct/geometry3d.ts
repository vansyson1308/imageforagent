import type { Mat4, Mesh, MeshFace, Vec2, Vec3 } from "@/lib/services/construct/types";
import { transformPoint } from "@/lib/services/construct/math3d";
import { signedArea } from "@/lib/services/construct/geometry2d";
import { AppError } from "@/lib/services/apiError";

/**
 * geometry3d — mesh generator cho primitives 3D.
 * Quy ước local: khối đặt TÂM tại gốc, chiều cao dọc trục y (y-up),
 * mặt "front" = +z, "right" = +x. Mọi mặt CCW nhìn từ ngoài.
 */

// ---------- Box ----------

/** Hộp size [w, h, d] tâm gốc. 6 mặt có nhãn đầy đủ. */
export function boxMesh(size: Vec3): Mesh {
  const [hw, hh, hd] = [size[0] / 2, size[1] / 2, size[2] / 2];
  // Đỉnh: bit 0 = x, bit 1 = y, bit 2 = z (0 = âm, 1 = dương)
  const vertices: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    vertices.push([
      i & 1 ? hw : -hw,
      i & 2 ? hh : -hh,
      i & 4 ? hd : -hd,
    ]);
  }
  // CCW nhìn từ ngoài (winding chốt bằng Newell probe + test theo nhãn)
  const faces: MeshFace[] = [
    { vertices: [6, 7, 3, 2], label: "top" }, // +y
    { vertices: [1, 5, 4, 0], label: "bottom" }, // −y
    { vertices: [5, 7, 6, 4], label: "front" }, // +z
    { vertices: [2, 3, 1, 0], label: "back" }, // −z
    { vertices: [3, 7, 5, 1], label: "right" }, // +x
    { vertices: [4, 6, 2, 0], label: "left" }, // −x
  ];
  return { vertices, faces };
}

// ---------- Cylinder / Prism / Cone / Pyramid ----------

/** Vòng đỉnh n cạnh bán kính r tại cao độ y (đỉnh đầu hướng +z). */
function ring(n: number, r: number, y: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i * 2 * Math.PI) / n;
    points.push([r * Math.sin(angle), y, r * Math.cos(angle)]);
  }
  return points;
}

/**
 * Trụ (cylinder) hoặc lăng trụ đều (prism — chỉ khác segments nhỏ).
 * Mặt: đáy + nắp + segments mặt bên. Nhãn: top/bottom.
 */
export function cylinderMesh(r: number, h: number, segments: number): Mesh {
  const bottom = ring(segments, r, -h / 2);
  const top = ring(segments, r, h / 2);
  const vertices = [...bottom, ...top];
  const faces: MeshFace[] = [];
  // Nắp trên: CCW nhìn từ +y — vòng ring() theo góc tăng là CCW nhìn từ
  // TRÊN xuống với (sin, cos)? Kiểm: góc 0 → (0, y, r) = +z; góc 90° → (r, y, 0).
  // Nhìn từ +y xuống (x phải, z lên): +z → +x là CW thị giác… chốt bằng Newell test.
  faces.push({ vertices: Array.from({ length: segments }, (_, i) => segments + i), label: "top" });
  faces.push({
    vertices: Array.from({ length: segments }, (_, i) => segments - 1 - i),
    label: "bottom",
  });
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    // Quad bên: bottom_i → bottom_j → top_j → top_i
    faces.push({ vertices: [i, j, segments + j, segments + i] });
  }
  return { vertices, faces };
}

/**
 * Nón (cone, rTop=0) hoặc nón cụt (frustum, rTop>0) hoặc chóp đều
 * (pyramid — segments nhỏ). Nhãn: bottom (+ top nếu rTop>0).
 */
export function coneMesh(r: number, rTop: number, h: number, segments: number): Mesh {
  const bottom = ring(segments, r, -h / 2);
  if (rTop <= 0) {
    const apex: Vec3 = [0, h / 2, 0];
    const vertices = [...bottom, apex];
    const faces: MeshFace[] = [
      { vertices: Array.from({ length: segments }, (_, i) => segments - 1 - i), label: "bottom" },
    ];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      faces.push({ vertices: [i, j, segments] });
    }
    return { vertices, faces };
  }
  const top = ring(segments, rTop, h / 2);
  const vertices = [...bottom, ...top];
  const faces: MeshFace[] = [
    { vertices: Array.from({ length: segments }, (_, i) => segments + i), label: "top" },
    { vertices: Array.from({ length: segments }, (_, i) => segments - 1 - i), label: "bottom" },
  ];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push({ vertices: [i, j, segments + j, segments + i] });
  }
  return { vertices, faces };
}

// ---------- Sphere ----------

/**
 * UV sphere: `segments` kinh tuyến × (segments/2) vĩ tuyến.
 * Cực trên/dưới là quạt tam giác; giữa là quad.
 */
export function sphereMesh(r: number, segments: number): Mesh {
  const rings = Math.max(2, Math.floor(segments / 2));
  const vertices: Vec3[] = [[0, r, 0]]; // cực bắc (index 0)
  for (let lat = 1; lat < rings; lat++) {
    const phi = (lat * Math.PI) / rings; // 0 = cực bắc
    const y = r * Math.cos(phi);
    const rr = r * Math.sin(phi);
    for (let lon = 0; lon < segments; lon++) {
      const theta = (lon * 2 * Math.PI) / segments;
      vertices.push([rr * Math.sin(theta), y, rr * Math.cos(theta)]);
    }
  }
  vertices.push([0, -r, 0]); // cực nam (index cuối)
  const south = vertices.length - 1;
  const idx = (lat: number, lon: number) => 1 + (lat - 1) * segments + (lon % segments);

  const faces: MeshFace[] = [];
  // Quạt cực bắc (winding chốt bằng Newell probe: theta tăng = CCW từ ngoài)
  for (let lon = 0; lon < segments; lon++) {
    faces.push({ vertices: [0, idx(1, lon), idx(1, lon + 1)] });
  }
  // Quad giữa
  for (let lat = 1; lat < rings - 1; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      faces.push({
        vertices: [idx(lat, lon), idx(lat + 1, lon), idx(lat + 1, lon + 1), idx(lat, lon + 1)],
      });
    }
  }
  // Quạt cực nam
  for (let lon = 0; lon < segments; lon++) {
    faces.push({ vertices: [south, idx(rings - 1, lon + 1), idx(rings - 1, lon)] });
  }
  return { vertices, faces };
}

// ---------- Extrude ----------

/** Điểm có nằm trong contour không (ray casting). */
function pointInContour(p: Vec2, contour: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const [xi, yi] = contour[i];
    const [xj, yj] = contour[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Extrude profile 2D thành khối dày `depth` dọc trục z (back z=−depth/2,
 * front z=+depth/2 — tâm gốc như mọi primitive khác).
 *
 * Profile nhận theo toạ độ SVG (y-down) — map sang world y-up (py → −y)
 * để "hướng lên trong hình vẽ" = "hướng lên trong không gian".
 *
 * Contour phân loại outer/hole bằng số lần bị chứa (chẵn = outer, lẻ = hole),
 * rồi ép winding: outer CCW (y-up), hole CW → normal tường luôn hướng ra.
 * Cap có lỗ dùng MeshFace.holes (fill evenodd) — lỗ sắc nét kiểu vector.
 */
export function extrudeMesh(svgContours: readonly (readonly Vec2[])[], depth: number): Mesh {
  if (svgContours.length === 0 || svgContours.every((c) => c.length < 3)) {
    throw new AppError(
      "CONSTRUCTION_INVALID",
      "Extrude profile has no closed contour.",
      "Extrusion needs a closed profile — close the path or use polygon/rect/circle.",
    );
  }

  // Map y-down → y-up
  const contours = svgContours
    .filter((c) => c.length >= 3)
    .map((c) => c.map(([x, y]): Vec2 => [x, -y]));

  // Phân loại outer/hole theo containment parity
  const classified = contours.map((contour, i) => {
    const probe = contour[0];
    let containedBy = 0;
    contours.forEach((other, j) => {
      if (i !== j && pointInContour(probe, other)) containedBy++;
    });
    return { contour, isHole: containedBy % 2 === 1 };
  });

  // Ép winding: outer CCW (area > 0 trong y-up), hole CW
  const oriented = classified.map(({ contour, isHole }) => {
    const ccw = signedArea(contour) > 0;
    const points = (isHole ? ccw : !ccw) ? [...contour].reverse() : contour;
    return { points, isHole };
  });

  const zBack = -depth / 2;
  const zFront = depth / 2;
  const vertices: Vec3[] = [];
  // offsets[c] = [backStart, frontStart] của contour c
  const offsets: Array<readonly [number, number]> = [];
  for (const { points } of oriented) {
    const backStart = vertices.length;
    for (const [x, y] of points) vertices.push([x, y, zBack]);
    const frontStart = vertices.length;
    for (const [x, y] of points) vertices.push([x, y, zFront]);
    offsets.push([backStart, frontStart]);
  }

  const faces: MeshFace[] = [];

  // Tường: outer CCW → quad (back_i, back_j, front_j, front_i) normal hướng ra;
  // hole CW → cùng công thức tự cho normal hướng vào lòng lỗ (ra khỏi khối)
  oriented.forEach(({ points }, c) => {
    const [backStart, frontStart] = offsets[c];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push({
        vertices: [backStart + i, backStart + j, frontStart + j, frontStart + i],
      });
    }
  });

  // Caps: outer đầu tiên làm ring chính, mọi hole là holes của nó.
  // (v1: nhiều outer rời nhau → mỗi outer 1 cặp cap, hole gán theo containment.)
  const outers = oriented
    .map((o, c) => ({ ...o, c }))
    .filter((o) => !o.isHole);
  const holes = oriented
    .map((o, c) => ({ ...o, c }))
    .filter((o) => o.isHole);

  for (const outer of outers) {
    const [outerBack, outerFront] = offsets[outer.c];
    const myHoles = holes.filter((h) => pointInContour(h.points[0], outer.points));
    const n = outer.points.length;

    // Front cap (+z): outer CCW nhìn từ +z → giữ nguyên thứ tự
    faces.push({
      vertices: Array.from({ length: n }, (_, i) => outerFront + i),
      holes: myHoles.map((h) =>
        Array.from({ length: h.points.length }, (_, i) => offsets[h.c][1] + i),
      ),
      label: "front",
    });
    // Back cap (−z): đảo thứ tự để normal −z
    faces.push({
      vertices: Array.from({ length: n }, (_, i) => outerBack + (n - 1 - i)),
      holes: myHoles.map((h) => {
        const hn = h.points.length;
        return Array.from({ length: hn }, (_, i) => offsets[h.c][0] + (hn - 1 - i));
      }),
      label: "back",
    });
  }

  return { vertices, faces };
}

// ---------- Transform + đo đạc ----------

export function transformMesh(m: Mat4, mesh: Mesh): Mesh {
  return {
    vertices: mesh.vertices.map((v) => transformPoint(m, v)),
    faces: mesh.faces,
  };
}

export function meshFaceCount(mesh: Mesh): number {
  return mesh.faces.length;
}

/** Bán kính scene (từ gốc) — cho autoDistance perspective. */
export function meshRadius(meshes: readonly Mesh[]): number {
  let max = 0;
  for (const mesh of meshes) {
    for (const [x, y, z] of mesh.vertices) {
      const d = Math.hypot(x, y, z);
      if (d > max) max = d;
    }
  }
  return max;
}
