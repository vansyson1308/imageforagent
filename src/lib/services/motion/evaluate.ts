import { AppError } from "@/lib/services/apiError";
import { constructSpecSchema, type ConstructSpec } from "@/lib/validation/constructSchema";
import type { MotionSpec, Rig, ShotMove, Track } from "@/lib/validation/motionSchema";
import { sampleKeys } from "@/lib/services/motion/interpolate";
import { materializeOrbit, readTarget, valueKindOf, writeTarget, type PathValue } from "@/lib/services/motion/targetPath";
import { applyRoll, applyShot, applyWalk, applyWiggle, shotMoveFromShotType } from "@/lib/services/motion/rigs";
import { applyIk } from "@/lib/services/motion/ik";
import { sampleLip, type LipCurves } from "@/lib/services/audio/lipsync";

/**
 * evaluate — motion spec + thời điểm t → construct spec TĨNH của frame đó.
 * Pure + deterministic. Thứ tự đánh giá cố định (hợp đồng docs):
 *   1. generators  walk · shot         (dựng chuyển động nền)
 *   2. tracks      set | add            (key tay của agent THẮNG/CỘNG lên)
 *   3. dependents  roll · follow · ik · lipsync (suy từ trạng thái sau tracks)
 *   4. noise       wiggle               (lớp nhiễu phụ, cộng sau cùng)
 * rồi re-validate bằng constructSpecSchema — track đẩy giá trị ra ngoài
 * miền hợp lệ (overshoot outBack làm bán kính âm…) báo lỗi kèm thời điểm.
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

export interface MotionContext {
  /** Shot Type của frame storyboard — cho shot move "auto". */
  readonly shotType?: string;
  /** Đường cong khẩu hình của giọng frame (audio/lipsync.ts) — cho rig lipsync. */
  readonly lip?: LipCurves;
}

export interface PreparedMotion {
  readonly motion: MotionSpec;
  readonly frameCount: number;
  /** Move đã resolve cho từng rig shot (index rig → move). */
  readonly shotMoves: ReadonlyMap<number, Exclude<ShotMove, "auto">>;
  readonly warnings: readonly string[];
  readonly animatesCameraOrbit: boolean;
  readonly lip?: LipCurves;
}

/** Camera/place luôn "on ones" — pan/dolly lấy mẫu mỗi frame. */
function isCameraPath(path: string): boolean {
  return path.startsWith("camera.") || path.startsWith("place.");
}

export function frameCountOf(motion: MotionSpec): number {
  return Math.max(1, Math.round(motion.duration * motion.fps));
}

/** Thời điểm (giây) của frame i. */
export function frameTime(motion: MotionSpec, i: number): number {
  return i / motion.fps;
}

export function prepareMotion(motion: MotionSpec, ctx: MotionContext = {}): PreparedMotion {
  const warnings: string[] = [];
  const shotMoves = new Map<number, Exclude<ShotMove, "auto">>();
  motion.rigs.forEach((rig, i) => {
    if (rig.type !== "shot") return;
    if (rig.move !== "auto") {
      shotMoves.set(i, rig.move);
      return;
    }
    const inferred = shotMoveFromShotType(ctx.shotType);
    if (inferred === null) {
      warnings.push(
        `Shot rig "auto": could not infer a camera move from shotType ${ctx.shotType ? `"${ctx.shotType}"` : "(none)"} — holding static. Name the move explicitly (dollyIn, pan, orbit, …).`,
      );
      shotMoves.set(i, "static");
    } else {
      shotMoves.set(i, inferred);
    }
  });

  const cameraOrbitPaths = [
    ...motion.tracks.map((t) => t.target),
    ...motion.rigs.flatMap((r) => ("target" in r && typeof r.target === "string" ? [r.target] : [])),
    ...motion.rigs.flatMap((r) => (r.type === "follow" ? [r.source] : [])),
  ];
  const animatesCameraOrbit = cameraOrbitPaths.some((p) => p.startsWith("camera.orbit"));

  for (const tr of motion.tracks) {
    const last = tr.keys[tr.keys.length - 1].t;
    if (last > motion.duration + 1e-9) {
      warnings.push(`Track "${tr.target}" has keys after the shot ends (${last}s > ${motion.duration}s) — they never play.`);
    }
  }

  // Wiggle ngoài cửa sổ không chạm target ở t=0 → validate đường dẫn tường minh
  for (const rig of motion.rigs) {
    if (rig.type === "wiggle") {
      const amp = rig.amplitude;
      readTarget(motion.scene, rig.target, typeof amp === "number" ? undefined : `vec${amp.length}`);
    }
  }

  for (const rig of motion.rigs) {
    if (rig.type !== "lipsync") continue;
    const part = motion.scene.parts.find((p) => p.id === rig.part);
    if (!part || part.type !== "figure") {
      err(`Lipsync rig: "${rig.part}" is not a figure part.`, 'Lipsync drives the mouth of a part of type "figure".');
    }
    if (!part.face) {
      err(`Lipsync rig: figure "${rig.part}" has no face.`, 'Add "face": {} to the figure so it has a mouth to animate.');
    }
    if (!ctx.lip) {
      warnings.push(`Lipsync rig on "${rig.part}" has no voice yet — the mouth stays closed. Add dialogue (PUT /api/frames/:id/dialogue) or send "voice" with the preview.`);
    }
  }

  const prepared: PreparedMotion = {
    motion,
    frameCount: frameCountOf(motion),
    shotMoves,
    warnings,
    animatesCameraOrbit,
    lip: ctx.lip,
  };
  // Validate sớm mọi đường dẫn + kiểu (lỗi path báo ngay, không đợi frame giữa)
  evaluateMotionAt(prepared, 0);
  return prepared;
}

