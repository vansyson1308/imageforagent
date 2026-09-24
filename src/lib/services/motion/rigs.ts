import { AppError } from "@/lib/services/apiError";
import { figureProportions } from "@/lib/services/construct/partFigure";
import type { ConstructSpec, Part } from "@/lib/validation/constructSchema";
import type { Rig, ShotMove } from "@/lib/validation/motionSchema";
import { applyEase } from "@/lib/services/motion/easing";
import { fbm1D } from "@/lib/services/motion/noise";
import { materializeOrbit, readTarget, writeTarget, type PathValue } from "@/lib/services/motion/targetPath";

/**
 * rigs — chuyển động THỦ TỤC: hàm thuần (scene tại t) → scene đã biến đổi.
 * Mỗi rig mã hoá một kỹ thuật của hoạt hoạ sĩ để agent không phải key tay:
 *   walk   chu kỳ bước contact→passing, stride suy từ chiều dài chân →
 *          bàn chân KHÔNG trượt (quãng đường/chu kỳ = 4·L·sin A)
 *   shot   chuyển động máy quay theo ngôn ngữ storyboard
 *   roll   lăn không trượt: góc = quãng đường / bán kính
 *   wiggle nhiễu mượt tất định (camera cầm tay, thở, idle)
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

const DEG = 180 / Math.PI;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// ---------- Walk ----------

type WalkRig = Extract<Rig, { type: "walk" }>;
type FigurePart = Extract<Part, { type: "figure" }>;

export interface WalkState {
  /** Vị trí trên mặt đất [x, z]. */
  readonly ground: [number, number];
  /** Hướng mặt (độ quanh y): figure local nhìn +z. */
  readonly yaw: number;
  /** Pha chu kỳ chân TRÁI ∈ [0,1): [0, DUTY) = trụ, [DUTY, 1) = lăng. */
  readonly phase: number;
  /** Nửa sải (mắt cá trước/sau hông) hiệu dụng — 0 khi đứng yên. */
  readonly halfStride: number;
  /** 0..1 — tỉ lệ tốc độ tức thời / tốc độ hành trình (ramp đầu/cuối). */
  readonly envelope: number;
  /** Đùi, cẳng chân, đế (sau scale) + chiều cao hông đứng thẳng. */
  readonly thigh: number;
  readonly shin: number;
  readonly footH: number;
  readonly hipsY: number;
  /** Góc vung hông danh định (độ). */
  readonly amplitude: number;
}

/** Tỉ lệ chu kỳ mỗi chân chạm đất — 0.6 = đi bộ (có pha hai chân cùng trụ). */
export const WALK_DUTY = 0.6;
/** Gối gập nhẹ khi trụ (độ) — không đổi trong pha trụ để mắt cá lùi đúng tuyến tính. */
const STANCE_KNEE = 5;

function findFigure(spec: ConstructSpec, id: string): FigurePart {
  const part = spec.parts.find((p) => p.id === id);
  if (!part) {
    err(
      `Walk rig: no part with id "${id}".`,
      `Defined parts: ${spec.parts.map((p) => p.id).join(", ") || "(none)"}. Walk drives a "figure" part.`,
    );
  }
  if (part.type !== "figure") err(`Walk rig: part "${id}" is a ${part.type}, not a figure.`, 'Walk needs a part of type "figure".');
  return part;
}

const frac = (x: number) => x - Math.floor(x);

