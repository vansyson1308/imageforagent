import type { MotionSpec } from "@/lib/validation/motionSchema";
import { exportGltf, type GltfOptions, type GltfResult } from "@/lib/services/construct/gltf";
import { evaluateMotionAt, frameTime, prepareMotion, type MotionContext } from "@/lib/services/motion/evaluate";

/**
 * gltfMotion — shot hoạt hình → glTF có animation: đánh giá scene từng frame
 * (pure, KHÔNG compile SVG) → sampler TRS per node. holdFrames > 1 ⇒ STEP
 * (giữ pose kiểu "on twos"), còn lại LINEAR.
 */
export function exportMotionGltf(motion: MotionSpec, ctx: MotionContext = {}, opts: GltfOptions = {}): GltfResult {
  const prepared = prepareMotion(motion, ctx);
  const scenes = Array.from({ length: prepared.frameCount }, (_, i) => evaluateMotionAt(prepared, frameTime(motion, i)));
  const result = exportGltf(scenes[0], opts, { scenes, fps: motion.fps, step: motion.holdFrames > 1 });
  return { ...result, warnings: [...prepared.warnings, ...result.warnings] };
}
