/**
 * Kiểu lõi cho construct engine — compiler biến spec kỷ hà (primitives +
 * boolean + transform + 3D) thành SVG fragment deterministic.
 * Toàn bộ module trong construct/ là pure function, không I/O.
 */

// ---------- Đại số tuyến tính ----------

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** Ma trận 4×4 row-major (16 phần tử) — dùng cho transform + chiếu 3D. */
export type Mat4 = readonly number[];

/** Ma trận affine 2D theo thứ tự SVG matrix(a b c d e f). */
export interface Affine2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

// ---------- Mesh 3D ----------

/**
 * Mặt đa giác phẳng: chỉ số đỉnh theo thứ tự CCW nhìn từ ngoài
 * (normal hướng ra ngoài theo quy tắc bàn tay phải).
 */
export interface MeshFace {
  readonly vertices: readonly number[];
  /** Ring lỗ (cap của extrude có lỗ) — winding ngược outer, fill evenodd. */
  readonly holes?: readonly (readonly number[])[];
  /** Nhãn mặt cho cutout: "top"|"bottom"|"front"|"back"|"left"|"right" với box/extrude. */
  readonly label?: string;
  /** Fill kế thừa từ solid nguồn (mặt kết quả CSG đa màu). */
  readonly fill?: string;
}

export interface Mesh {
  /** Đỉnh trong toạ độ local (y-up, right-handed). */
  readonly vertices: readonly Vec3[];
  readonly faces: readonly MeshFace[];
}

/**
 * Solid "smooth" (sphere/cylinder/cone với shading:"smooth") không tessellate
 * thành mặt — render bằng silhouette + gradient (trick zdog).
 */
export type SmoothKind = "sphere" | "cylinder" | "cone";

// ---------- Kết quả chiếu ----------

/** Mặt đã chiếu xuống màn hình, sẵn sàng sort + shade + emit. */
export interface ProjectedFace {
  /** Đa giác 2D toạ độ màn hình (sau chiếu + flip y). */
  readonly points: readonly Vec2[];
  /** Ring lỗ đã chiếu (nếu có) — emit subpath, fill evenodd. */
  readonly holes?: readonly (readonly Vec2[])[];
  /** Độ sâu view-space (centroid z) — sort painter's algorithm. */
  readonly depth: number;
  /** Normal view-space (đã transform) — tính lambert. */
  readonly normal: Vec3;
  /** Id solid nguồn + chỉ số mặt — tie-break deterministic. */
  readonly solidId: string;
  readonly solidIndex: number;
  readonly faceIndex: number;
  readonly label?: string;
  /** Fill kế thừa từ solid nguồn (CSG đa màu) — ưu tiên sau csg.fill. */
  readonly fill?: string;
}

// ---------- Kết quả compile ----------

export interface CompileStats {
  readonly shapes: number;
  readonly solids: number;
  readonly facesGenerated: number;
  readonly facesEmitted: number;
  readonly pathCommands: number;
  readonly bytes: number;
  readonly compileMs: number;
}

export interface CompileResult {
  /** SVG fragment (không root <svg>) — đã qua sanitizeSvg("frame"). */
  readonly svg: string;
  readonly stats: CompileStats;
  /** Cảnh báo non-fatal (clamp, boolean rỗng không emit, solids giao nhau…). */
  readonly warnings: readonly string[];
}