/** Trạng thái walk tại t — pure, đo trên scene gốc (không phụ thuộc track). */
export function walkState(rig: WalkRig, part: FigurePart, t: number, duration: number): WalkState {
  const start = rig.start;
  const end = rig.end ?? duration;
  if (end <= start) err(`Walk rig on "${rig.part}": end (${end}s) must be after start (${start}s).`, 'Set "start" < "end" within the shot duration.');

  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < rig.path.length; i++) {
    const l = Math.hypot(rig.path[i][0] - rig.path[i - 1][0], rig.path[i][1] - rig.path[i - 1][1]);
    segLens.push(l);
    total += l;
  }
  if (total <= 0) err(`Walk rig on "${rig.part}": path has zero length.`, "Give at least two distinct [x, z] waypoints.");

  // Hồ sơ vận tốc hình thang: tăng tốc trong `ramp` giây, đều, giảm tốc
  const T = end - start;
  const ramp = Math.min(0.35, T / 4);
  const vmax = total / (T - ramp);
  const tau = clamp(t - start, 0, T);
  let s: number;
  let v: number;
  if (tau < ramp) {
    s = (vmax * tau * tau) / (2 * ramp);
    v = (vmax * tau) / ramp;
  } else if (tau <= T - ramp) {
    s = vmax * (ramp / 2 + (tau - ramp));
    v = vmax;
  } else {
    const r = T - tau;
    s = total - (vmax * r * r) / (2 * ramp);
    v = (vmax * r) / ramp;
  }
  s = clamp(s, 0, total);
  const envelope = t <= start || t >= end ? 0 : clamp(v / vmax, 0, 1);

  // Điểm + hướng trên polyline
  let seg = 0;
  let acc = 0;
  while (seg < segLens.length - 1 && acc + segLens[seg] < s) {
    acc += segLens[seg];
    seg++;
  }
  // Bỏ qua đoạn độ dài 0 khi tính hướng
  let dirSeg = seg;
  while (dirSeg < segLens.length - 1 && segLens[dirSeg] === 0) dirSeg++;
  const a = rig.path[seg];
  const b = rig.path[seg + 1];
  const u = segLens[seg] > 0 ? clamp((s - acc) / segLens[seg], 0, 1) : 0;
  const ground: [number, number] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const da = rig.path[dirSeg];
  const db = rig.path[dirSeg + 1];
  const yaw = Math.atan2(db[0] - da[0], db[1] - da[1]) * DEG;

  const dims = figureProportions(part.height, part.headCount);
  const k = part.scale;
  const thigh = dims.thigh * k;
  const shin = dims.shin * k;
  const legLen = thigh + shin;
  // Nửa sải X = (đùi+cẳng)·sin A. Trong pha trụ (DUTY chu kỳ) thân tiến 2X
  // so với bàn chân ⇒ quãng/chu kỳ = 2X/DUTY; nhịp = 2 bước/chu kỳ
  // ⇒ X = v·DUTY/cadence — tự suy A từ tốc độ khi không khai swing.
  const amplitude =
    rig.swing ?? clamp(Math.asin(clamp((vmax * WALK_DUTY) / (rig.cadence * legLen), 0, 1)) * DEG, 6, 38);
  const X = legLen * Math.sin(amplitude / DEG);
  const cycleDistance = (2 * X) / WALK_DUTY;

  return {
    ground,
    yaw,
    phase: frac(s / cycleDistance),
    halfStride: X * envelope,
    envelope,
    thigh,
    shin,
    footH: dims.footH * k,
    hipsY: dims.hipsY * k,
    amplitude,
  };
}

function addPose(part: FigurePart, joint: string, delta: [number, number, number]): void {
  const cur = part.pose[joint];
  const base: [number, number, number] =
    cur === undefined ? [0, 0, 0] : typeof cur === "number" ? [0, 0, cur] : [cur[0], cur[1], cur[2]];
  part.pose[joint] = [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]];
}

/** Mắt cá tiến trước hông bao nhiêu (dọc +z local) với góc hông h, gối k (độ). */
function ankleForward(thigh: number, shin: number, h: number, k: number): number {
  // Xoay quanh x góc θ đưa (0,−len,0) tới z = −len·sin θ (θ âm = về trước)
  return -(thigh * Math.sin(h / DEG) + shin * Math.sin((h + k) / DEG));
}

