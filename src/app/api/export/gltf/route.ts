import { z } from "zod";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { ASPECT_RATIOS } from "@/lib/validation/schemas";
import { LOGICAL_CANVAS } from "@/lib/services/svgRenderer";
import { exportGltf } from "@/lib/services/construct/gltf";
import { exportMotionGltf } from "@/lib/services/motion/gltfMotion";
import { AppError } from "@/lib/services/apiError";

const gltfRequestSchema = z
  .object({
    /** Scene tĩnh (như POST /api/construct)… */
    spec: constructSpecSchema.optional(),
    /** …hoặc một shot motion (như POST /api/motion) → glTF có animation. */
    motion: motionSpecSchema.optional(),
    shotType: z.string().max(200).optional(),
    options: z
      .object({
        /** Đơn vị engine → mét (0.01: figure 170 ≈ người 1.7 m). */
        unitScale: z.number().gt(0).max(100).default(0.01),
        unlit: z.boolean().default(false),
        aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
      })
      .default({ unitScale: 0.01, unlit: false, aspectRatio: "16:9" }),
    /** true = trả file .gltf trực tiếp (curl -o scene.gltf). */
    download: z.boolean().default(false),
  })
  .refine((b) => (b.spec ? 1 : 0) + (b.motion ? 1 : 0) === 1, { message: 'Send exactly one of "spec" or "motion"' });

/**
 * POST /api/export/gltf — construct scene / motion shot → glTF 2.0 (JSON +
 * buffer nhúng). Cầu nối sang Blender (Cycles/EEVEE), three.js, Unreal:
 * mesh = đúng mesh renderer SVG dùng, camera khớp khung hình, animation
 * TRS per solid (FK figure, walk rig, tracks). Stateless.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("export:gltf", 10);
    const body = await parseBody(req, gltfRequestSchema);
    const opts = { unitScale: body.options.unitScale, unlit: body.options.unlit, canvas: LOGICAL_CANVAS[body.options.aspectRatio] };
    const result = body.motion
      ? exportMotionGltf(body.motion, { shotType: body.shotType }, opts)
      : body.spec
        ? exportGltf(body.spec, opts)
        : (() => {
            throw new AppError("VALIDATION", 'Send "spec" or "motion".');
          })();
    if (body.download) {
      return new Response(JSON.stringify(result.gltf), {
        headers: {
          "Content-Type": "model/gltf+json",
          "Content-Disposition": 'attachment; filename="scene.gltf"',
          "X-Gltf-Warnings": String(result.warnings.length),
        },
      });
    }
    return Response.json({ gltf: result.gltf, stats: result.stats, warnings: result.warnings });
  });
}