function kindOfKeys(track: Track): string {
  return valueKindOf(track.keys[0].v)!;
}

function applyTrack(spec: ConstructSpec, track: Track, t: number): void {
  const kind = kindOfKeys(track);
  const cur = readTarget(spec, track.target, kind);
  const v = sampleKeys(track.keys, t) as PathValue;
  if (track.blend === "set") {
    writeTarget(spec, track.target, v);
    return;
  }
  if (typeof v === "number") writeTarget(spec, track.target, (cur as number) + v);
  else writeTarget(spec, track.target, (cur as number[]).map((c, i) => c + (v as number[])[i]));
}

/** Stage 1–2 (generators + tracks) — dùng lại cho follow tại t − lag. */
function evaluateCore(prep: PreparedMotion, base: ConstructSpec, t: number, tq: number): ConstructSpec {
  const { motion } = prep;
  const spec = structuredClone(base);
  if (prep.animatesCameraOrbit) materializeOrbit(spec);

  motion.rigs.forEach((rig, i) => {
    if (rig.type === "walk") applyWalk(spec, rig, tq, motion.duration);
    else if (rig.type === "shot") applyShot(spec, rig, prep.shotMoves.get(i)!, t, motion.duration);
  });
  for (const track of motion.tracks) {
    applyTrack(spec, track, isCameraPath(track.target) ? t : tq);
  }
  return spec;
}

function quantize(motion: MotionSpec, t: number): number {
  if (motion.holdFrames <= 1) return t;
  const step = motion.holdFrames / motion.fps;
  return Math.floor(t / step + 1e-9) * step;
}

type FollowRig = Extract<Rig, { type: "follow" }>;

function applyFollow(prep: PreparedMotion, base: ConstructSpec, spec: ConstructSpec, rig: FollowRig, t: number): void {
  const tl = Math.max(0, t - rig.lag);
  const lagged = evaluateCore(prep, base, tl, quantize(prep.motion, tl));
  const kind = valueKindOf(readTarget(lagged, rig.source));
  if (kind === "color") err(`Follow rig "${rig.source}" → "${rig.target}": colors cannot follow.`, "Follow numbers or vectors.");
  const src = readTarget(lagged, rig.source) as number | number[];
  const cur = readTarget(spec, rig.target, kind!) as number | number[];
  if (rig.blend === "set") {
    writeTarget(spec, rig.target, typeof src === "number" ? src * rig.gain : src.map((v) => v * rig.gain));
    return;
  }
  // Base của source = giá trị trên scene sau materialize (chưa có chuyển động)
  const baseScene = structuredClone(base);
  if (prep.animatesCameraOrbit) materializeOrbit(baseScene);
  const src0 = readTarget(baseScene, rig.source, kind!) as number | number[];
  if (typeof src === "number") {
    writeTarget(spec, rig.target, (cur as number) + rig.gain * (src - (src0 as number)));
  } else {
    writeTarget(spec, rig.target, (cur as number[]).map((c, i) => c + rig.gain * (src[i] - (src0 as number[])[i])));
  }
}

export function evaluateMotionAt(prep: PreparedMotion, t: number): ConstructSpec {
  const { motion } = prep;
  const base = motion.scene;
  const tq = quantize(motion, t);
  const spec = evaluateCore(prep, base, t, tq);

  for (const rig of motion.rigs) {
    if (rig.type === "roll") applyRoll(spec, base, rig);
    else if (rig.type === "follow") applyFollow(prep, base, spec, rig, tq);
  }
  // IK sau roll/follow: target có thể là solid do chúng dịch chuyển
  for (const rig of motion.rigs) {
    if (rig.type === "ik") applyIk(spec, rig, tq, motion.duration);
  }
  // Lip-sync: miệng theo giọng — lấy mẫu t (on ones: khẩu hình cần từng frame)
  if (prep.lip) {
    for (const rig of motion.rigs) {
      if (rig.type !== "lipsync") continue;
      const part = spec.parts.find((p) => p.id === rig.part);
      if (!part || part.type !== "figure" || !part.face) continue;
      const { open, wide } = sampleLip(prep.lip, t);
      part.face = { ...part.face, mouthOpen: Math.min(1, open * rig.gain), mouthWide: wide };
    }
  }
  for (const rig of motion.rigs) {
    if (rig.type === "wiggle") applyWiggle(spec, rig, isCameraPath(rig.target) ? t : tq, motion.duration);
  }

  const parsed = constructSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    err(
      `At t=${Math.round(t * 1000) / 1000}s the animated scene is invalid — ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      "A track or rig drove a value out of its valid range — check overshoot eases (outBack/outElastic), additive blends, and key values.",
    );
  }
  return parsed.data;
}