/** Giải h sao cho mắt cá tiến đúng `target` (bisection — đơn điệu trên ±70°). */
function solveHip(thigh: number, shin: number, k: number, target: number): number {
  let lo = -70;
  let hi = 70; // ankleForward giảm khi h tăng
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ankleForward(thigh, shin, mid, k) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface LegPose {
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  /** Chiều cao hông cần để đế chân này chạm đất. */
  readonly reach: number;
}

function legPose(st: WalkState, p: number): LegPose {
  const { thigh, shin, footH, envelope: env } = st;
  const X = st.halfStride;
  let hip: number;
  let knee: number;
  let toe = 0;
  if (p < WALK_DUTY) {
    // TRỤ: mắt cá lùi TUYẾN TÍNH +X → −X đúng bằng quãng thân tiến ⇒ không trượt
    knee = STANCE_KNEE * env;
    hip = solveHip(thigh, shin, knee, X * (1 - (2 * p) / WALK_DUTY));
  } else {
    // LĂNG: vung về trước theo cosine, gối gập cực đại giữa pha (passing)
    const u = (p - WALK_DUTY) / (1 - WALK_DUTY);
    knee = env * (STANCE_KNEE + (1 - Math.cos(2 * Math.PI * u)) * st.amplitude);
    hip = solveHip(thigh, shin, knee, -X * Math.cos(Math.PI * u));
    toe = env * 10 * Math.sin(Math.PI * u);
  }
  // Cổ chân bù: tổng góc chuỗi = 0 ⇒ bàn chân phẳng; mũi rủ nhẹ khi lăng
  const ankle = -(hip + knee) + toe;
  const reach = thigh * Math.cos(hip / DEG) + shin * Math.cos((hip + knee) / DEG) + footH;
  return { hip, knee, ankle, reach };
}

export function applyWalk(spec: ConstructSpec, rig: WalkRig, t: number, duration: number): void {
  const part = findFigure(spec, rig.part);
  const st = walkState(rig, part, t, duration);
  const env = st.envelope;
  const pL = st.phase;
  const pR = frac(pL + 0.5);
  const L = legPose(st, pL);
  const R = legPose(st, pR);
  addPose(part, "hipL", [L.hip, 0, 0]);
  addPose(part, "kneeL", [L.knee, 0, 0]);
  addPose(part, "ankleL", [L.ankle, 0, 0]);
  addPose(part, "hipR", [R.hip, 0, 0]);
  addPose(part, "kneeR", [R.knee, 0, 0]);
  addPose(part, "ankleR", [R.ankle, 0, 0]);

  // Tay vung NGƯỢC chân cùng bên: chân trái trước nhất lúc contact (p=0)
  // → tay trái sau nhất (+x = về sau); khuỷu gập thêm khi tay vung trước
  const swingL = Math.cos(2 * Math.PI * pL);
  if (rig.armSwing > 0) {
    const arm = rig.armSwing * env;
    addPose(part, "shoulderL", [arm * swingL, 0, 0]);
    addPose(part, "shoulderR", [-arm * swingL, 0, 0]);
    addPose(part, "elbowL", [-env * (10 + 14 * Math.max(0, -swingL)), 0, 0]);
    addPose(part, "elbowR", [-env * (10 + 14 * Math.max(0, swingL)), 0, 0]);
  }
  // Thân nghiêng về trước + xoắn ngược nhịp hông; cổ bù để đầu giữ ngang
  addPose(part, "spine", [rig.lean * env, 5 * env * swingL, 0]);
  addPose(part, "neck", [-rig.lean * env * 0.6, -2.5 * env * swingL, 0]);

  // Nhún CHÍNH XÁC: hông đặt sao cho chân "với" thấp nhất vừa chạm đất
  // (thấp nhất lúc contact hai chân dạng, cao nhất lúc passing)
  const drop = (st.hipsY - Math.max(L.reach, R.reach)) * rig.bounce;
  part.at = [st.ground[0], part.at[1] - drop, st.ground[1]];
  part.rotate = [part.rotate[0], st.yaw, part.rotate[2]];
}

// ---------- Shot (camera moves) ----------

type ShotRig = Extract<Rig, { type: "shot" }>;

/** Độ lớn mặc định của từng move — đơn vị ghi ở README. */
export const SHOT_DEFAULTS: Record<Exclude<ShotMove, "auto" | "static">, number> = {
  dollyIn: 0.3, // hệ số zoom tăng thêm
  dollyOut: 0.3,
  orbit: 20, // độ azimuth
  crane: 12, // độ elevation
  pan: 160, // px canvas camera sang phải
  tilt: 90, // px canvas camera ngẩng lên
  shake: 8, // px biên độ rung
};

/**
 * Suy move từ cột Shot Type của storyboard (EN + VI). Không khớp → null
 * (caller cảnh báo + static).
 */
export function shotMoveFromShotType(shotType: string | undefined): Exclude<ShotMove, "auto"> | null {
  if (!shotType) return null;
  const s = shotType.toLowerCase().normalize("NFC");
  const rules: [RegExp, Exclude<ShotMove, "auto">][] = [
    [/zoom[- ]?out|dolly[- ]?out|pull[- ]?(back|out)|lùi|thu nhỏ|zoom ra/, "dollyOut"],
    [/zoom|dolly|push[- ]?in|cận dần|tiến vào|đẩy vào/, "dollyIn"],
    [/orbit|arc|360|xoay quanh|vòng quanh/, "orbit"],
    [/crane|jib|boom|cẩu|nâng máy|hạ máy/, "crane"],
    [/tilt|lia dọc|ngước|chúc/, "tilt"],
    [/pan|truck|track|lia|trượt ngang|travelling/, "pan"],
    [/shake|handheld|cầm tay|rung/, "shake"],
    [/static|still|lock|tĩnh|cố định|establishing|wide|close|medium|toàn|cận|trung/, "static"],
  ];
  for (const [re, move] of rules) if (re.test(s)) return move;
  return null;
}

export function applyShot(
  spec: ConstructSpec,
  rig: ShotRig,
  move: Exclude<ShotMove, "auto">,
  t: number,
  duration: number,
): void {
  if (move === "static") return;
  const start = rig.start;
  const end = rig.end ?? duration;
  if (end <= start) err(`Shot rig "${move}": end (${end}s) must be after start (${start}s).`, 'Set "start" < "end".');
  const amount = rig.amount ?? SHOT_DEFAULTS[move];
  const u = applyEase(rig.ease, (t - start) / (end - start));
  switch (move) {
    case "dollyIn":
      spec.camera.zoom = spec.camera.zoom * (1 + amount * u);
      return;
    case "dollyOut":
      spec.camera.zoom = spec.camera.zoom / (1 + amount * u);
      return;
    case "orbit":
      materializeOrbit(spec);
      spec.camera.orbit = { ...spec.camera.orbit!, azimuth: spec.camera.orbit!.azimuth + amount * u };
      return;
    case "crane":
      materializeOrbit(spec);
      spec.camera.orbit = { ...spec.camera.orbit!, elevation: clamp(spec.camera.orbit!.elevation + amount * u, -89.9, 89.9) };
      return;
    case "pan":
      spec.place.at = [spec.place.at[0] - amount * u, spec.place.at[1]];
      return;
    case "tilt":
      spec.place.at = [spec.place.at[0], spec.place.at[1] + amount * u];
      return;
    case "shake": {
      if (t < start || t > end) return;
      const fade = windowFade(t, start, end);
      spec.place.at = [
        spec.place.at[0] + amount * fade * fbm1D(t * 6, 7919, 0, 2),
        spec.place.at[1] + amount * fade * fbm1D(t * 6, 7919, 1, 2),
      ];
      return;
    }
  }
}

// ---------- Roll ----------

type RollRig = Extract<Rig, { type: "roll" }>;

export function applyRoll(spec: ConstructSpec, base: ConstructSpec, rig: RollRig): void {
  const follow = rig.follow ?? rig.target;
  const now = readTarget(spec, `${follow}.at`, "vec3") as number[];
  const origin = readTarget(base, `${follow}.at`, "vec3") as number[];
  const rot = [...(readTarget(spec, `${rig.target}.rotate`, "vec3") as number[])];
  if (rig.along === "x") {
    // Tiến +x, trục lăn = up × dir = −z ⇒ góc quanh z ÂM
    rot[2] -= ((now[0] - origin[0]) / rig.radius) * DEG;
  } else {
    // Tiến +z, trục lăn = up × dir = +x ⇒ góc quanh x DƯƠNG
    rot[0] += ((now[2] - origin[2]) / rig.radius) * DEG;
  }
  writeTarget(spec, `${rig.target}.rotate`, rot);
}

// ---------- Wiggle ----------

type WiggleRig = Extract<Rig, { type: "wiggle" }>;

/** Fade vào/ra 0.2s (hoặc ¼ cửa sổ) — noise không "bật" giữa chừng. */
function windowFade(t: number, start: number, end: number): number {
  const f = Math.min(0.2, (end - start) / 4);
  if (f <= 0) return 1;
  return clamp(Math.min((t - start) / f, (end - t) / f), 0, 1);
}

export function applyWiggle(spec: ConstructSpec, rig: WiggleRig, t: number, duration: number): void {
  const start = rig.start;
  const end = rig.end ?? duration;
  if (t < start || t > end) return;
  const fade = windowFade(t, start, end);
  const amp = rig.amplitude;
  const kindWanted = typeof amp === "number" ? undefined : `vec${amp.length}`;
  const cur = readTarget(spec, rig.target, kindWanted);
  if (typeof cur === "string") {
    err(`Wiggle on "${rig.target}": colors cannot wiggle.`, "Wiggle numbers or vectors (positions, angles, zoom).");
  }
  const x = (t - start) * rig.frequency;
  const noise = (c: number) => fbm1D(x, rig.seed, c, rig.octaves) * fade;
  let next: PathValue;
  if (typeof cur === "number") {
    next = cur + (typeof amp === "number" ? amp : amp[0]) * noise(0);
  } else {
    next = cur.map((v, c) => v + (typeof amp === "number" ? amp : amp[c] ?? 0) * noise(c));
  }
  writeTarget(spec, rig.target, next);
}
