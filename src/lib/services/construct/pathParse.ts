import type { Vec2 } from "@/lib/services/construct/types";
import type { Segment2D } from "@/lib/services/construct/geometry2d";
import { AppError } from "@/lib/services/apiError";

/**
 * pathParse — parse path data SVG đầy đủ grammar (M/L/H/V/C/S/Q/T/A/Z,
 * hoa/thường) → Segment2D chuẩn hoá (M/L/C/Z TUYỆT ĐỐI, Q nâng bậc thành C,
 * A nắn thành C). Đây là cửa nhận `path` thô của agent và parse lại output
 * boolean — mọi thứ sau đó chỉ còn 4 loại segment.
 */

function fail(context: string, detail: string): never {
  throw new AppError(
    "CONSTRUCTION_INVALID",
    `Path "${context}" is invalid: ${detail}`,
    "Check the path data — supported commands are M L H V C S Q T A Z (absolute or relative).",
  );
}

/** Tokenize: lệnh hoặc số (hỗ trợ số khoa học, dấu phẩy/space phân cách). */
function tokenize(d: string, context: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([^\s,])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else if (m[2]) tokens.push(Number(m[2]));
    else fail(context, `unexpected character "${m[3]}"`);
  }
  return tokens;
}

/** Nâng bậc quadratic → cubic: c1 = p0 + 2/3(q − p0), c2 = p1 + 2/3(q − p1). */
function quadToCubic(p0: Vec2, q: Vec2, p1: Vec2): Segment2D {
  return {
    kind: "C",
    c1: [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    c2: [p1[0] + (2 / 3) * (q[0] - p1[0]), p1[1] + (2 / 3) * (q[1] - p1[1])],
    to: p1,
  };
}

/**
 * Arc → cubics: endpoint parameterization → center parameterization
 * (W3C SVG F.6.5), chia cung ≤90° mỗi cubic.
 */
function arcToCubics(
  p0: Vec2,
  rx0: number,
  ry0: number,
  xRotDeg: number,
  largeArc: number,
  sweep: number,
  p1: Vec2,
): Segment2D[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [{ kind: "L", to: p1 }];

  const phi = (xRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // F.6.5.1
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // F.6.6: phóng bán kính nếu quá nhỏ
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // F.6.5.2
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * (-ry * x1p)) / rx;

  // F.6.5.3
  const cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + p1[1]) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // Chia cung ≤ 90°
  const nSegs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / nSegs;
  const out: Segment2D[] = [];
  const pointAt = (t: number): Vec2 => [
    cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
  ];
  const derivAt = (t: number): Vec2 => [
    -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
  ];
  for (let i = 0; i < nSegs; i++) {
    const t1 = theta1 + i * delta;
    const t2 = t1 + delta;
    const alpha = ((4 / 3) * Math.tan((t2 - t1) / 4));
    const s = pointAt(t1);
    const e = pointAt(t2);
    const d1 = derivAt(t1);
    const d2 = derivAt(t2);
    out.push({
      kind: "C",
      c1: [s[0] + alpha * d1[0], s[1] + alpha * d1[1]],
      c2: [e[0] - alpha * d2[0], e[1] - alpha * d2[1]],
      to: e,
    });
  }
  // Ép điểm cuối chính xác về p1 (tránh drift float)
  const last = out[out.length - 1];
  out[out.length - 1] = { ...last, to: p1 } as Segment2D;
  return out;
}

/**
 * Parse path data → Segment2D[] chuẩn hoá.
 * @param context tên shape (cho thông điệp lỗi)
 */
export function parsePathData(d: string, context: string): Segment2D[] {
  const tokens = tokenize(d, context);
  if (tokens.length === 0) fail(context, "empty path data");

  const out: Segment2D[] = [];
  let i = 0;
  let cursor: Vec2 = [0, 0];
  let subpathStart: Vec2 = [0, 0];
  let lastCubicC2: Vec2 | null = null;
  let lastQuadCtrl: Vec2 | null = null;
  let command = "";

  const takeNum = (): number => {
    const t = tokens[i];
    if (typeof t !== "number") fail(context, `expected number, got "${String(t)}"`);
    i++;
    return t;
  };
  const takePoint = (relative: boolean): Vec2 => {
    const x = takeNum();
    const y = takeNum();
    return relative ? [cursor[0] + x, cursor[1] + y] : [x, y];
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      command = t;
      i++;
      if (command === "Z" || command === "z") {
        out.push({ kind: "Z" });
        cursor = subpathStart;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        continue;
      }
    } else if (command === "") {
      fail(context, "path must start with a command");
    } else if (command === "M") {
      command = "L"; // cặp toạ độ lặp sau M là L ngầm định
    } else if (command === "m") {
      command = "l";
    }

    const rel = command === command.toLowerCase();
    const cmd = command.toUpperCase();

    switch (cmd) {
      case "M": {
        const to = takePoint(rel);
        out.push({ kind: "M", to });
        cursor = to;
        subpathStart = to;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        break;
      }
      case "L": {
        const to = takePoint(rel);
        out.push({ kind: "L", to });
        cursor = to;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        break;
      }
      case "H": {
        const x = takeNum();
        const to: Vec2 = [rel ? cursor[0] + x : x, cursor[1]];
        out.push({ kind: "L", to });
        cursor = to;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        break;
      }
      case "V": {
        const y = takeNum();
        const to: Vec2 = [cursor[0], rel ? cursor[1] + y : y];
        out.push({ kind: "L", to });
        cursor = to;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        break;
      }
      case "C": {
        const c1 = takePoint(rel);
        const c2 = takePoint(rel);
        const to = takePoint(rel);
        out.push({ kind: "C", c1, c2, to });
        cursor = to;
        lastCubicC2 = c2;
        lastQuadCtrl = null;
        break;
      }
      case "S": {
        const c1: Vec2 = lastCubicC2
          ? [2 * cursor[0] - lastCubicC2[0], 2 * cursor[1] - lastCubicC2[1]]
          : cursor;
        const c2 = takePoint(rel);
        const to = takePoint(rel);
        out.push({ kind: "C", c1, c2, to });
        cursor = to;
        lastCubicC2 = c2;
        lastQuadCtrl = null;
        break;
      }
      case "Q": {
        const q = takePoint(rel);
        const to = takePoint(rel);
        out.push(quadToCubic(cursor, q, to));
        cursor = to;
        lastQuadCtrl = q;
        lastCubicC2 = null;
        break;
      }
      case "T": {
        const q: Vec2 = lastQuadCtrl
          ? [2 * cursor[0] - lastQuadCtrl[0], 2 * cursor[1] - lastQuadCtrl[1]]
          : cursor;
        const to = takePoint(rel);
        out.push(quadToCubic(cursor, q, to));
        cursor = to;
        lastQuadCtrl = q;
        lastCubicC2 = null;
        break;
      }
      case "A": {
        const rx = takeNum();
        const ry = takeNum();
        const xRot = takeNum();
        const largeArc = takeNum();
        const sweep = takeNum();
        const to = takePoint(rel);
        out.push(...arcToCubics(cursor, rx, ry, xRot, largeArc, sweep, to));
        cursor = to;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        break;
      }
      default:
        fail(context, `unsupported command "${command}"`);
    }
  }
  return out;
}
